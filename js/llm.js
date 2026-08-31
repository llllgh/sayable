/* =========================================================================
   llm.js — 单一 LLM 适配层 + 提示词
   与实习生方案的差异：
   1) 只有 2 类调用（capture / judge），不是 5 个 prompt + 5 个 JSON Schema。
      流程差异用 mode 字段区分，省下的工程量全部投到提示词质量上。
   2) 提示词里最重要的不是「输出格式」，而是三条硬约束：
      a. 必须是骨架（带槽位），且能迁移到用户自己的 3 个真实场景；
      b. 明确拉黑「LLM 味 / 教科书味 / 花哨低频」表达；
      c. 必须诊断出「导致你啰嗦的那个中文思维习惯」，而不是只给正确答案。
   3) 模型不许自评「相关性 0.94」这种没有信息量的分数；只允许回答一个
      可验证的二元问题：母语者在这个真实场景里会不会这么说。
   4) 未配置模型时只允许离线捕获，不伪造分析结果。
   ========================================================================= */

import { state, isLive, llmUsage, recordLlmUsage } from './store.js';
import { requestStructured, preflightProvider } from '../src/llm/client.ts';
import { LlmError, userMessage } from '../src/llm/errors.ts';
import {
  captureSchema,
  compressSchema,
  judgeSchema,
  preflightSchema,
} from '../src/llm/schemas.ts';
import { isOnline } from '../src/platform/network.ts';

export { LlmError, userMessage };

const BLACKLIST = [
  'delve into', 'leverage synergies', 'it is worth noting that', 'in today\'s fast-paced world',
  'navigate the complexities', 'a testament to', 'unlock the potential', 'game-changer',
  'paradigm shift', 'holistic approach', 'moving forward, we must',
];

function profileBlock() {
  const p = state.profile;
  return [
    p.role && `身份/岗位：${p.role}`,
    p.org && `所在组织：${p.org}`,
    p.domains?.length && `常聊的话题：${p.domains.join('、')}`,
    p.counterparts?.length && `主要说英语的对象：${p.counterparts.join('、')}`,
    p.scenarios?.length && `高频真实场景：${p.scenarios.join('、')}`,
    p.upcoming && `近期要面对的事：${p.upcoming}`,
    `英语变体偏好：${p.variety || 'international'}`,
  ].filter(Boolean).join('\n');
}

const SYS = `你是一名专门服务「被动词汇量很大、主动调用通道很窄」的中文母语职业人士的英语表达教练。

学习者的真实状况（务必据此优化，不要给通用建议）：
- 听得懂、看得懂，但真要说的时候只调得出最简单的词和中文式组织方式。
- 表达啰嗦的根因不只是英语差，还因为他思考的信息密度高：总想把限定条件、因果和例外一次交代完，英语跟不上时就不断加从句、补充、修正前句。
- 每天没有固定学习时间，所以一次交互只能给他留下**一个**真正值得拥有的东西。

你的产出规则（硬性）：
1. 学习单元必须是**可复用骨架**，带 X / Y / Z 槽位或稳定的交际功能，例如 "struggle to translate X into Y"、"The bottleneck has shifted from X to Y"。绝不把单个词、完整的固定句子当成学习单元。
2. 一次只给 **1 个** 主骨架（primary）。最多再给 1 个「顺手记」（bonus，可为空）。宁缺毋滥。
3. 骨架必须能迁移到学习者画像里的**至少 3 个不同真实场景**。做不到就换一个。
4. 严禁推荐以下几类：
   - AI 味 / 教科书味 / 演讲稿味的表达（如 ${BLACKLIST.slice(0, 6).map(x => `"${x}"`).join('、')} 这类）；
   - 低频成语、俚语、文学化比喻，非母语者在商务会议里用会显得刻意；
   - 只是把中文逐词换成高级词的「同义替换」，没有结构上的压缩收益。
   判断标准只有一个：**一个务实的母语者同事，在这个真实会议场景里，会不会真的这么说。**
5. 解释「为什么这样更好」时，必须对照学习者的原话/中文，点出**具体病症**（例如：先铺垫再给结论、用长否定代替紧凑名词短语、把一个因果关系拆成三句、用 very/a lot of 代替精确动词），不要空谈「更自然」。
6. 口语版必须真的能一口气说完（约 15 秒 / 25~35 词以内）。
7. 立刻练习题：只给交际功能和场景，**绝不能在题目里出现目标骨架本身或它的完整答案**。
8. 全部 JSON 输出，不要 markdown 代码块，不要多余解释。中文字段用中文，英文字段用英文。`;

