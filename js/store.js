/* =========================================================================
   store.js — 数据模型 / 持久化 / 调度
   设计原则（与实习生方案的关键差异）：
   1) 学习单元 = 可复用「骨架」，不是句子、不是单词。
   2) 调度刻意做「笨」：固定阶梯 0/1/3/7/21/60 天。个人句库的量级下，
      精调 FSRS 的收益远小于它带来的不可校准的魔法参数成本。
   3) 「已内化(owned)」必须有真实场景使用证据，模型打分不能单独授予。
   4) 每周建议收编 15 条，但不硬拦截；超出的条目自动错峰进入复习队列。
   ========================================================================= */

import {
  clearPersistedState,
  initPersistence,
  loadPersistedState,
  persistenceBackend,
  savePersistedState,
  writeLocalLog,
} from '../src/storage/database.ts';
import { createDailyBackup, exportSnapshot } from '../src/storage/backup.ts';
import {
  clearApiKey,
  clearProfileCredentials,
  getApiKey,
  getLlmApiKey,
  getSpeechApiKey,
  getTextProviderApiKey,
  setSpeechApiKey,
  setTextProviderApiKey,
} from '../src/platform/secure.ts';
import {
  DEFAULT_WEEKLY_NEW_TARGET,
  LADDER_DAYS,
  applyReviewNotBefore,
  initialReviewDelayDays,
  isOwned,
  nextReview,
} from '../src/core/scheduler.ts';
import {
  CURRENT_STATE_FORMAT_VERSION,
  migratePersistedState,
} from '../src/storage/state-migrations.ts';
import {
  createDailyRecommendationDeck,
  localDateKey,
  normalizeDailyRecommendationDeck,
  recommendationIndex,
} from '../src/core/recommendations.ts';
import {
  DEFAULT_SERVICE_REGION,
  DEFAULT_VOICE_MODE,
  getServiceProfile,
  hasRequiredCredentials,
  normalizeServiceRegion,
  normalizeVoiceMode,
} from '../src/speech/profiles.ts';
import {
  defaultTextProviderId,
  getTextProviderProfile,
  normalizeTextProviderId,
} from '../src/llm/profiles.ts';
import {
  appendRoleplayTurn,
  createRoleplaySessionRecord,
  nextRoleplayReview,
  normalizeRoleplayResult,
  normalizeRoleplaySession,
  roleplayCommunicationPassed,
  roleplayTargetSucceeded,
} from '../src/core/roleplay.ts';
import {
  createPracticeSessionRecord,
  normalizePracticeSession,
  practiceItemSnapshot,
  practiceSessionKey,
} from '../src/core/practice-session.ts';
import {
  normalizeRecordStatus,
} from '../src/core/library.ts';
import {
  learningItemKey,
  normalizeLearningItem,
  normalizeLearningItemKind,
} from '../src/core/learning-items.ts';
import {
  emptyToolTask,
  normalizeToolTasks,
} from '../src/core/tool-tasks.ts';

const KEY = 'sayable.v1';
const WEEK = 7 * 864e5;
const DEFAULT_PROFILE = getServiceProfile(DEFAULT_SERVICE_REGION);
const DEFAULT_TEXT_PROVIDER_ID = defaultTextProviderId(DEFAULT_SERVICE_REGION);
const DEFAULT_TEXT_PROVIDER = getTextProviderProfile(
  DEFAULT_TEXT_PROVIDER_ID,
  DEFAULT_SERVICE_REGION,
);

/* 间隔阶梯：天。box 5 = 毕业候选 */
export const LADDER = [...LADDER_DAYS];
export const WEEKLY_NEW_TARGET = DEFAULT_WEEKLY_NEW_TARGET;

export const state = {
  profile: {
    name: '', role: '', org: '', goal: '',
    domains: [], counterparts: [], scenarios: [], upcoming: '',
    variety: 'international', englishLevel: null,
  },
  items: /** @type {any[]} */ ([]),
  inbox: /** @type {any[]} */ ([]), // 闪存：只存原文，不分析、不联网、不问问题
  draft: '',
  drafts: {
    quickCapture: '',
    expression: '',
    compression: '',
    preflight: '',
  },
  notificationReplies: /** @type {any[]} */ ([]),
  compressions: /** @type {any[]} */ ([]),
  toolTasks: normalizeToolTasks(null),
  practiceSessions: /** @type {any[]} */ ([]),
  roleplaySessions: /** @type {any[]} */ ([]),
  dailyRecommendations: null,
  settings: {
    providerMode: 'profile',
    serviceRegion: DEFAULT_SERVICE_REGION,
    textProviderId: DEFAULT_TEXT_PROVIDER_ID,
    voiceMode: DEFAULT_VOICE_MODE,
    onboardingValidationVersion: 0,
    baseUrl: '',
    apiKey: '',          // 仅驻留内存；持久化时剔除，原生端写入 Keystore
    speechApiKey: '',    // 与 LLM Key 分开存放，可按区域独立切换
    model: '',
    protocol: DEFAULT_TEXT_PROVIDER.protocol,
    ttsVoice: DEFAULT_PROFILE.speech.defaultVoice,
    remindAt: '21:30',
    notificationsEnabled: false,
    notificationsEnabledAt: 0,
    quietStart: '23:00',
    quietEnd: '08:00',
    dailyLimit: 60,
    maxRetry: 3,
    supportsJsonMode: null,
    onboarded: false,
  },
  log: [],            // {at, type}
};

Object.defineProperty(state, 'draft', {
  configurable: true,
  enumerable: false,
  get() {
    return state.drafts.quickCapture;
  },
  set(value) {
    state.drafts.quickCapture = String(value || '');
  },
});

/* ---------------- persistence ---------------- */
let saveQueue = Promise.resolve();
let lastPersistenceError = null;

function persistableState() {
  const settings = { ...state.settings };
  delete settings.apiKey;
  delete settings.speechApiKey;
  return {
    formatVersion: CURRENT_STATE_FORMAT_VERSION,
    profile: state.profile,
    items: state.items,
    inbox: state.inbox,
    drafts: state.drafts,
    notificationReplies: state.notificationReplies,
    compressions: state.compressions,
    toolTasks: state.toolTasks,
    practiceSessions: state.practiceSessions,
    roleplaySessions: state.roleplaySessions,
    dailyRecommendations: state.dailyRecommendations,
    settings,
    log: state.log.slice(-500),
  };
}

