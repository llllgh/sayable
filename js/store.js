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
import { clearApiKey, getApiKey, setApiKey } from '../src/platform/secure.ts';
import { LADDER_DAYS, isOwned, nextReview } from '../src/core/scheduler.ts';

const KEY = 'sayable.v1';
const WEEK = 7 * 864e5;
const DEFAULT_BASE_URL = '';
const DEFAULT_MODEL = '';

/* 间隔阶梯：天。box 5 = 毕业候选 */
export const LADDER = [...LADDER_DAYS];
export const WEEKLY_NEW_BUDGET = 3;

export const state = {
  profile: {
    name: '', role: '', org: '',
    domains: [], counterparts: [], scenarios: [], upcoming: '',
    variety: 'international',
  },
  items: [],
  inbox: [],            // 闪存：只存原文，不分析、不联网、不问问题
  draft: '',            // 输入草稿：被打断也不会丢
  notificationReplies: [],
  compressions: [],
  settings: {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',          // 仅驻留内存；持久化时剔除，原生端写入 Keystore
    model: DEFAULT_MODEL,
    protocol: 'chat_completions',
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
  seeded: false,
};

/* ---------------- persistence ---------------- */
let saveQueue = Promise.resolve();
let lastPersistenceError = null;

function persistableState() {
  const settings = { ...state.settings };
  delete settings.apiKey;
  return {
    formatVersion: 2,
    profile: state.profile,
    items: state.items,
    inbox: state.inbox,
    draft: state.draft,
    notificationReplies: state.notificationReplies,
    compressions: state.compressions,
    settings,
    log: state.log.slice(-500),
    seeded: state.seeded,
  };
}

function hydrate(d) {
  Object.assign(state.profile, d?.profile || {});
  Object.assign(state.settings, d?.settings || {});
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
  state.log = Array.isArray(d?.log) ? d.log.slice(-500) : [];
  state.seeded = !!d?.seeded;
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

  if (data) hydrate(data);

  const legacyKey = data?.settings?.apiKey || '';
  if (legacyKey) await setApiKey(legacyKey);
  state.settings.apiKey = await getApiKey();

  if (!state.seeded) {
    seed();
    state.seeded = true;
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
export function importJSON(txt) {
  const d = JSON.parse(txt);
  if (!d || !Array.isArray(d.items)) throw new Error('格式不对');
  const key = state.settings.apiKey;
  hydrate(d);
  state.settings.apiKey = key;
  state.seeded = true; save();
}

export async function setProviderConfig(config) {
  await setApiKey(config.apiKey || '');
  Object.assign(state.settings, {
    baseUrl: (config.baseUrl || '').trim(),
    apiKey: (config.apiKey || '').trim(),
    model: (config.model || '').trim(),
    protocol: config.protocol || 'chat_completions',
  });
  await save();
}

export async function resetAll() {
  await clearPersistedState();
  await clearApiKey();
  localStorage.removeItem(KEY);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const now = () => Date.now();
export const isLive = () => !!(state.settings.apiKey && state.settings.baseUrl && state.settings.model);

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
export const TRUST_BY_SRC = { heard: 3, mine: 2, zh: 1, fragment: 3, preflight: 1, compress: 2 };

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

/* ---------------- 演示种子数据 ---------------- */
function seed() {
  state.profile = {
    name: '', role: '产品/技术负责人', org: '',
    domains: ['AI 产品落地', '模型能力与效果', '研发效率', '客户 ROI'],
    counterparts: ['海外客户', '海外同事', '公司高管'],
    scenarios: ['客户方案沟通会', '和 leader 汇报进展', '跨时区周会', '面向高管的季度复盘'],
    upcoming: '下周要跟一个海外客户讲我们 AI 方案的投入产出',
    variety: 'international',
  };
  const S = [
    {
      skeleton: 'struggle to translate X into Y', zh: '难以把 X 转化为 Y',
      why: '一个词组吃掉「投了很多钱但没看到效果」整段中文；比 invest a lot but no obvious improvement 短一半。',
      srcKind: 'heard', raw: '老师给的例子：Many companies are struggling to translate AI investment into measurable productivity gains.',
      tags: ['ROI', '落地', '效果'],
      seeds: ['We still struggle to translate model improvements into user impact.',
              'The team is struggling to translate faster generation into faster delivery.'],
      box: 2, minus: 6,
      mine: [{ text: 'We are still struggling to translate model quality into revenue.', ctx: '客户会' }],
      hist: [true, true], used: 1,
    },
    {
      skeleton: 'The bottleneck has shifted from X to Y', zh: '瓶颈已经从 X 转移到 Y',
      why: '直接给出「变化 + 方向」，不需要先铺垫再解释。汇报里替代「以前是…现在变成…所以…」三句话。',
      srcKind: 'heard', raw: '在一个播客里听到：The bottleneck has shifted from generation to verification.',
      tags: ['判断', '汇报', '效率'],
      seeds: ['The bottleneck has shifted from writing code to reviewing it.',
              'For us the bottleneck has shifted from model capability to workflow design.'],
      box: 1, minus: 2, mine: [], hist: [], used: 0,
    },
    {
      skeleton: 'What matters is not X, but Y', zh: '重点不是 X，而是 Y',
      why: '把「我想强调的其实是…」的重音结构固化下来，避免用 I think the most important thing is that… 绕一大圈。',
      srcKind: 'heard', raw: '老师列的高频结构之一', tags: ['强调', '会议'],
      seeds: ['What matters is not how fast we ship, but whether anyone adopts it.',
              'What matters is not the benchmark score, but the failure cases.'],
      box: 4, minus: 12, mine: [{ text: 'What matters is not the model size, but the data we feed it.', ctx: '周会' }],
      hist: [true, true, true], used: 2,
    },
    {
      skeleton: 'This creates a gap between X and Y', zh: '这就在 X 和 Y 之间形成了落差',
      why: '一句话说清「两边不匹配」，不用 the problem is that A is ... while B is ... 两个从句。',
      srcKind: 'mine', raw: 'The problem is that our model is very good but the users do not feel it is good, so there is a difference between them.',
      tags: ['问题定义', '客户'],
      seeds: ['This creates a gap between what the model can do and what users actually experience.'],
      box: 1, minus: 1, mine: [], hist: [false], used: 0,
    },
    {
      skeleton: 'That doesn\'t necessarily mean X', zh: '这并不一定意味着 X',
      why: '专门用来「留后路」——你原来会说 but it is not sure that…，听起来不确定且不自然。',
      srcKind: 'mine', raw: 'But it is not sure that we can get the same result in other cases, maybe not.',
      tags: ['留余地', '严谨'],
      seeds: ['That doesn\'t necessarily mean the same approach works at scale.'],
      box: 0, minus: 0, mine: [], hist: [], used: 0,
    },
    {
      skeleton: 'less about X and more about Y', zh: '与其说是 X，更多是 Y',
      why: '替代「不是完全因为 A，主要还是因为 B」这种中文式并列 + 转折。',
      srcKind: 'heard', raw: '客户在会上说：The challenge is less about accuracy and more about trust.',
      tags: ['归因', '客户'],
      seeds: ['Adoption is less about features and more about habit.'],
      box: 2, minus: 4, mine: [{ text: 'Our risk is less about the tech and more about the rollout.', ctx: '客户会' }],
      hist: [true], used: 0,
    },
  ];
  state.items = S.map(s => {
    const it = makeItem({ skeleton: s.skeleton, zh: s.zh, why: s.why, srcKind: s.srcKind, raw: s.raw, tags: s.tags, seeds: s.seeds });
    it.box = s.box;
    it.createdAt = now() - (s.minus + 4) * 864e5;
    it.mine = (s.mine || []).map(m => ({ text: m.text, at: now() - 2 * 864e5, ctx: m.ctx }));
    it.history = (s.hist || []).map((ok, k) => ({ at: now() - (s.minus - k) * 864e5, ok, answer: '', ms: 0, ctx: '' }));
    it.usedReal = Array.from({ length: s.used }, (_, k) => ({ at: now() - (k + 1) * 3 * 864e5, scenario: '客户方案沟通会' }));
    it.lastAt = it.history.length ? it.history[it.history.length - 1].at : 0;
    // 让 3 条今天到期，其它排开 —— 打开就有东西可召回
    it.dueAt = now() - (s.minus <= 2 ? 36e5 : 0) + (s.minus <= 2 ? 0 : (s.box) * 864e5);
    recomputeStatus(it);
    return it;
  });
  state.items[1].dueAt = now() - 2 * 36e5;
  state.items[3].dueAt = now() - 5 * 36e5;
  state.items[4].dueAt = now() - 1 * 36e5;
  state.compressions = [{
    id: uid(), at: now() - 3 * 864e5,
    long: 'I think one thing we need to be careful about is that even though the model itself has become much better in the last few months, the users in the product do not really feel this improvement, because the workflow around the model has not changed at all, so from their point of view nothing happened.',
    short: 'The model got better, but the workflow around it didn\'t — so users never felt the gain.',
    longWords: 58, shortWords: 17,
    patterns: ['the workflow around X', 'users never felt the gain'],
  }];
  state.inbox = [
    { id: uid(), text: '他说了个 bottleneck 什么 shifted 的说法…', at: now() - 40 * 6e4, mode: null, source: 'demo', status: 'raw', failReason: '' },
    { id: uid(), text: '我们投了很多资源但客户还是感觉不到差别，我当时说得特别绕', at: now() - 3 * 36e5, mode: null, source: 'demo', status: 'raw', failReason: '' },
  ];
  state.draft = '';
  state.notificationReplies = [];
  state.log = [];
}