const SCHEMA_HINT = `严格按此 JSON 结构输出：
{
  "mode": "zh|mine|heard|fragment",
  "read": "一句话说明你判断学习者给的是什么、想表达什么（中文）",
  "natural": "最自然的英文表达（完整句）",
  "spoken": "15 秒口语版（更短，能一口气说完）；如与 natural 相同则给 null",
  "diagnosis": {
    "symptom": "导致啰嗦/不自然的那个具体习惯（中文，一句话）。若输入是听到的好表达则填 null",
    "before": "学习者原话里最能体现问题的片段；没有则 null",
    "after": "对应改写后的片段；没有则 null"
  },
  "primary": {
    "skeleton": "带 X/Y/Z 槽位的骨架",
    "zh": "中文意思",
    "why": "为什么值得拥有它（中文，一句话，要具体，说清它替代了你原来的哪种绕法）",
    "register": "meeting|email|casual",
    "tags": ["最多3个中文标签"],
    "seeds": ["用学习者真实场景造的迁移例句1", "例句2", "例句3"],
    "native_check": "母语者在该场景会这么说吗？回答 yes / risky，并用一句中文说明理由",
    "trap": "用错时最常见的一个坑（中文，一句话）；没有则 null"
  },
  "bonus": { "skeleton": "...", "zh": "..." } 或 null,
  "drill": {
    "brief": "立刻造句题（中文描述交际功能 + 一个学习者的真实场景，不许泄露答案）",
    "target_zh": "这道题要表达的中文意思"
  }
}`;

const MODE_HINT = {
  zh: '学习者给的是一段中文意思，他想知道英语里最自然、最压缩的说法。请先给自然表达，再给口语版，然后抽出骨架。diagnosis.symptom 要指出「如果按中文直译会犯什么毛病」。',
  mine: '学习者给的是他自己写/说的英文。请保留他的逻辑和分寸（不要把结论说得比他更强），指出真正的问题，给出改写，并抽出他最该拥有的那个骨架。diagnosis 必填。',
  heard: '学习者给的是他听到的一个好表达。不要只夸它，立刻把它抽象成骨架，并用他的真实场景造迁移例句。natural 字段放这个表达的标准形态。diagnosis.symptom 填 null。',
  fragment: '学习者只记得半句/记错了。先尽最大可能还原成母语者真实会说的那个表达（在 read 里说明你的还原依据和不确定性），然后按 heard 处理。若有多种可能，选最高频的那个，并在 trap 里提醒另一种可能。',
};

/* ---------------------------------------------------------------- */
export function detectMode(text) {
  const t = (text || '').trim();
  const zhRatio = (t.match(/[\u4e00-\u9fa5]/g) || []).length / Math.max(1, t.length);
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (zhRatio > 0.35) {
    if (/[a-zA-Z]{3,}/.test(t) && zhRatio < 0.75) return 'fragment'; // 中英混杂 = 记了半句
    return 'zh';
  }
  if (/[?？]$/.test(t)) return 'fragment';
  if (wordCount <= 7) return 'heard';        // 短英文片段：大概率是听到的好表达
  return 'mine';                              // 成段英文：默认当作自己写的，要被改
}

function providerConfig(overrides = {}) {
  const s = state.settings;
  return {
    protocol: s.protocol || 'chat_completions',
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    timeoutMs: Number(s.timeoutMs || 30000),
    maxRetry: Number(s.maxRetry ?? 3),
    supportsJsonMode: s.supportsJsonMode,
    ...overrides,
  };
}

function assertCallAllowed() {
  if (!isLive()) throw new LlmError('configuration');
  if (!isOnline()) throw new LlmError('network', 'Device is offline');
  const usage = llmUsage();
  if (usage.todayCalls >= Number(state.settings.dailyLimit || 60)) {
    throw new LlmError('daily_limit');
  }
}

async function chat(messages, schema, {
  temperature = 0.35,
  maxTokens = 1600,
  task = 'unknown',
} = {}) {
  assertCallAllowed();
  const startedAt = Date.now();
  const result = await requestStructured(
    providerConfig(),
    messages,
    schema,
    {
      temperature,
      maxTokens: Math.min(maxTokens, Number(state.settings.maxTokens || 1600)),
    },
  );
  recordLlmUsage(task, result.tokens, Date.now() - startedAt);
  return result.data;
}

export async function testProvider(config = {}) {
  return preflightProvider(providerConfig({ ...config, maxRetry: 0 }));
}

/* ---------- 1) 收编 ---------- */
export async function capture(text, forcedMode) {
  const mode = forcedMode || detectMode(text);
  const owned = state.items.filter(i => i.status !== 'retired').slice(0, 12)
    .map(i => `- ${i.skeleton}（${i.zh}）`).join('\n');
  const user = `${SCHEMA_HINT}

【学习者画像】
${profileBlock()}

【他已经在练的骨架（若这次的意思能用已有骨架表达，请在 read 里明确指出「这个可以用你已有的 xxx」，primary 就换成一个真正新的东西，或者 primary 为已有骨架的自然延伸）】
${owned || '（暂无）'}

【本次输入类型】${mode}
${MODE_HINT[mode]}

【输入】
"""
${text}
"""`;
  const out = await chat(
    [{ role: 'system', content: SYS }, { role: 'user', content: user }],
    captureSchema,
    { task: 'capture' },
  );
  return normalize(out, mode);
}