function hydrate(d) {
  Object.assign(state.profile, d?.profile || {});
  Object.assign(state.settings, d?.settings || {});
  state.settings.serviceRegion = normalizeServiceRegion(state.settings.serviceRegion);
  state.settings.voiceMode = normalizeVoiceMode(state.settings.voiceMode);
  if (state.settings.providerMode !== 'custom') {
    const textProvider = getTextProviderProfile(
      state.settings.textProviderId,
      state.settings.serviceRegion,
    );
    Object.assign(state.settings, {
      providerMode: 'profile',
      textProviderId: textProvider.id,
      baseUrl: '',
      model: '',
      protocol: textProvider.protocol,
      ttsVoice: state.settings.ttsVoice
        || getServiceProfile(state.settings.serviceRegion).speech.defaultVoice,
    });
  }
  state.items = Array.isArray(d?.items)
    ? d.items.map(item => normalizeLearningItem(item))
    : [];
  state.inbox = (Array.isArray(d?.inbox) ? d.inbox : []).map(f => ({
    status: 'raw',
    failReason: '',
    source: 'app',
    ...f,
    status: f.status === 'analyzing'
      ? 'raw'
      : normalizeRecordStatus(f.status),
  }));
  state.drafts = {
    quickCapture: String(d?.drafts?.quickCapture || ''),
    expression: String(d?.drafts?.expression || ''),
    compression: String(d?.drafts?.compression || ''),
    preflight: String(d?.drafts?.preflight || ''),
  };
  state.notificationReplies = Array.isArray(d?.notificationReplies) ? d.notificationReplies : [];
  state.compressions = Array.isArray(d?.compressions) ? d.compressions : [];
  state.toolTasks = normalizeToolTasks(d?.toolTasks);
  state.practiceSessions = Array.isArray(d?.practiceSessions)
    ? d.practiceSessions
      .map(normalizePracticeSession)
      .filter(Boolean)
      .slice(-200)
    : [];
  state.roleplaySessions = Array.isArray(d?.roleplaySessions)
    ? d.roleplaySessions
      .map(normalizeRoleplaySession)
      .filter(Boolean)
      .slice(-100)
    : [];
  state.dailyRecommendations = normalizeDailyRecommendationDeck(
    d?.dailyRecommendations,
  );
  state.log = Array.isArray(d?.log) ? d.log.slice(-500) : [];
}

export async function load() {
  await initPersistence();
  let data = await loadPersistedState();
  let migratedLegacy = false;

  if (!data) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = JSON.parse(raw);
        migratedLegacy = true;
      }
    } catch (e) {
      console.warn('legacy load failed', e);
    }
  }

  if (data) {
    data = migratePersistedState(data);
    hydrate(data);
  }

  const region = normalizeServiceRegion(state.settings.serviceRegion);
  const legacyKey = data?.settings?.apiKey || await getApiKey();
  const credentialId = state.settings.providerMode === 'custom'
    ? `custom-${region}`
    : normalizeTextProviderId(state.settings.textProviderId, region);
  let llmApiKey = await getTextProviderApiKey(credentialId);
  const regionalKey = await getLlmApiKey(region);
  const keyToMigrate = legacyKey || regionalKey;
  if (!llmApiKey && keyToMigrate) {
    await setTextProviderApiKey(credentialId, keyToMigrate);
    llmApiKey = keyToMigrate;
  }
  if (legacyKey) await clearApiKey();
  state.settings.apiKey = llmApiKey;
  state.settings.speechApiKey = await getSpeechApiKey(region);
  if (!hasRequiredCredentials(
    state.settings.apiKey,
    state.settings.speechApiKey,
  ) || Number(state.settings.onboardingValidationVersion || 0) < 1) {
    state.settings.onboarded = false;
  }

  await save();
  if (migratedLegacy) localStorage.removeItem(KEY);
  await createDailyBackup(exportJSON()).catch(e => console.warn('backup failed', e));
}

export function save() {
  const snapshot = structuredClone(persistableState());
  saveQueue = saveQueue
    .then(() => savePersistedState(snapshot))
    .then(() => { lastPersistenceError = null; })
    .catch((e) => {
      lastPersistenceError = e;
      console.error('save failed', e);
      return writeLocalLog('error', 'storage.save_failed', String(e)).catch(() => undefined);
    });
  return saveQueue;
}

export const flush = () => saveQueue;
export const storageBackend = () => persistenceBackend();
export const storageError = () => lastPersistenceError;

export function exportJSON() {
  return JSON.stringify({ ...persistableState(), exportedAt: new Date().toISOString() }, null, 2);
}
export async function exportToFile() {
  await exportSnapshot(exportJSON());
}
export async function importJSON(txt) {
  const d = JSON.parse(txt);
  if (!d || !Array.isArray(d.items)) throw new Error('格式不对');
  hydrate(migratePersistedState(d));
  const region = normalizeServiceRegion(state.settings.serviceRegion);
  const credentialId = state.settings.providerMode === 'custom'
    ? `custom-${region}`
    : normalizeTextProviderId(state.settings.textProviderId, region);
  state.settings.apiKey = await getTextProviderApiKey(credentialId);
  state.settings.speechApiKey = await getSpeechApiKey(region);
  await save();
}

export async function setProviderConfig(config) {
  const region = normalizeServiceRegion(config.serviceRegion || state.settings.serviceRegion);
  const providerMode = config.providerMode === 'custom' ? 'custom' : 'profile';
  const textProviderId = normalizeTextProviderId(
    config.textProviderId || state.settings.textProviderId,
    region,
  );
  const textProvider = getTextProviderProfile(textProviderId, region);
  const credentialId = providerMode === 'custom'
    ? `custom-${region}`
    : textProviderId;
  await setTextProviderApiKey(credentialId, config.apiKey || '');
  const next = {
    providerMode,
    serviceRegion: region,
    textProviderId,
    apiKey: (config.apiKey || '').trim(),
    protocol: providerMode === 'profile'
      ? textProvider.protocol
      : (config.protocol || 'chat_completions'),
  };
  if (providerMode === 'custom') {
    Object.assign(next, {
      baseUrl: (config.baseUrl || '').trim(),
      model: (config.model || '').trim(),
    });
  } else {
    Object.assign(next, { baseUrl: '', model: '' });
  }
  Object.assign(state.settings, next);
  await save();
}

export async function setServiceRegion(value) {
  const region = normalizeServiceRegion(value);
  const profile = getServiceProfile(region);
  const textProviderId = defaultTextProviderId(region);
  const textProvider = getTextProviderProfile(textProviderId, region);
  Object.assign(state.settings, {
    providerMode: 'profile',
    serviceRegion: region,
    textProviderId,
    baseUrl: '',
    model: '',
    protocol: textProvider.protocol,
    ttsVoice: profile.speech.defaultVoice,
    apiKey: await getTextProviderApiKey(textProviderId),
    speechApiKey: await getSpeechApiKey(region),
  });
  await save();
}

