/* =========================================================================
   store.js — 数据模型 / 持久化 / 调度
   设计原则（与实习生方案的关键差异）：
   1) 学习单元 = 可复用「骨架」，不是句子、不是单词。
   2) 调度刻意做「笨」：固定阶梯 0/1/3/7/21/60 天。150 条/年的量级下，
      精调 FSRS 的收益远小于它带来的不可校准的魔法参数成本。
   3) 「已内化(owned)」必须有真实场景使用证据，模型打分不能单独授予。
   4) 每周新收编硬预算 = 3 条（老师原话）。超了必须先淘汰一条。稀缺是功能。
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
  setLlmApiKey,
  setSpeechApiKey,
} from '../src/platform/secure.ts';
import { LADDER_DAYS, isOwned, nextReview } from '../src/core/scheduler.ts';
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

const KEY = 'sayable.v1';
const WEEK = 7 * 864e5;
const DEFAULT_PROFILE = getServiceProfile(DEFAULT_SERVICE_REGION);

/* 间隔阶梯：天。box 5 = 毕业候选 */
export const LADDER = [...LADDER_DAYS];
export const WEEKLY_NEW_BUDGET = 3;

export const state = {
  profile: {
    name: '', role: '', org: '', goal: '',
    domains: [], counterparts: [], scenarios: [], upcoming: '',
    variety: 'international', englishLevel: null,
  },
  items: [],
  inbox: [],            // 闪存：只存原文，不分析、不联网、不问问题
  draft: '',            // 输入草稿：被打断也不会丢
  notificationReplies: [],
  compressions: [],
  dailyRecommendations: null,
  settings: {
    providerMode: 'profile',
    serviceRegion: DEFAULT_SERVICE_REGION,
    voiceMode: DEFAULT_VOICE_MODE,
    onboardingValidationVersion: 0,
    baseUrl: '',
    apiKey: '',          // 仅驻留内存；持久化时剔除，原生端写入 Keystore
    speechApiKey: '',    // 与 LLM Key 分开存放，可按区域独立切换
    model: '',
    protocol: DEFAULT_PROFILE.llm.protocol,
    ttsVoice: DEFAULT_PROFILE.speech.defaultVoice,
    remindAt: '21:30',
    notificationsEnabled: false,
    notificationsEnabledAt: 0,
    quietStart: '23:00',
    quietEnd: '08:00',
    dailyLimit: 60,
    maxTokens: 1600,
    timeoutMs: 30000,
    maxRetry: 3,
    supportsJsonMode: null,
    onboarded: false,
  },
  log: [],            // {at, type}
};

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
    draft: state.draft,
    notificationReplies: state.notificationReplies,
    compressions: state.compressions,
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
    const profile = getServiceProfile(state.settings.serviceRegion);
    Object.assign(state.settings, {
      providerMode: 'profile',
      baseUrl: '',
      model: '',
      protocol: profile.llm.protocol,
      ttsVoice: state.settings.ttsVoice || profile.speech.defaultVoice,
    });
  }
  state.items = Array.isArray(d?.items) ? d.items : [];
  state.inbox = (Array.isArray(d?.inbox) ? d.inbox : []).map(f => ({
    status: 'raw',
    failReason: '',
    source: 'app',
    ...f,
    status: f.status === 'analyzing' ? 'raw' : (f.status || 'raw'),
  }));
  state.draft = d?.draft || '';
  state.notificationReplies = Array.isArray(d?.notificationReplies) ? d.notificationReplies : [];
  state.compressions = Array.isArray(d?.compressions) ? d.compressions : [];
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
  let llmApiKey = await getLlmApiKey(region);
  if (!llmApiKey && legacyKey) {
    await setLlmApiKey(region, legacyKey);
    llmApiKey = legacyKey;
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
  state.settings.apiKey = await getLlmApiKey(region);
  state.settings.speechApiKey = await getSpeechApiKey(region);
  await save();
}