/* ---------- 2) 判卷（召回 / 立刻造句 都用这个） ---------- */
export async function judge({ skeleton, zh, brief, answer, seeds = [] }) {
  const sys = `你是英语表达教练，给学习者的产出打分。原则：
- 只要他**用对了目标骨架**并且**意思成立、母语者会这么说**，就算通过。用词与参考例句不同没关系。
- 不通过的情况：没用上目标结构、槽位填错导致语义不通、语法硬错、或明显不自然。
- 反馈要极短：他能记住的只有一句话。
- 如果他的句子里有一个可以顺手改得更紧凑的地方，给出 tighter（更紧的版本）；没有就填 null。
只输出 JSON：
{"ok":true/false,"used_target":true/false,"verdict":"一句话结论（中文，先说过没过）","fix":"最小改动后的正确版本（英文），如果本来就对就填 null","tighter":"更紧凑的版本（英文）或 null","note":"一句话点评（中文，说清他这次卡在哪或做对了什么）"}`;
  const user = `目标骨架：${skeleton}
骨架中文：${zh}
题目：${brief}
参考例句：${seeds.slice(0, 2).join(' / ') || '（无）'}
学习者的答案：${answer}`;
  return await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    judgeSchema,
    { temperature: 0.1, maxTokens: 600, task: 'judge' },
  );
}

/* ---------- 3) 压缩台：30 秒 → 15 秒 ---------- */
export async function compress(text) {
  const sys = `${SYS}

本次任务是**压缩训练**，不是纠错。步骤严格如下：
1. 完整保留学习者的逻辑、分寸和不确定性，不许把结论说得更强，不许删掉他真正想说的限定条件。
2. 给一个自然的、能一口气说完的短版本（约 25~35 词）。
3. 明确指出你删掉/合并了什么，以及为什么这些内容在英语里可以不说出来（往往是中文习惯要求交代，英语靠动词和名词短语已经蕴含了）。
4. 抽出 1~2 个他最该长期拥有的可复用骨架。
只输出 JSON：
{"short":"短版本（英文）","kept":"你确认保住了哪些关键信息（中文一句）","cuts":[{"what":"删掉/合并了什么（中文）","why":"为什么可以不说（中文）"}],"symptom":"这段话里最主要的一个啰嗦习惯（中文一句）","patterns":[{"skeleton":"骨架","zh":"中文","why":"为什么值得拥有（中文一句）","seeds":["迁移例句"]}]}`;
  const out = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: `【学习者画像】\n${profileBlock()}\n\n【他说的一段话】\n"""\n${text}\n"""` }],
    compressSchema,
    { maxTokens: 1400, task: 'compress' },
  );
  return out;
}

/* ---------- 4) 会前热身 ---------- */
export async function preflight(scenario, items) {
  const sys = `${SYS}

本次任务是**会前 3 分钟热身**。学习者 30 分钟后要真的去开这个会，所以：
- 只挑他**这场会真的会用到**的骨架，用不上的一律不要，宁可少。
- 每个骨架配一道 drill：给这场会的具体情境，让他现在就说一遍（不许泄露答案）。
- 另外给最多 2 个这场会专属的新骨架（他还没有的），要求是这场会里高概率派上用场。
- 最后给一句「这场会你最该避免的一个中文式说法」。
只输出 JSON：
{"reuse":[{"id":"已有骨架的id","reason":"这场会为什么需要它（中文一句）","drill":"这场会情境下的造句题（中文，不泄露答案）"}],"fresh":[{"skeleton":"...","zh":"...","why":"...","seeds":["..."],"drill":"..."}],"avoid":"这场会最该避免的一个中文式说法（中文一句，给出反例和替代方向）"}`;
  const list = items.map(i => `- id=${i.id} | ${i.skeleton}（${i.zh}）| 我造过：${i.mine.map(m => m.text).join(' ; ') || '（还没造过）'}`).join('\n');
  const out = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: `【学习者画像】\n${profileBlock()}\n\n【这场会】\n${scenario}\n\n【他句库里可能相关的骨架】\n${list || '（空）'}` }],
    preflightSchema,
    { maxTokens: 1500, task: 'preflight' },
  );
  return out;
}

/* ---------------- 校验：模型只是提议者 ---------------- */
function normalize(out, mode) {
  const o = out || {};
  o.mode = mode;
  const p = o.primary || {};
  if (!p.skeleton) throw new Error('模型没给出可用的骨架，请重试');
  // 兜底约束：骨架必须有槽位或足够短，避免把整句话当学习单元
  if (!/[XYZ]/.test(p.skeleton) && p.skeleton.split(/\s+/).length > 7) {
    p.skeleton = p.skeleton.split(/\s+/).slice(0, 7).join(' ');
  }
  p.seeds = (p.seeds || []).slice(0, 3);
  p.tags = (p.tags || []).slice(0, 3);
  const low = (p.skeleton || '').toLowerCase();
  o.flagged = BLACKLIST.some(b => low.includes(b));
  o.drill = o.drill || { brief: '用这个骨架，就你手上正在推进的一件事说一句话。', target_zh: '' };
  return o;
}