export async function setTextProvider(value) {
  const region = normalizeServiceRegion(state.settings.serviceRegion);
  const textProvider = getTextProviderProfile(value, region);
  Object.assign(state.settings, {
    providerMode: 'profile',
    textProviderId: textProvider.id,
    baseUrl: '',
    model: '',
    protocol: textProvider.protocol,
    apiKey: await getTextProviderApiKey(textProvider.id),
    supportsJsonMode: null,
  });
  await save();
}

export function savedTextProviderApiKey(
  value,
  serviceRegion = state.settings.serviceRegion,
) {
  const region = normalizeServiceRegion(serviceRegion);
  const providerId = normalizeTextProviderId(value, region);
  return getTextProviderApiKey(providerId);
}

export function savedCustomProviderApiKey(value) {
  const region = normalizeServiceRegion(value);
  return getTextProviderApiKey(`custom-${region}`);
}

export function savedSpeechApiKey(value) {
  return getSpeechApiKey(normalizeServiceRegion(value));
}

export async function setSpeechConfig(config) {
  const region = normalizeServiceRegion(config.serviceRegion || state.settings.serviceRegion);
  await setSpeechApiKey(region, config.apiKey || '');
  Object.assign(state.settings, {
    serviceRegion: region,
    voiceMode: normalizeVoiceMode(config.voiceMode),
    speechApiKey: (config.apiKey || '').trim(),
    ttsVoice: (config.ttsVoice || getServiceProfile(region).speech.defaultVoice).trim(),
  });
  await save();
}

export function activeServiceProfile() {
  return getServiceProfile(state.settings.serviceRegion);
}

export function activeProviderConfig() {
  if (state.settings.providerMode === 'custom') {
    return {
      protocol: state.settings.protocol,
      baseUrl: state.settings.baseUrl,
      model: state.settings.model,
    };
  }
  const profile = getTextProviderProfile(
    state.settings.textProviderId,
    state.settings.serviceRegion,
  );
  return {
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.defaultModel,
  };
}

export async function resetAll() {
  await clearPersistedState();
  await clearProfileCredentials();
  localStorage.removeItem(KEY);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const now = () => Date.now();
export const isLive = () => {
  const provider = activeProviderConfig();
  return !!(state.settings.apiKey && provider.baseUrl && provider.model);
};
export const isCloudSpeechReady = () => (
  state.settings.voiceMode === 'cloud' && !!state.settings.speechApiKey
);

export function track(type, detail = '') {
  state.log.push({ at: now(), type, detail });
  if (state.log.length > 500) state.log.shift();
  save();
}
export function recordLlmUsage(task, tokens = 0, ms = 0) {
  state.log.push({ at: now(), type: 'llm_call', task, tokens, ms });
  if (state.log.length > 500) state.log.shift();
  save();
}
export function llmUsage() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1).getTime();
  const calls = state.log.filter(entry => entry.type === 'llm_call');
  return {
    todayCalls: calls.filter(entry => entry.at >= startOfDay.getTime()).length,
    monthCalls: calls.filter(entry => entry.at >= startOfMonth).length,
    monthTokens: calls
      .filter(entry => entry.at >= startOfMonth)
      .reduce((sum, entry) => sum + Number(entry.tokens || 0), 0),
  };
}

/* ---------------- item factory ---------------- */
/* trust: 3 = 真实听到的（已被真人使用过，最可信）
          2 = 从我自己的表达被纠正而来（贴合我的真实需求）
          1 = 模型主动提议（最不可信，最容易是「LLM 味」） */
export const TRUST_BY_SRC = {
  heard: 3,
  mine: 2,
  zh: 1,
  fragment: 3,
  preflight: 1,
  compress: 2,
  recommendation: 1,
};

export function makeItem(o) {
  const createdAt = Number(o.createdAt) || now();
  return normalizeLearningItem({
    id: uid(),
    kind: normalizeLearningItemKind(o.kind),
    skeleton: o.skeleton,           // "The bottleneck has shifted from X to Y"
    zh: o.zh || '',
    lemma: o.lemma || '',
    sense: o.sense || '',
    collocations: o.collocations || [],
    anchorSentence: o.anchorSentence || '',
    relatedExpressionIds: o.relatedExpressionIds || [],
    domainTags: o.domainTags || [],
    trigger: o.trigger || '',       // 出现什么信号时，为了什么沟通意图调用它
    why: o.why || '',
    register: o.register || 'meeting',
    tags: o.tags || [],
    source: { kind: o.srcKind || 'zh', raw: o.raw || '', at: now() },
    trust: TRUST_BY_SRC[o.srcKind] ?? 1,
    seeds: o.seeds || [],           // 模型给的迁移例句（参考，不算我的）
    drill: o.drill || null,         // 具体造句任务 {brief, target_zh, answer?}
    mine: [],                       // 我自己造的句子 {text, at, ctx}
    box: 0,
    dueAt: Number.isFinite(o.dueAt) ? Number(o.dueAt) : createdAt,
    reviewNotBefore: Number.isFinite(o.reviewNotBefore)
      ? Number(o.reviewNotBefore)
      : 0,
    lastAt: 0,
    history: [],                    // {at, ok, answer, ms, ctx, why}
    usedReal: [],                   // {at, scenario}  ← 真实世界证据
    status: 'learning',
    createdAt,
  });
}