export async function setProviderConfig(config) {
  const region = normalizeServiceRegion(config.serviceRegion || state.settings.serviceRegion);
  const providerMode = config.providerMode === 'custom' ? 'custom' : 'profile';
  const profile = getServiceProfile(region);
  await setLlmApiKey(region, config.apiKey || '');
  const next = {
    providerMode,
    serviceRegion: region,
    apiKey: (config.apiKey || '').trim(),
    protocol: providerMode === 'profile'
      ? profile.llm.protocol
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
  Object.assign(state.settings, {
    providerMode: 'profile',
    serviceRegion: region,
    baseUrl: '',
    model: '',
    protocol: profile.llm.protocol,
    ttsVoice: profile.speech.defaultVoice,
    apiKey: await getLlmApiKey(region),
    speechApiKey: await getSpeechApiKey(region),
  });
  await save();
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
  const profile = activeServiceProfile();
  return {
    protocol: profile.llm.protocol,
    baseUrl: profile.llm.baseUrl,
    model: profile.llm.defaultModel,
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
  return {
    id: uid(),
    skeleton: o.skeleton,           // "The bottleneck has shifted from X to Y"
    zh: o.zh || '',
    why: o.why || '',
    register: o.register || 'meeting',
    tags: o.tags || [],
    source: { kind: o.srcKind || 'zh', raw: o.raw || '', at: now() },
    trust: TRUST_BY_SRC[o.srcKind] ?? 1,
    seeds: o.seeds || [],           // 模型给的迁移例句（参考，不算我的）
    mine: [],                       // 我自己造的句子 {text, at, ctx}
    box: 0,
    dueAt: now(),                   // 立刻先造一句
    lastAt: 0,
    history: [],                    // {at, ok, answer, ms, ctx, why}
    usedReal: [],                   // {at, scenario}  ← 真实世界证据
    status: 'learning',
    createdAt: now(),
  };
}

export function addItem(o) {
  const it = makeItem(o);
  state.items.unshift(it); track('capture'); save();
  return it;
}
export function getItem(id) { return state.items.find(i => i.id === id); }
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
  state.inbox.unshift(f); state.draft = ''; track('flash'); save();
  return f;
}
export function dropFlash(id) { state.inbox = state.inbox.filter(f => f.id !== id); save(); }
export function getFlash(id) { return state.inbox.find(f => f.id === id); }
export function saveDraft(t) { state.draft = t || ''; save(); }
export function setFlashStatus(id, status, failReason = '') {
  const flash = getFlash(id);
  if (!flash) return;
  flash.status = status;
  flash.failReason = failReason;
  save();
}
export function completeFlash(id, analysis) {
  const flash = getFlash(id);
  if (!flash) return;
  flash.status = 'done';
  flash.failReason = '';
  flash.analysis = analysis;
  save();
}
export function pendingFlashes(limit = 3) {
  return state.inbox
    .filter(f => f.status === 'raw' || f.status === 'failed')
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
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

/* ---------------- 每周预算 ---------------- */
export function newThisWeek() {
  const t = now() - WEEK;
  return state.items.filter(i => i.createdAt > t && i.status !== 'retired').length;
}
export function budgetLeft() { return Math.max(0, WEEKLY_NEW_BUDGET - newThisWeek()); }
export function newItemsThisWeek() {
  const t = now() - WEEK;
  return live()
    .filter(item => item.createdAt > t)
    .sort((a, b) => (
      (a.usedReal.length - b.usedReal.length)
      || (a.mine.length - b.mine.length)
      || (a.createdAt - b.createdAt)
    ));
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
export function grade(id, ok, payload = {}) {
  const it = getItem(id); if (!it) return null;
  const lastPassedAt = [...it.history].reverse().find(h => h.ok)?.at || 0;
  it.history.push({ at: now(), ok: !!ok, answer: payload.answer || '', ms: payload.ms || 0, ctx: payload.ctx || '', why: payload.why || '' });
  if (payload.answer) it.mine.push({ text: payload.answer, at: now(), ctx: payload.ctx || '' });
  it.lastAt = now();
  const next = nextReview(it, !!ok, now(), lastPassedAt);
  it.box = next.box;
  it.dueAt = next.dueAt;
  recomputeStatus(it);
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
    newThisWeek: newThisWeek(), budgetLeft: budgetLeft(),
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
    const hay = (i.skeleton + ' ' + i.zh + ' ' + i.tags.join(' ') + ' ' + i.seeds.join(' ')).toLowerCase();
    let s = 0;
    toks.forEach(t => { if (hay.includes(t)) s += 2; });
    if (i.dueAt <= now()) s += 1.2;                 // 顺手把到期的一起带上
    if (i.status === 'learning') s += 0.6;
    s += i.trust * 0.25;
    return { i, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.i);
}