export function normalizeSkeleton(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[^\p{L}\p{N}'\[\]]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function findItemBySkeleton(skeleton, kind = 'expression') {
  const signature = learningItemKey({
    kind,
    skeleton,
    lemma: kind === 'term' ? skeleton : '',
  });
  if (!signature) return undefined;
  return state.items.find(item => learningItemKey(item) === signature);
}

export function addItem(o) {
  const normalized = normalizeLearningItem({
    ...o,
    kind: normalizeLearningItemKind(o.kind),
  });
  const existing = findItemBySkeleton(
    normalized.skeleton,
    normalized.kind,
  );
  if (existing) {
    if (existing.status === 'retired') revive(existing.id);
    return existing;
  }

  const createdAt = now();
  const delayDays = initialReviewDelayDays(
    newThisWeek(),
    WEEKLY_NEW_TARGET,
  );
  const reviewNotBefore = delayDays
    ? createdAt + delayDays * 86_400_000
    : 0;
  const it = makeItem({
    ...normalized,
    createdAt,
    dueAt: reviewNotBefore || createdAt,
    reviewNotBefore,
  });
  state.items.unshift(it); track('capture'); save();
  return it;
}
export function getItem(id) { return state.items.find(i => i.id === id); }
export function setItemDrill(id, drill) {
  const it = getItem(id);
  const brief = String(drill?.brief || '').trim();
  const targetZh = String(drill?.target_zh || '').trim();
  const answer = String(drill?.answer || '').trim();
  const trigger = String(drill?.trigger || it?.trigger || '').trim();
  if (!it) throw new Error('找不到要更新的表达');
  if (!brief || !targetZh || !answer) throw new Error('模型没有生成完整的迁移练习');
  it.drill = { brief, target_zh: targetZh, answer };
  it.trigger = trigger;
  track('review_cue_regenerated', id);
  return it.drill;
}
export function retire(id) {
  const it = getItem(id); if (!it) return;
  it.status = 'retired'; it.dueAt = Infinity; save();
}
export function revive(id) {
  const it = getItem(id); if (!it) return;
  it.status = 'learning'; it.box = Math.max(0, it.box - 1); it.dueAt = now(); save();
}

/* ---------------- 闪存（zero-friction capture） ----------------
   捕获是「一闪而过的念头」，所以捕获路径上不许有任何东西：
   不分析、不联网、不做决定、不答题。存下来 = 2 秒，然后你就可以走了。
   分析和答题都属于「处理」，是另一个动作，发生在你有 3 分钟的时候。 */
export function addFlash(text, mode, source = 'app') {
  if (!text || !text.trim()) return null;
  const f = {
    id: uid(),
    text: text.trim(),
    at: now(),
    mode: mode || null,
    source,
    status: 'raw',
    failReason: '',
  };
  state.inbox.unshift(f);
  if (source === 'app') state.drafts.quickCapture = '';
  track('flash');
  return f;
}
export async function saveQuickCapture(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const previousDraft = state.drafts.quickCapture;
  const previousLogLength = state.log.length;
  const flash = addFlash(value);
  await flush();
  if (!lastPersistenceError) return flash;

  state.inbox = state.inbox.filter(candidate => candidate.id !== flash.id);
  state.drafts.quickCapture = previousDraft || value;
  state.log.length = previousLogLength;
  save();
  throw lastPersistenceError;
}
export function dropFlash(id) { state.inbox = state.inbox.filter(f => f.id !== id); save(); }
export function getFlash(id) { return state.inbox.find(f => f.id === id); }
export function updateFlashText(id, text) {
  const flash = getFlash(id);
  if (!flash) return null;
  const value = String(text || '');
  if (flash.text === value) return flash;
  flash.text = value;
  flash.status = 'raw';
  flash.failReason = '';
  delete flash.analysis;
  delete flash.processedAt;
  delete flash.processedResult;
  delete flash.linkedItemIds;
  save();
  return flash;
}
export function markFlashHandled(id, itemId = '', /** @type {any} */ processedResult = null) {
  const flash = getFlash(id);
  if (!flash) return null;
  const linked = new Set(Array.isArray(flash.linkedItemIds) ? flash.linkedItemIds : []);
  if (itemId) linked.add(itemId);
  flash.linkedItemIds = [...linked];
  if (processedResult) flash.processedResult = processedResult;
  flash.status = 'handled';
  flash.failReason = '';
  flash.processedAt = now();
  save();
  return flash;
}
const DRAFT_KINDS = new Set(['quickCapture', 'expression', 'compression', 'preflight']);
export function getDraft(kind) {
  if (!DRAFT_KINDS.has(kind)) throw new Error('未知草稿类型');
  return state.drafts[kind] || '';
}
export function setDraft(kind, value) {
  if (!DRAFT_KINDS.has(kind)) throw new Error('未知草稿类型');
  state.drafts[kind] = String(value || '');
  save();
  return state.drafts[kind];
}
export function clearDraft(kind) {
  return setDraft(kind, '');
}
export function saveDraft(value) {
  return setDraft('quickCapture', value);
}
export function setFlashStatus(id, status, failReason = '') {
  const flash = getFlash(id);
  if (!flash) return;
  flash.status = normalizeRecordStatus(status);
  flash.failReason = failReason;
  if (flash.status === 'analyzing') {
    delete flash.processedAt;
    delete flash.processedResult;
  }
  save();
}
export function completeFlash(id, analysis) {
  const flash = getFlash(id);
  if (!flash) return;
  flash.status = 'ready';
  flash.failReason = '';
  flash.analysis = analysis;
  delete flash.processedAt;
  delete flash.processedResult;
  save();
}
export function pendingFlashes(limit = 3) {
  return state.inbox
    .filter(f => f.status === 'raw' || f.status === 'failed')
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
}

const TOOL_KINDS = new Set(['compression', 'preflight']);
function toolTask(kind) {
  if (!TOOL_KINDS.has(kind)) throw new Error('未知工具任务');
  if (!state.toolTasks[kind]) state.toolTasks[kind] = emptyToolTask();
  return state.toolTasks[kind];
}
export function getToolTask(kind) {
  return toolTask(kind);
}
export function setToolTaskSource(kind, source = null) {
  const task = toolTask(kind);
  task.source = source;
  task.updatedAt = now();
  save();
  return task;
}
export function updateToolTaskInput(kind, input, source) {
  const task = toolTask(kind);
  const value = String(input || '');
  const sourceChanged = source
    && (task.source?.kind !== source.kind || task.source?.id !== source.id);
  if (task.input === value && !sourceChanged) return task;
  Object.assign(task, {
    status: 'idle',
    input: value,
    result: null,
    resultId: '',
    error: '',
    source: source || task.source,
    startedAt: 0,
    updatedAt: now(),
  });
  save();
  return task;
}
export function beginToolTask(kind, input, source) {
  const task = toolTask(kind);
  Object.assign(task, {
    status: 'running',
    input: String(input || ''),
    result: null,
    resultId: '',
    error: '',
    source: source || task.source,
    startedAt: now(),
    updatedAt: now(),
  });
  save();
  return task;
}
export function completeToolTask(kind, result, resultId = '') {
  const task = toolTask(kind);
  Object.assign(task, {
    status: 'ready',
    result: result ?? null,
    resultId: String(resultId || ''),
    error: '',
    updatedAt: now(),
  });
  save();
  return task;
}
export function failToolTask(kind, error) {
  const task = toolTask(kind);
  Object.assign(task, {
    status: 'failed',
    error: String(error || ''),
    updatedAt: now(),
  });
  save();
  return task;
}
export function resetToolTask(kind, input = '') {
  const task = toolTask(kind);
  const source = task.source;
  state.toolTasks[kind] = {
    ...emptyToolTask(),
    input: String(input || ''),
    source,
    updatedAt: now(),
  };
  save();
  return state.toolTasks[kind];
}
export function addNotificationReplies(replies) {
  const known = new Set(state.notificationReplies.map(reply => `${reply.itemId}:${reply.receivedAt}`));
  for (const reply of replies) {
    const key = `${reply.itemId}:${reply.receivedAt}`;
    if (!known.has(key)) state.notificationReplies.push(reply);
  }
  state.notificationReplies.sort((a, b) => a.receivedAt - b.receivedAt);
  save();
}
export function removeNotificationReply(itemId, answer) {
  const index = state.notificationReplies.findIndex(reply =>
    reply.itemId === itemId && reply.answer === answer);
  if (index >= 0) state.notificationReplies.splice(index, 1);
  save();
}

export function recordCompressionPracticeAttempt(recordId, value) {
  const record = state.compressions.find(candidate => candidate.id === recordId);
  if (!record) throw new Error('找不到这次精简记录');
  const attempts = Array.isArray(record.practiceAttempts)
    ? record.practiceAttempts
    : (record.practiceAttempts = []);
  if (attempts.length >= 2) return record;
  attempts.push({
    id: String(value?.id || uid()),
    at: Number(value?.at) || now(),
    answer: String(value?.answer || '').trim(),
    rawTranscript: String(value?.rawTranscript || '').trim(),
    revised: Boolean(value?.revised),
    promptUsed: Boolean(value?.promptUsed),
    inputMode: value?.inputMode === 'voice' || value?.inputMode === 'text'
      ? value.inputMode
      : 'unknown',
    ok: Boolean(value?.ok),
    feedbackKind: ['keep', 'correct', 'optional'].includes(value?.feedbackKind)
      ? value.feedbackKind
      : 'keep',
    mainIssue: String(value?.mainIssue || '').trim(),
    fix: String(value?.fix || '').trim(),
    tighter: String(value?.tighter || '').trim(),
    verdict: String(value?.verdict || '').trim(),
    note: String(value?.note || '').trim(),
  });
  track('compression_restatement', record.id);
  save();
  return record;
}

export function updateCompressionPracticeDraft(
  recordId,
  value,
  { promptUsed = false } = {},
) {
  const record = state.compressions.find(candidate => candidate.id === recordId);
  if (!record) return null;
  record.practiceDraft = String(value || '');
  record.practicePromptUsed = Boolean(record.practicePromptUsed || promptUsed);
  save();
  return record;
}

/* ---------------- 每周建议量与错峰 ---------------- */
export function newThisWeek() {
  const t = now() - WEEK;
  return state.items.filter(i => i.createdAt > t && i.status !== 'retired').length;
}
export function weeklyTargetLeft() {
  return Math.max(0, WEEKLY_NEW_TARGET - newThisWeek());
}
export function nextItemReviewDelayDays() {
  return initialReviewDelayDays(newThisWeek(), WEEKLY_NEW_TARGET);
}
/* ---------------- 今日推荐 ---------------- */
export function todayRecommendationDeck(date = new Date()) {
  const deck = normalizeDailyRecommendationDeck(state.dailyRecommendations);
  return deck?.date === localDateKey(date) ? deck : null;
}

export async function saveDailyRecommendations(items) {
  const deck = createDailyRecommendationDeck({
    items,
    idFactory: uid,
  });
  state.dailyRecommendations = deck;
  track('recommendations_generated');
  await save();
  return deck;
}

export function setRecommendationIndex(index) {
  const deck = todayRecommendationDeck();
  if (!deck) return null;
  deck.currentIndex = recommendationIndex(deck, index);
  state.dailyRecommendations = deck;
  save();
  return deck;
}

export function markRecommendationCollected(recommendationId, itemId) {
  const deck = todayRecommendationDeck();
  const recommendation = deck?.items.find(item => item.id === recommendationId);
  if (!recommendation) return;
  recommendation.collectedItemId = itemId;
  state.dailyRecommendations = deck;
  track('recommendation_collected');
  save();
}

export function markRecommendationPracticed(recommendationId, practicedAt = now()) {
  const deck = todayRecommendationDeck();
  const recommendation = deck?.items.find(item => item.id === recommendationId);
  if (!recommendation) return null;
  recommendation.practicedAt = Math.max(
    Number(recommendation.practicedAt) || 0,
    Number(practicedAt) || now(),
  );
  state.dailyRecommendations = deck;
  track('recommendation_practiced');
  save();
  return deck;
}

/* ---------------- Level 4 情境对话 ---------------- */
export function activeRoleplaySession(itemId) {
  return [...state.roleplaySessions]
    .reverse()
    .find(session => (
      session.itemId === itemId
      && (!session.completedAt || session.retryActive)
    ))
    || null;
}

export function createRoleplaySession(itemId, opening) {
  const item = getItem(itemId);
  if (!item) throw new Error('找不到要练习的表达');
  const existing = activeRoleplaySession(itemId);
  if (existing) return existing;
  const timestamp = now();
  const session = createRoleplaySessionRecord({
    id: uid(),
    itemId,
    now: timestamp,
    role: opening?.role,
    scenario: opening?.scenario,
    opening: opening?.opening,
  });
  state.roleplaySessions.push(session);
  if (state.roleplaySessions.length > 100) state.roleplaySessions.shift();
  track('roleplay_started', itemId);
  save();
  return session;
}

export function addRoleplayTurn(sessionId, speaker, value) {
  const index = state.roleplaySessions.findIndex(candidate => candidate.id === sessionId);
  if (index < 0) throw new Error('找不到这次情境对话');
  const session = appendRoleplayTurn(
    state.roleplaySessions[index],
    speaker,
    value,
    now(),
  );
  state.roleplaySessions[index] = session;
  save();
  return session;
}

export function completeRoleplaySession(sessionId, rawResult) {
  const session = state.roleplaySessions.find(candidate => candidate.id === sessionId);
  if (!session) throw new Error('找不到这次情境对话');
  if (session.result) return session;
  if (session.turns.length !== 4) throw new Error('请先完成两轮回答');
  const item = getItem(session.itemId);
  if (!item) throw new Error('找不到要练习的表达');

  const result = normalizeRoleplayResult(rawResult);
  const completedAt = now();
  const targetSucceeded = roleplayTargetSucceeded(result);
  const communicationPassed = roleplayCommunicationPassed(result);
  const lastPassedAt = [...item.history].reverse().find(entry => entry.ok)?.at || 0;
  const next = nextRoleplayReview(item, result, completedAt, lastPassedAt);
  const answers = session.turns
    .filter(turn => turn.speaker === 'user')
    .map(turn => turn.text);

  session.result = result;
  session.completedAt = completedAt;
  item.history.push({
    at: completedAt,
    kind: 'roleplay',
    ok: targetSucceeded,
    communicationOk: communicationPassed,
    answer: answers.join(' / '),
    ms: completedAt - session.startedAt,
    ctx: session.scenario,
    why: result.note || result.verdict,
  });
  item.lastAt = completedAt;
  item.box = next.box;
  item.dueAt = next.dueAt;
  recomputeStatus(item);
  track(
    targetSucceeded
      ? 'roleplay_target_ok'
      : communicationPassed
        ? 'roleplay_communication_ok'
        : 'roleplay_miss',
    item.id,
  );
  save();
  return session;
}

export function startRoleplayRetry(sessionId) {
  const session = state.roleplaySessions.find(candidate => candidate.id === sessionId);
  if (!session?.result) return null;
  const attempts = Array.isArray(session.retryAttempts)
    ? session.retryAttempts
    : (session.retryAttempts = []);
  if (attempts.length >= 2) return null;
  session.retryActive = true;
  save();
  return session;
}

export function updateRoleplayRetryDraft(
  sessionId,
  value,
  { promptUsed = false } = {},
) {
  const session = state.roleplaySessions.find(candidate => candidate.id === sessionId);
  if (!session?.result || !session.retryActive) return session || null;
  session.retryDraft = String(value || '');
  session.retryPromptUsed = Boolean(session.retryPromptUsed || promptUsed);
  save();
  return session;
}

export function pauseRoleplayRetry(sessionId) {
  const session = state.roleplaySessions.find(candidate => candidate.id === sessionId);
  if (!session?.result) return session || null;
  session.retryActive = false;
  save();
  return session;
}

export function completeRoleplayRetry(sessionId, value) {
  const session = state.roleplaySessions.find(candidate => candidate.id === sessionId);
  if (!session?.result || !session.retryActive) return session || null;
  const attempts = Array.isArray(session.retryAttempts)
    ? session.retryAttempts
    : (session.retryAttempts = []);
  if (attempts.length >= 2) return session;
  attempts.push({
    id: uid(),
    turn: Number(session.result.retryTurn) === 1 ? 1 : 2,
    answer: String(value?.answer || '').trim(),
    inputMode: value?.inputMode === 'voice' || value?.inputMode === 'text'
      ? value.inputMode
      : 'unknown',
    rawTranscript: String(value?.rawTranscript || '').trim(),
    promptUsed: Boolean(session.retryPromptUsed),
    ok: Boolean(value?.ok),
    judgement: value?.judgement || null,
    at: now(),
  });
  session.retryDraft = '';
  session.retryActive = false;
  track('roleplay_retry', session.id);
  save();
  return session;
}

/* ---------------- 普通练习会话 ---------------- */
export function getPracticeSession(sessionId) {
  return state.practiceSessions.find(session => session.id === sessionId) || null;
}

export function activePracticeSession(itemId, source, sourceId = '') {
  const key = practiceSessionKey(itemId, source, sourceId);
  return [...state.practiceSessions]
    .reverse()
    .find(session => (
      !session.completedAt
      && practiceSessionKey(session.itemId, session.source, session.sourceId) === key
    )) || null;
}

export function latestPracticeSession(sources = []) {
  const allowed = new Set(Array.isArray(sources) ? sources : [sources]);
  return [...state.practiceSessions]
    .reverse()
    .find(session => (
      !session.completedAt
      && (!allowed.size || allowed.has(session.source))
    )) || null;
}

export function expiredRecommendationPracticeSession(date = new Date()) {
  const session = latestPracticeSession('recommendation');
  const startedAt = Number(session?.startedAt) || 0;
  if (
    !session
    || !startedAt
    || localDateKey(new Date(startedAt)) === localDateKey(date)
  ) {
    return null;
  }
  return session;
}

export function ensurePracticeSession(itemId, options = {}) {
  const item = getItem(itemId);
  if (!item) throw new Error('找不到要练习的表达');
  const source = String(options.source || 'practice').trim();
  const sourceId = String(options.sourceId || '').trim();
  const existing = activePracticeSession(itemId, source, sourceId);
  if (existing) return existing;

  const timestamp = now();
  const session = createPracticeSessionRecord({
    id: uid(),
    itemId,
    source,
    sourceId,
    now: timestamp,
    cue: options.cue,
    answer: options.answer,
  });
  state.practiceSessions.push(session);
  if (state.practiceSessions.length > 200) {
    const completedIndex = state.practiceSessions.findIndex(candidate => candidate.completedAt);
    state.practiceSessions.splice(completedIndex >= 0 ? completedIndex : 0, 1);
  }
  track('practice_started', `${itemId}:${source}`);
  save();
  return session;
}

export function updatePracticeCue(sessionId, cue) {
  const session = getPracticeSession(sessionId);
  if (!session) throw new Error('找不到这次练习');
  if (session.completedAt) return session;
  session.cue = {
    brief: String(cue?.brief || '').trim(),
    context: String(cue?.context ?? cue?.ctx ?? '').trim(),
    targetZh: String(cue?.targetZh ?? cue?.target_zh ?? '').trim(),
    trigger: String(cue?.trigger || '').trim(),
  };
  session.updatedAt = now();
  save();
  return session;
}

export function updatePracticeDraft(sessionId, value) {
  const session = getPracticeSession(sessionId);
  if (!session) throw new Error('找不到这次练习');
  if (session.completedAt) return session;
  session.answerDraft = String(value || '');
  session.updatedAt = now();
  save();
  return session;
}

export function startPracticeRetry(sessionId) {
  const session = getPracticeSession(sessionId);
  if (!session) throw new Error('找不到这次练习');
  if (!session.settlement || session.completedAt) return null;
  const retryCount = session.attempts.filter(
    attempt => attempt.kind === 'retry' && attempt.status === 'judged',
  ).length;
  if (retryCount >= 2) return null;
  if (session.phase !== 'answering') session.answerDraft = '';
  session.retryCount = retryCount;
  session.phase = 'answering';
  session.updatedAt = now();
  save();
  return session;
}

export function markPracticePromptUsed(sessionId) {
  const session = getPracticeSession(sessionId);
  if (!session || session.completedAt) return session || null;
  session.promptUsed = true;
  session.updatedAt = now();
  save();
  return session;
}

export function beginPracticeAttempt(sessionId, options = {}) {
  const session = getPracticeSession(sessionId);
  if (!session) throw new Error('找不到这次练习');
  if (session.completedAt) throw new Error('这次练习已经结束');
  if (session.attempts.some(attempt => attempt.status === 'submitting')) {
    return null;
  }
  const answer = String(options.answer ?? session.answerDraft ?? '');
  const timestamp = now();
  const requestedKind = options.kind === 'retry' || options.kind === 'reveal'
    ? options.kind
    : '';
  const kind = requestedKind || (session.settlement ? 'retry' : 'initial');
  if (session.settlement && kind !== 'retry') return null;
  if (
    kind === 'retry'
    && session.attempts.filter(
      candidate => candidate.kind === 'retry' && candidate.status === 'judged',
    ).length >= 2
  ) {
    return null;
  }
  const attempt = {
    id: uid(),
    kind,
    status: 'submitting',
    answer,
    rawTranscript: String(options.rawTranscript || ''),
    confirmedText: answer,
    revised: Boolean(
      options.rawTranscript
      && String(options.rawTranscript).trim() !== answer.trim()
    ),
    revisedAt: 0,
    revisionStatus: 'none',
    promptUsed: Boolean(options.promptUsed || session.promptUsed),
    judgementSource: options.judgementSource === 'self' ? 'self' : 'model',
    inputMode: options.inputMode === 'voice' || options.inputMode === 'text'
      ? options.inputMode
      : 'unknown',
    startedAt: timestamp,
    completedAt: 0,
    error: '',
    judgement: null,
    feedback: null,
  };
  session.answerDraft = answer;
  session.attempts.push(attempt);
  session.phase = 'submitting';
  session.updatedAt = timestamp;
  save();
  return attempt;
}

export function failPracticeAttempt(sessionId, attemptId, error) {
  const session = getPracticeSession(sessionId);
  const attempt = session?.attempts.find(candidate => candidate.id === attemptId);
  if (!session || !attempt || session.completedAt) return session || null;
  attempt.status = 'error';
  attempt.completedAt = now();
  attempt.error = String(error || '');
  session.phase = 'answering';
  session.updatedAt = attempt.completedAt;
  save();
  return session;
}

export function settlePracticeAttempt(sessionId, attemptId, ok, payload = {}) {
  const session = getPracticeSession(sessionId);
  if (!session) throw new Error('找不到这次练习');
  const attempt = session.attempts.find(candidate => candidate.id === attemptId);
  if (!attempt || !['submitting', 'error'].includes(attempt.status)) {
    if (attempt?.status === 'judged') return session;
    throw new Error('找不到可结算的练习尝试');
  }
  if (session.settlement && attempt.kind !== 'retry') return session;
  const item = getItem(session.itemId);
  if (!item) throw new Error('找不到要练习的表达');

  const completedAt = now();
  attempt.status = 'judged';
  attempt.completedAt = completedAt;
  attempt.error = '';
  attempt.judgement = payload.judgement || null;
  attempt.feedback = payload.feedback || null;
  attempt.judgementSource = payload.judgementSource === 'self'
    ? 'self'
    : attempt.judgementSource;
  if (attempt.kind === 'retry') {
    session.retryCount = session.attempts.filter(
      candidate => candidate.kind === 'retry' && candidate.status === 'judged',
    ).length;
    session.phase = 'feedback';
    session.updatedAt = completedAt;
    save();
    return session;
  }

  const before = practiceItemSnapshot(item);
  applyGradeToItem(item, !!ok, {
    answer: attempt.answer,
    ms: payload.ms || Math.max(0, completedAt - attempt.startedAt),
    ctx: payload.ctx || session.cue.context,
    why: payload.why || '',
    sessionId: session.id,
    attemptId: attempt.id,
  }, completedAt);
  session.settlement = {
    attemptId: attempt.id,
    appliedAt: completedAt,
    passed: !!ok,
    before,
    after: practiceItemSnapshot(item),
  };
  session.phase = attempt.kind === 'reveal' ? 'revealed' : 'feedback';
  session.updatedAt = completedAt;
  track(ok ? 'recall_ok' : 'recall_miss');
  track(ok ? 'practice_settled_ok' : 'practice_settled_miss', session.id);
  save();
  return session;
}

function samePracticeSchedule(item, snapshot) {
  return Number(item.box) === Number(snapshot.box)
    && Number(item.dueAt) === Number(snapshot.dueAt)
    && Number(item.reviewNotBefore || 0) === Number(snapshot.reviewNotBefore || 0)
    && Number(item.lastAt || 0) === Number(snapshot.lastAt || 0);
}

function restorePracticeSnapshot(item, snapshot) {
  item.box = snapshot.box;
  item.dueAt = snapshot.dueAt;
  item.reviewNotBefore = snapshot.reviewNotBefore;
  item.status = snapshot.status;
  item.lastAt = snapshot.lastAt;
}

export function revisePracticeAttempt(
  sessionId,
  attemptId,
  revisedAnswer,
  ok,
  payload = {},
) {
  const session = getPracticeSession(sessionId);
  const attempt = session?.attempts.find(candidate => candidate.id === attemptId);
  if (!session || !attempt || attempt.status !== 'judged' || session.completedAt) {
    return session || null;
  }
  const answer = String(revisedAnswer || '').trim();
  if (!answer) throw new Error('修订后的文字不能为空');
  const previousAnswer = attempt.answer;
  attempt.answer = answer;
  attempt.confirmedText = answer;
  attempt.revised = true;
  attempt.revisedAt = now();
  attempt.judgement = payload.judgement || null;
  attempt.feedback = payload.feedback || null;
  attempt.judgementSource = 'model';
  attempt.revisionStatus = 'applied';

  if (session.settlement?.attemptId === attempt.id) {
    const item = getItem(session.itemId);
    if (!item) throw new Error('找不到要练习的表达');
    const history = Array.isArray(item.history) ? item.history : [];
    const historyIndex = history.findIndex(
      entry => entry.sessionId === session.id && entry.attemptId === attempt.id,
    );
    const hasLaterGrade = historyIndex >= 0 && historyIndex < history.length - 1;
    if (
      historyIndex < 0
      || hasLaterGrade
      || !samePracticeSchedule(item, session.settlement.after)
    ) {
      attempt.revisionStatus = 'schedule_pending';
    } else {
      restorePracticeSnapshot(item, session.settlement.before);
      history.splice(historyIndex, 1);
      const mine = Array.isArray(item.mine) ? item.mine : [];
      const mineIndex = mine.findIndex(entry => (
        Number(entry.at) === Number(session.settlement.appliedAt)
        && entry.text === previousAnswer
      ));
      if (mineIndex >= 0) mine.splice(mineIndex, 1);
      applyGradeToItem(item, !!ok, {
        answer,
        ms: payload.ms || Math.max(0, attempt.completedAt - attempt.startedAt),
        ctx: payload.ctx || session.cue.context,
        why: payload.why || '',
        sessionId: session.id,
        attemptId: attempt.id,
      }, session.settlement.appliedAt);
      session.settlement.passed = !!ok;
      session.settlement.after = practiceItemSnapshot(item);
    }
  }
  session.answerDraft = answer;
  session.phase = 'feedback';
  session.updatedAt = attempt.revisedAt;
  save();
  return session;
}

export function completePracticeSession(sessionId) {
  const session = getPracticeSession(sessionId);
  if (!session) return null;
  if (!session.settlement || session.completedAt) return session;
  session.completedAt = now();
  session.updatedAt = session.completedAt;
  session.phase = 'completed';
  track('practice_completed', session.id);
  save();
  return session;
}

/* ---------------- 调度 ---------------- */
export function live() { return state.items.filter(i => i.status !== 'retired'); }

export function dueItems() {
  const t = now();
  return live()
    .filter(i => i.dueAt <= t)
    .sort((a, b) => {
      // 从没被自己造过句的优先（首次产出是最关键的一步）
      const fa = a.mine.length === 0 ? 0 : 1, fb = b.mine.length === 0 ? 0 : 1;
      if (fa !== fb) return fa - fb;
      // 其次：可信度高的优先（真实听到的 > 模型编的）
      if (a.trust !== b.trust) return b.trust - a.trust;
      return a.dueAt - b.dueAt;                    // 再按到期时间
    });
}
export function nextDue() { return dueItems()[0] || null; }

/* 成功 → 上一格；失败 → 退一格，8 小时后再来 */
function applyGradeToItem(it, ok, payload = {}, gradedAt = now()) {
  const history = Array.isArray(it.history) ? it.history : (it.history = []);
  const mine = Array.isArray(it.mine) ? it.mine : (it.mine = []);
  const firstAttempt = history.length === 0;
  const reviewNotBefore = firstAttempt
    ? Math.max(0, Number(it.reviewNotBefore) || 0)
    : 0;
  const lastPassedAt = [...history].reverse().find(entry => entry.ok)?.at || 0;
  const event = {
    at: gradedAt,
    ok: !!ok,
    answer: payload.answer || '',
    ms: payload.ms || 0,
    ctx: payload.ctx || '',
    why: payload.why || '',
  };
  if (payload.sessionId) event.sessionId = payload.sessionId;
  if (payload.attemptId) event.attemptId = payload.attemptId;
  history.push(event);
  if (payload.answer) {
    mine.push({ text: payload.answer, at: gradedAt, ctx: payload.ctx || '' });
  }
  it.lastAt = gradedAt;
  const next = nextReview(it, !!ok, gradedAt, lastPassedAt);
  it.box = next.box;
  it.dueAt = applyReviewNotBefore(next, reviewNotBefore).dueAt;
  if (firstAttempt) it.reviewNotBefore = 0;
  recomputeStatus(it);
  return it;
}

export function grade(id, ok, payload = {}) {
  const it = getItem(id); if (!it) return null;
  applyGradeToItem(it, ok, payload);
  track(ok ? 'recall_ok' : 'recall_miss');
  save();
  return it;
}

/* 「已内化」的判据，故意严格且必须有真实使用：
   - 阶梯到 4 档以上（>= 21 天间隔仍答得出）
   - 至少 2 次成功召回
   - 至少 1 次真实场景使用（自己打卡）
   模型评分永远不能单独把一条判为已内化。 */
export function recomputeStatus(it) {
  it.status = isOwned(it.box, it.usedReal.length)
    ? 'owned'
    : (it.status === 'retired' ? 'retired' : 'learning');
  return it.status;
}
export function markUsedReal(id, scenario) {
  const it = getItem(id); if (!it) return;
  it.usedReal.push({ at: now(), scenario: scenario || '' });
  recomputeStatus(it); track('used_real'); save();
}

/* ---------------- 指标：只有两个 ---------------- */
export function metrics() {
  const l = live();
  const owned = l.filter(i => i.status === 'owned').length;
  const realUses = l.reduce((s, i) => s + i.usedReal.length, 0);
  const t7 = now() - WEEK;
  const recall7 = state.log.filter(x => x.at > t7 && x.type.startsWith('recall')).length;
  const ok7 = state.log.filter(x => x.at > t7 && x.type === 'recall_ok').length;
  return {
    owned, realUses, total: l.length,
    learning: l.filter(i => i.status === 'learning').length,
    due: dueItems().length,
    recall7, ok7,
    hitRate: recall7 ? Math.round(ok7 / recall7 * 100) : 0,
    newThisWeek: newThisWeek(),
    inbox: state.inbox.length,
  };
}

/* 进化对照：找出「我自己说过的原话」→「现在的骨架 + 我最新的造句」 */
export function evolutionPairs(limit = 6) {
  return live()
    .filter(i => ['mine', 'compress'].includes(i.source.kind) && i.source.raw && i.mine.length)
    .sort((a, b) => b.mine[b.mine.length - 1].at - a.mine[a.mine.length - 1].at)
    .slice(0, limit)
    .map(i => ({ item: i, before: i.source.raw, after: i.mine[i.mine.length - 1].text, days: Math.round((now() - i.createdAt) / 864e5) }));
}

/* 与场景相关的已有骨架（本地打分，不烧 token） */
export function relevantItems(scenario, n = 6) {
  const q = (scenario || '').toLowerCase();
  const toks = q.split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(w => w.length > 1);
  return live().map(i => {
    const hay = (
      i.skeleton
      + ' ' + i.zh
      + ' ' + (i.trigger || '')
      + ' ' + i.tags.join(' ')
      + ' ' + i.seeds.join(' ')
    ).toLowerCase();
    let s = 0;
    toks.forEach(t => { if (hay.includes(t)) s += 2; });
    if (i.dueAt <= now()) s += 1.2;                 // 顺手把到期的一起带上
    if (i.status === 'learning') s += 0.6;
    s += i.trust * 0.25;
    return { i, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.i);
}
