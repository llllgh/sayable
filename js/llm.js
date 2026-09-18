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

import {
  activeProviderConfig,
  state,
  isLive,
  llmUsage,
  recordLlmUsage,
} from './store.js';
import { requestStructured, preflightProvider } from '../src/llm/client.ts';
import { LlmError, userMessage } from '../src/llm/errors.ts';
import {
  captureSchema,
  compressSchema,
  judgeSchema,
  preflightSchema,
  recommendationSchema,
  restatementSchema,
  reviewCueSchema,
  roleplayContinueSchema,
  roleplayJudgeSchema,
  roleplayStartSchema,
} from '../src/llm/schemas.ts';
import {
  normalizeJudgementText,
  resolveJudgement,
} from '../src/core/judgement.ts';
import {
  roleplayLeaksTarget,
  roleplayLeaksTrigger,
} from '../src/core/roleplay.ts';
import { englishLevelLabel } from '../src/core/english-level.ts';
import {
  LLM_OUTPUT_TOKENS,
  LLM_REQUEST_TIMEOUT_MS,
} from '../src/llm/budgets.ts';
import { isOnline } from '../src/platform/network.ts';
import {
  isProfessionalTermCandidate,
  normalizeLearningItem,
} from '../src/core/learning-items.ts';

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
    p.goal && `学习英语的目的：${p.goal}`,
    p.domains?.length && `常聊的话题：${p.domains.join('、')}`,
    p.counterparts?.length && `主要说英语的对象：${p.counterparts.join('、')}`,
    p.scenarios?.length && `高频真实场景：${p.scenarios.join('、')}`,
    p.upcoming && `近期要面对的事：${p.upcoming}`,
    p.englishLevel?.cefr && `英语水平：${englishLevelLabel(p.englishLevel)}${
      p.englishLevel.approximate ? '（仅用于难度适配的近似换算）' : ''
    }`,
    `英语变体偏好：${p.variety || 'international'}`,
  ].filter(Boolean).join('\n');
}

const SYS = `你是一名专门服务「被动词汇量很大、主动调用通道很窄」的中文母语职业人士的英语表达教练。

学习者的真实状况（务必据此优化，不要给通用建议）：
- 听得懂、看得懂，但真要说的时候只调得出最简单的词和中文式组织方式。
- 表达啰嗦的根因不只是英语差，还因为他思考的信息密度高：总想把限定条件、因果和例外一次交代完，英语跟不上时就不断加从句、补充、修正前句。
- 每天没有固定学习时间，所以一次交互只能给他留下**一个**真正值得拥有的东西。

你的产出规则（硬性）：
1. 学习单元优先是**可复用表达骨架**，带 X / Y / Z 槽位或稳定的交际功能，例如 "struggle to translate X into Y"、"The bottleneck has shifted from X to Y"。仅当输入中出现一个与学习者岗位/专业场景强相关、能直接用于工作句子的术语时，primary 才可设为 kind=term；不得收录通用基础词、考试词、罕见高级同义词或脱离句子的词义。
2. 先判断本次是否值得进入表达库。admission 只能是 none、reuse、new：没有值得长期练的新单元时用 none；已有条目能覆盖时用 reuse 并返回它的 id；只有确实出现新表达或专业词汇时才用 new。
   admission=new 时一次只给 **1 个** primary。kind=expression 时，primary 必须直接从 natural 中抽出，natural 本身必须是该骨架填入槽位后的完整实例；kind=term 时，skeleton 与 lemma 都填目标词，natural 和 anchorSentence 必须真实使用该词，并给至少 2 个高频工作搭配及具体领域标签。
   最多再给 1 个相关表达（bonus，可为空）。bonus 只承接输入中的次要意思，并必须给出独立的 trigger、例句和练习题，使它可以单独收录。
3. 新的 primary 和 bonus 都必须能迁移到学习者画像里的**至少 3 个不同真实场景**。专业词汇必须能在真实工作句中主动使用，而不是只会中文释义。做不到就不推荐。
   同时必须为骨架写出 trigger：用一句中文说明「出现什么情境信号时，为了完成什么沟通动作，应调用这个骨架」。
   trigger 应写成「当……时，……」或同等明确的条件—意图结构，不得只是话题标签、中文释义或具体答案。
4. 严禁推荐以下几类：
   - AI 味 / 教科书味 / 演讲稿味的表达（如 ${BLACKLIST.slice(0, 6).map(x => `"${x}"`).join('、')} 这类）；
   - 低频成语、俚语、文学化比喻，非母语者在商务会议里用会显得刻意；
   - 只是把中文逐词换成高级词的「同义替换」，没有结构上的压缩收益。
   判断标准只有一个：**一个务实的母语者同事，在这个真实会议场景里，会不会真的这么说。**
5. 解释「为什么这样更好」时，必须对照学习者的原话/中文，点出**具体病症**（例如：先铺垫再给结论、用长否定代替紧凑名词短语、把一个因果关系拆成三句、用 very/a lot of 代替精确动词），不要空谈「更自然」。
6. 口语版必须真的能一口气说完（约 15 秒 / 25~35 词以内）。
7. 立刻练习题：**绝不能在题目里出现目标英文骨架、专业词汇或完整英文答案**。但 target_zh 必须是一句**具体到接近翻译**的完整中文，说清楚要表达的那件事（含关键信息），让学习者一看就知道该用英文说什么，而不是一个宽泛场景。例如「当你想跟同事说：从成本角度看，发请求前先压缩上下文、裁掉无关背景会很有效」，不要写成「跟同事聊聊成本问题」。
8. 不得虚构用户未提供的项目、平台、人员、故障或业务事实；上下文不足时使用中性的 X / Y / Z 占位信息。
9. 若画像提供了 CEFR 等级，表达长度、词汇和句法复杂度必须适应该等级；优先提供学习者能立即说出口的高频结构，不得为了显得高级而使用超纲词汇。
10. 反馈必须区分：keep=原句可直接保留；correct=存在一个必须修正的主要问题；optional=原句没错但有一个明确可选优化。无需修改是成功结果，不得为了填字段制造问题。
11. 全部 JSON 输出，不要 markdown 代码块，不要多余解释。中文字段用中文，英文字段用英文。`;

const SCHEMA_HINT = `严格按此 JSON 结构输出：
{
  "mode": "zh|mine|heard|fragment",
  "read": "一句话说明你判断学习者给的是什么、想表达什么（中文）",
  "natural": "最自然的英文表达（完整句）",
  "spoken": "15 秒口语版（更短，能一口气说完）；如与 natural 相同则给 null",
  "feedbackKind": "keep|correct|optional",
  "mainIssue": "至多一个必须修正的主要问题；没有则 null",
  "correction": "保留原意和分寸的必要修正版；没有则 null",
  "alternative": "原句没错时至多一个可选优化版；没有则 null",
  "admission": "none|reuse|new",
  "reuseItemId": "admission=reuse 时填写已有条目 id，否则 null",
  "diagnosis": {
    "symptom": "导致啰嗦/不自然的那个具体习惯（中文，一句话）。若输入是听到的好表达则填 null",
    "before": "学习者原话里最能体现问题的片段；没有则 null",
    "after": "对应改写后的片段；没有则 null"
  } 或 null,
  "primary": {
    "kind": "expression|term",
    "skeleton": "带 X/Y/Z 槽位的骨架",
    "zh": "中文意思",
    "lemma": "仅 kind=term：词形或固定术语；否则 null",
    "sense": "仅 kind=term：当前职业语境中的准确中文义项；否则 null",
    "collocations": ["仅 kind=term：2—4 个高频工作搭配"],
    "anchorSentence": "仅 kind=term：包含该词的真实工作场景英文句",
    "relatedExpressionIds": ["仅 kind=term：确有帮助时关联已有表达 id，否则空数组"],
    "domainTags": ["仅 kind=term：1—3 个具体专业领域标签"],
    "trigger": "触发情境与沟通意图，例如：客户担心一次性投入过大时，提出先小范围试点",
    "why": "为什么值得拥有它（中文，一句话，要具体，说清它替代了你原来的哪种绕法）",
    "register": "meeting|email|casual",
    "tags": ["最多3个中文标签"],
    "seeds": ["用学习者真实场景造的迁移例句1", "例句2", "例句3"],
    "native_check": "母语者在该场景会这么说吗？回答 yes / risky，并用一句中文说明理由",
    "trap": "用错时最常见的一个坑（中文，一句话）；没有则 null"
  } 或 null（只有 admission=new 时填写）,
  "bonus": {
    "skeleton": "与输入次要意思直接相关的可复用骨架",
    "zh": "中文意思",
    "trigger": "触发情境与沟通意图",
    "why": "为什么值得单独拥有",
    "register": "meeting|email|casual",
    "tags": ["最多3个中文标签"],
    "seeds": ["完整迁移例句1", "例句2"],
    "drill": {
      "brief": "不泄露英文答案的具体中文造句任务",
      "target_zh": "要用英文说出的完整中文意思"
    }
  } 或 null,
  "drill": {
    "brief": "立刻造句题（中文，一句具体到接近翻译的完整任务：说清要表达的那件事和关键信息，不许出现英文答案或目标骨架）",
    "target_zh": "这道题要用英文说出的完整中文意思（具体、含关键信息，接近可直译的程度）"
  } 或 null（只有 admission=new 时必填）
}`;

const MODE_HINT = {
  zh: '学习者给的是一段中文意思，他想知道英语里最自然、最压缩的说法。先给自然表达，再判断是否有值得长期练的新骨架。若 admission=new，primary 不能改去教授输入里的另一层意思。',
  mine: '学习者给的是他自己写/说的英文。请保留他的逻辑和分寸（不要把结论说得比他更强），先判断原句应保留、必须纠正还是仅有可选优化；没有真实问题时 diagnosis 可为空。',
  heard: '学习者给的是他听到的一个好表达。先判断是否已有条目可以复用；只有值得长期练且未收录时才抽象新骨架。natural 字段放这个表达的标准形态，diagnosis 可为空。',
  fragment: '学习者只记得半句/记错了。先尽最大可能还原成母语者真实会说的那个表达（在 read 里说明你的还原依据和不确定性），再判断是否需要收录。若有多种可能，选最高频的那个。',
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
  const active = activeProviderConfig();
  return {
    protocol: active.protocol || 'chat_completions',
    baseUrl: active.baseUrl,
    apiKey: s.apiKey,
    model: active.model,
    timeoutMs: LLM_REQUEST_TIMEOUT_MS,
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
  maxTokens = LLM_OUTPUT_TOKENS.providerDefault,
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
      maxTokens,
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
  const owned = state.items.filter(i => i.status !== 'retired').slice(0, 20)
    .map(i => `- id=${i.id} | ${i.kind === 'term' ? '专业词汇' : '表达'} | ${i.skeleton}（${i.zh}）`).join('\n');
  const user = `${SCHEMA_HINT}

【学习者画像】
${profileBlock()}

【他已经在练的骨架（能覆盖本次内容时优先 admission=reuse，并返回准确 id）】
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
    { maxTokens: LLM_OUTPUT_TOKENS.capture, task: 'capture' },
  );
  return normalize(out, mode);
}

/* ---------- 1.1) 为旧条目补具体复习提示 ---------- */
export async function regenerateReviewCue(item) {
  const source = String(item?.source?.raw || '').trim().slice(0, 2000);
  const seeds = (Array.isArray(item?.seeds) ? item.seeds : []).slice(0, 3);
  const currentDrill = item?.drill && typeof item.drill === 'object'
    ? item.drill
    : null;
  const targetKind = item?.kind === 'term' ? '专业词汇' : '英文表达骨架';
  const sys = `你是中文母语职业人士的英语表达教练。你只为一个已经保存的${targetKind}生成复习提示，不修改学习目标本身。

硬性要求：
1. trigger 必须用一句中文说明「出现什么情境信号时，为了完成什么沟通动作，应调用这个骨架」，采用「当……时，……」或同等明确的条件—意图结构。
2. target_zh 必须是具体、完整、接近可直译的一句中文，明确说出要表达的事实或观点以及关键信息。
3. brief 必须是自然的中文任务描述，可用「当你想跟同事说：……」等形式，但不得泛化成「聊聊成本」「和外国同事沟通」。
4. trigger、brief 和 target_zh 都不得出现目标英文骨架、完整英文答案或中英夹杂。
5. 优先还原原始输入中的事实；其次使用参考例句里的具体关系。不得虚构用户未提供的项目、人员、客户或业务事实。
6. 这道题必须能自然地使用目标${item?.kind === 'term' ? '词汇' : '骨架'}作答，且要求完整工作场景句，不考孤立翻译。只输出 JSON：
{"trigger":"触发情境与沟通意图","brief":"具体中文任务","target_zh":"要用英文说出的完整中文意思"}`;
  const user = `【学习者画像】
${profileBlock()}

【已有条目】
${JSON.stringify({
    skeleton: item?.skeleton || '',
    kind: item?.kind || 'expression',
    collocations: item?.collocations || [],
    anchorSentence: item?.anchorSentence || '',
    zh: item?.zh || '',
    trigger: item?.trigger || '',
    why: item?.why || '',
    source,
    seeds,
    currentDrill,
  }, null, 2)}

请重新生成一条比现有提示更具体的复习提示。`;

  return await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    reviewCueSchema,
    {
      temperature: 0.45,
      maxTokens: LLM_OUTPUT_TOKENS.reviewCue,
      task: 'review_cue',
    },
  );
}

/* ---------- 2) 判卷（召回 / 立刻造句 都用这个） ---------- */
export async function judge({
  kind = 'expression',
  skeleton,
  zh,
  brief,
  answer,
  seeds = [],
}) {
  const targetLabel = kind === 'term' ? '目标专业词汇' : '目标骨架';
  const sys = `你是英语表达教练，给学习者的产出打分。原则：
- 本题只检验学习者能否主动调用**${targetLabel}**。${kind === 'term'
    ? '只要在完整工作场景句中正确使用目标词汇、搭配自然且核心语义成立，就应通过；孤立写出单词不算通过。'
    : '只要用对目标骨架、槽位关系正确且核心语义成立，就应通过；用词与参考例句不同没关系。'}
- 大小写、句号、逗号等标点是 ASR 格式噪声，必须完全忽略，不得据此扣分。
- 主谓一致、冠词、单复数、局部词形或局部时态错误，如果不改变核心语义，属于 minor：仍然通过，同时在 fix 中给出最小修正。例如 "compacting context help you" 应判通过，并修正为 "compacting context helps you"。
- 搭配、介词、代词指代或主语关系不自然，但对方仍能理解核心意思时，也属于 minor：必须明确纠正，但不阻止本题通过。
- 只有以下情况属于 blocking 并判为不通过：没有使用目标骨架；关键槽位关系错误；句子无法理解；错误明显改变了人物、时间、否定或核心语义。
- issue_level 只能是 none、minor、blocking。ok 必须等于 used_target && meaning_intact && issue_level != "blocking"。
- 语言反馈与任务判定分开：feedback_kind 只能是 keep、correct、optional。没用目标骨架但英文句子本身正确时，可以 issue_level=blocking、feedback_kind=keep、fix=null，并明确说明“表达本身没问题，本题尚未完成”。
- feedback_kind=correct 时，main_issue 必须是一个具体的主要问题，fix 必须是一条完整英文修正版，并一次覆盖所有必须纠正的语法、搭配、介词、指代和主语关系问题。
- feedback_kind=keep 时 main_issue 和 fix 必须为 null；feedback_kind=optional 时 main_issue 和 fix 必须为 null，tighter 填一个真正有明确收益的可选版本。
- issue_level 为 none 时 fix 必须填 null。若与原句相比只有大小写、标点或断句不同，也必须判 none 且 fix 填 null。
- tighter 只能优化一条已经正确的表达，只做可选精简或组织调整。它不得承担任何语法、搭配、介词、指代、主语关系或核心语义修复；没有纯风格收益就填 null。
- note 要极短。fix 不为 null 时，必须说明主要错误为什么需要改；不得只写“更自然”“更完整”或“表达有误”。
- 展示层有三种结果：完全通过、通过但需纠正、未通过。minor 对应“通过但需纠正”，不能伪装成完全无误，也不能因为局部错误阻断目标骨架练习。
只输出 JSON：
{"ok":true/false,"used_target":true/false,"meaning_intact":true/false,"issue_level":"none|minor|blocking","feedback_kind":"keep|correct|optional","main_issue":"一个必须修正的主要问题或 null","verdict":"一句话结论（中文，区分完全通过、通过但需纠正、未通过）","fix":"覆盖全部必要纠错的完整英文修正版或 null","tighter":"只包含可选精简的英文版本或 null","note":"必要纠错的简短原因；没有实质改动则填空字符串"}`;
  const normalizedAnswer = normalizeJudgementText(answer);
  const user = `${targetLabel}：${skeleton}
目标中文：${zh}
题目：${brief}
参考例句：${seeds.slice(0, 2).join(' / ') || '（无）'}
学习者的原始答案（仅用于生成 fix）：${answer}
忽略大小写和标点后的判卷文本（用于判断骨架与语义）：${normalizedAnswer}`;
  const result = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    judgeSchema,
    {
      temperature: 0.1,
      maxTokens: LLM_OUTPUT_TOKENS.judge,
      task: 'judge',
    },
  );
  return resolveJudgement(result);
}

export async function judgeRestatement({
  task = 'restatement',
  original,
  target,
  answer,
}) {
  const sys = `你是英语表达教练，检查学习者脱稿重述是否完成原任务。
- 重点检查原文的事实、主体、否定、时间、范围、条件、责任和不确定性是否保留；不要求复现参考版本的措辞。
- 不按压缩率判分，不要求使用某个固定骨架。表达清楚且原意完整即可通过。
- feedback_kind 只能是 keep、correct、optional。keep 表示原句可保留；correct 只指出一个最重要的实质问题并给完整修正版；optional 表示原句没错，仅提供一个确有收益的可选版本。
- 大小写、标点和 ASR 断句不算错误。技术噪声不能成为语言问题。
- 只输出 JSON：
{"ok":true/false,"meaning_intact":true/false,"feedback_kind":"keep|correct|optional","main_issue":"一个主要问题或 null","verdict":"简短中文结论","fix":"必要修正版或 null","tighter":"可选版本或 null","note":"简短原因"}`;
  return await chat(
    [{
      role: 'system',
      content: sys,
    }, {
      role: 'user',
      content: `任务类型：${task}
原始意思：
"""
${original}
"""
参考版本（只用于核对信息，不要求复现措辞）：
"""
${target}
"""
学习者本次重述：
"""
${answer}
"""`,
    }],
    restatementSchema,
    {
      temperature: 0.1,
      maxTokens: LLM_OUTPUT_TOKENS.judge,
      task: 'restatement_judge',
    },
  );
}

/* ---------- 3) 压缩台：30 秒 → 15 秒 ---------- */
export async function compress(text) {
  const sys = `${SYS}

本次任务是**压缩训练**，不是纠错。步骤严格如下：
1. 完整保留学习者的逻辑、分寸和不确定性，不许把结论说得更强，不许删掉他真正想说的限定条件。
2. 给一个自然的、能一口气说完的短版本（约 25~35 词）。
3. 明确指出你删掉/合并了什么，以及为什么这些内容在英语里可以不说出来（往往是中文习惯要求交代，英语靠动词和名词短语已经蕴含了）。
4. 抽出 1~2 个他最该长期拥有的可复用骨架，并为每个骨架写 trigger：出现什么情境信号时，为了完成什么沟通动作，应调用它。
只输出 JSON：
{"short":"短版本（英文）","kept":"你确认保住了哪些关键信息（中文一句）","cuts":[{"what":"删掉/合并了什么（中文）","why":"为什么可以不说（中文）"}],"symptom":"这段话里最主要的一个啰嗦习惯（中文一句）","patterns":[{"skeleton":"骨架","zh":"中文","trigger":"触发情境与沟通意图，使用当……时，……结构","why":"为什么值得拥有（中文一句）","seeds":["迁移例句"]}]}`;
  const out = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: `【学习者画像】\n${profileBlock()}\n\n【他说的一段话】\n"""\n${text}\n"""` }],
    compressSchema,
    { maxTokens: LLM_OUTPUT_TOKENS.compress, task: 'compress' },
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
- 每个新骨架必须写 trigger：会议中出现什么信号时，为了完成什么沟通动作，应调用它。
- 最后给一句「这场会你最该避免的一个中文式说法」。
- 只使用学习者给出的会议描述和已有骨架，不得擅自增加具体平台、产品、人员或故障。
只输出 JSON：
{"reuse":[{"id":"已有骨架的id","reason":"这场会为什么需要它（中文一句）","drill":"这场会情境下的造句题（中文，不泄露答案）"}],"fresh":[{"skeleton":"...","zh":"...","trigger":"触发情境与沟通意图","why":"...","seeds":["..."],"drill":"..."}],"avoid":"这场会最该避免的一个中文式说法（中文一句，给出反例和替代方向）"}`;
  const list = items.map(i => `- id=${i.id} | ${i.skeleton}（${i.zh}）| 触发时机：${i.trigger || '未补充'} | 我造过：${i.mine.map(m => m.text).join(' ; ') || '（还没造过）'}`).join('\n');
  const out = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: `【学习者画像】\n${profileBlock()}\n\n【这场会】\n${scenario}\n\n【他句库里可能相关的骨架】\n${list || '（空）'}` }],
    preflightSchema,
    {
      maxTokens: LLM_OUTPUT_TOKENS.meetingPreflight,
      task: 'preflight',
    },
  );
  return out;
}

/* ---------- 5) 今日推荐 ---------- */
export async function recommendDaily() {
  const ownExamples = state.items
    .flatMap(item => (item.mine || []).map(example => ({
      at: Number(example.at || 0),
      text: String(example.text || '').trim().slice(0, 280),
      context: String(example.ctx || '').trim().slice(0, 80),
    })))
    .filter(example => example.text)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map(example => `- ${example.text}${example.context ? `（场景：${example.context}）` : ''}`)
    .join('\n');
  const existing = state.items
    .filter(item => item.status !== 'retired')
    .slice(0, 30)
    .map(item => `- id=${item.id} | ${item.kind === 'term' ? '专业词汇' : '表达'} | ${String(item.skeleton || '').slice(0, 120)}（${String(item.zh || '').slice(0, 80)}）| 触发时机：${String(item.trigger || '未补充').slice(0, 100)}`)
    .join('\n');
  const sys = `你是一名为中文母语职业人士挑选高频英语表达的教练。

本次任务是生成一副“今日推荐”牌组。严格遵守：
1. 固定给 5 个不同学习单元。优先给 4 个可复用表达骨架 + 1 个专业词汇；若找不到真正适合学习者工作场景的专业词汇，就给 5 个表达，不得硬凑。
2. 优先依据学习者的岗位、学习目的、沟通对象、真实场景、CEFR 英语水平和他过去自己造过的句子；资料不足时使用中性职业场景，不虚构项目、公司、客户或结论。
3. 表达必须覆盖不同交际功能，且不能与已有条目重复或只是换词改写。专业词汇不得是通用基础词、考试词表词、罕见高级同义词；必须是该岗位/领域高频、含义边界明确并能直接进入工作句子的词或固定术语。
4. 只选务实母语者在会议、邮件或日常协作中真的会说的高频结构。禁止 AI 味、教科书味、低频俚语和花哨表达，包括 ${BLACKLIST.map(item => `"${item}"`).join('、')}。
5. kind=expression 时，skeleton 是表达骨架，example 必须直接实例化 skeleton。kind=term 时，skeleton 与 lemma 都填目标词；sense 是当前专业语境中的准确义项；collocations 给 2—4 个高频工作搭配；anchorSentence 是包含该词的真实工作场景句；domainTags 给具体领域；relatedExpressionIds 仅填写确实能与该词组合的已有表达 id，没有则空数组。
6. trigger 是「情境信号 + 沟通意图」，写成「当……时，……」；example 是一条完整、自然、可直接朗读的英文例句，并且必须使用目标表达或词汇；example_zh 是该例句准确、完整的中文意思。
7. drill 必须是迁移练习，而不是例句翻译：
   - drill.target_zh 是学习者要翻译成英文的一句具体、完整中文，必须自然地套用同一个 skeleton；
   - 必须更换例句中的具体场景和槽位内容，至少改变主体/对象与事实/论点中的两项；
   - 不得只是对 example_zh 换几个近义词、调整语序或补充背景；即使话题相近，也必须产生一条内容上不同的新表达；
   - drill.brief 用中文简短交代新情境和沟通动作，不出现目标英文骨架或英文答案。
   - drill.answer 是 target_zh 对应的自然英文参考答案，必须直接实例化 skeleton，且与 example 使用不同槽位内容。
8. 专业词汇也必须通过场景句产出练习，不能考孤立翻译、拼写或词义选择。drill.answer 必须自然使用 lemma。
9. why 必须简短说明它为什么适合这个学习者，不得声称用户提供过不存在的事实。
10. 输出前逐项对照 example_zh 与 drill.target_zh；若两句表达的是同一件事，必须重写 drill。
11. 只输出 JSON，不要 markdown 或额外说明。

JSON：
{"items":[{"kind":"expression|term","skeleton":"表达骨架或目标词","zh":"表达中文意思或词汇准确义项","lemma":"仅 term 填目标词，否则 null","sense":"仅 term 填专业语境义项，否则 null","collocations":["仅 term：2—4 个高频搭配"],"anchorSentence":"仅 term：包含目标词的工作场景句，否则 null","relatedExpressionIds":["仅 term：可组合的已有表达 id"],"domainTags":["仅 term：具体领域标签"],"trigger":"触发情境与沟通意图","why":"...","example":"英文例句","example_zh":"英文例句的完整中文意思","drill":{"brief":"不同于例句的具体中文情境任务","target_zh":"在新场景中要用英文说出的完整中文意思","answer":"新场景对应的英文参考答案"},"register":"meeting|email|casual","tags":["最多3个中文标签"]}]}`;
  const user = `【学习者画像】
${profileBlock()}

【过去自己造过的例句】
${ownExamples || '（暂无）'}

【已经在句库里的骨架，不要重复】
${existing || '（暂无）'}

生成今天的 5 个推荐。专业词汇最多 1 个，不合适就全部给表达。`;

  return await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    recommendationSchema,
    {
      temperature: 0.65,
      maxTokens: LLM_OUTPUT_TOKENS.recommendation,
      task: 'recommendation',
    },
  );
}

function roleplayItemBlock(item) {
  return JSON.stringify({
    skeleton: item?.skeleton || '',
    zh: item?.zh || '',
    trigger: item?.trigger || '',
    register: item?.register || 'meeting',
    tags: Array.isArray(item?.tags) ? item.tags.slice(0, 4) : [],
    seeds: Array.isArray(item?.seeds) ? item.seeds.slice(0, 3) : [],
  }, null, 2);
}

function roleplayTranscript(turns) {
  return (Array.isArray(turns) ? turns : [])
    .slice(0, 4)
    .map(turn => `${turn.speaker === 'user' ? '学习者' : '对方'}：${String(turn.text || '').slice(0, 800)}`)
    .join('\n');
}

function assertNoRoleplayLeak(text, skeleton) {
  if (roleplayLeaksTarget(text, skeleton)) {
    throw new Error('角色发言泄露了目标表达，请重新生成');
  }
}

function assertRoleplayLine(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (
    !/[A-Za-z]/.test(text)
    || /[\u3400-\u9fff]/u.test(text)
    || words.length > maxWords
  ) {
    throw new Error('角色发言不符合长度或语言要求，请重新生成');
  }
}

function assertChineseRoleplayContext(role, scenario) {
  if (!/[\u3400-\u9fff]/u.test(role) || !/[\u3400-\u9fff]/u.test(scenario)) {
    throw new Error('角色或场景没有使用完整中文，请重新生成');
  }
}

/* ---------- 6) Level 4：情境对话 ---------- */
export async function startRoleplay(item) {
  const sys = `你正在扮演英语商务对话中的客户、同事或管理者，为中文母语职业人士制造一次自然的沟通机会。

目标是让学习者自己识别 trigger 并回应。硬性要求：
1. opening 必须是角色直接说出的英文，1 到 3 句，最多 55 词。
2. opening 必须真实制造 trigger，但绝不能出现或改写成目标英文骨架，不能提示“请使用某表达”。
3. scenario 用中文一句话交代已经发生的客观背景；不得写出学习者应该采取的沟通动作，也不得复述 trigger。role 用中文短语说明对方身份。
4. 只使用学习者画像和条目提供的事实。资料不足时使用中性职业场景，不虚构公司、客户名、项目数据或故障。
5. 这不是考试说明，也不是教学提示。opening 只能是对方在真实对话中会说的话。
6. 只输出 JSON：{"role":"对方身份","scenario":"中文背景","opening":"英文开场白"}`;
  const user = `【学习者画像】
${profileBlock()}

【目标条目，仅供你设计情境，绝不能泄露】
${roleplayItemBlock(item)}

生成一个与参考例句不同的新情境。`;
  const result = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    roleplayStartSchema,
    {
      temperature: 0.65,
      maxTokens: LLM_OUTPUT_TOKENS.roleplayStart,
      task: 'roleplay_start',
    },
  );
  assertChineseRoleplayContext(result.role, result.scenario);
  assertRoleplayLine(result.opening, 55);
  assertNoRoleplayLeak(result.opening, item?.skeleton);
  if (roleplayLeaksTrigger(result.scenario, item?.trigger)) {
    throw new Error('场景说明泄露了预期沟通动作，请重新生成');
  }
  return result;
}

export async function continueRoleplay(item, session) {
  const sys = `你正在延续一场两轮英语商务对话。现在只生成对方的一次英文追问。

硬性要求：
1. followup 必须紧接学习者第一轮回答，保持角色与场景一致，1 到 2 句，最多 40 词。
2. 无论学习者是否已经使用目标表达，都要自然追问，让他有机会补充具体做法或修正策略。
3. 绝不能出现目标英文骨架、中文提示、评分、纠错或“请使用某表达”。
4. 不增加用户没有提供的公司、客户名、项目数据或故障。
5. 只输出 JSON：{"followup":"英文追问"}`;
  const user = `【角色】
${session.role}

【场景】
${session.scenario}

【目标条目，仅供内部判断，绝不能泄露】
${roleplayItemBlock(item)}

【到目前为止的对话】
${roleplayTranscript(session.turns)}`;
  const result = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    roleplayContinueSchema,
    {
      temperature: 0.5,
      maxTokens: LLM_OUTPUT_TOKENS.roleplayContinue,
      task: 'roleplay_continue',
    },
  );
  assertRoleplayLine(result.followup, 40);
  assertNoRoleplayLeak(result.followup, item?.skeleton);
  return result;
}

export async function judgeRoleplay(item, session) {
  const sys = `你是英语商务沟通教练，评估一场严格限制为两轮的角色扮演对话。

判定原则：
1. trigger_recognized：学习者是否识别出场景需要的沟通动作，而不是是否复现参考答案。
2. intent_achieved：学习者是否有效完成该沟通动作。用了其他同样有效的表达也可以为 true。
3. used_target：是否自然使用目标骨架，允许槽位内容与参考例句完全不同。
4. issue_level 只有 none、minor、blocking。局部冠词、单复数、词形或时态错误且不影响理解属于 minor；人物、时间、否定、关键关系错误或句子无法理解才是 blocking。
5. clear：对方能否立即理解结论和下一步。concise：没有明显可删除的重复铺垫。
6. fix 只修正必须改的实质错误；没有则 null。tighter 只在能明显缩短且不改变分寸时提供；没有则 null。
7. retry_turn 指出最值得重练的用户回合，只能是 1 或 2；即使整体通过也选最有练习价值的一轮。
8. verdict 和 note 用简短中文。不得因为没有使用目标骨架而把一次有效沟通判成 blocking。
9. 只输出 JSON：
{"trigger_recognized":true,"intent_achieved":true,"used_target":false,"issue_level":"none|minor|blocking","clear":true,"concise":true,"verdict":"中文结论","fix":"英文修正版或 null","tighter":"英文精简版或 null","note":"中文说明","retry_turn":1}`;
  const user = `【目标条目】
${roleplayItemBlock(item)}

【角色与场景】
${session.role}；${session.scenario}

【完整对话】
${roleplayTranscript(session.turns)}`;
  return await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    roleplayJudgeSchema,
    {
      temperature: 0.1,
      maxTokens: LLM_OUTPUT_TOKENS.roleplayJudge,
      task: 'roleplay_judge',
    },
  );
}

export async function judgeRoleplayRetry(item, session, answer) {
  const turn = Number(session.result?.retryTurn || 2) === 1 ? 1 : 2;
  const userTurnIndex = turn === 1 ? 1 : 3;
  const priorTurns = session.turns.slice(0, userTurnIndex);
  const sys = `你是英语商务沟通教练，只检查一场已完成对话中的一个局部重答。
- 只根据给出的既有背景和对方原问题评价，不生成新追问，不改变原对话成绩。
- 检查学习者是否完成该回合的沟通意图、保留事实与分寸，并自然使用目标骨架。
- 大小写、标点和 ASR 断句不算错误；替代表达只要完成意图就不判语言错误。
- issue_level、feedback_kind、main_issue、fix、tighter 的约束与普通判卷相同。
- ok 必须等于 used_target && meaning_intact && issue_level != "blocking"。
- 只输出普通判卷 JSON。`;
  const user = `【目标条目】
${roleplayItemBlock(item)}

【角色与场景】
${session.role}；${session.scenario}

【重答前的既有对话】
${roleplayTranscript(priorTurns)}

【本次局部重答】
学习者：${answer}`;
  const result = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    judgeSchema,
    {
      temperature: 0.1,
      maxTokens: LLM_OUTPUT_TOKENS.judge,
      task: 'roleplay_retry',
    },
  );
  return resolveJudgement(result);
}

/* ---------------- 校验：模型只是提议者 ---------------- */
function normalize(out, mode) {
  const o = out || {};
  o.mode = mode;
  if (o.admission === 'reuse') {
    const existing = state.items.find(item => item.id === o.reuseItemId);
    if (!existing || existing.status === 'retired') {
      throw new Error('模型关联了不存在的表达，请重试');
    }
  }
  const p = o.primary || null;
  if (o.admission === 'new') {
    if (!p?.skeleton) throw new Error('模型没给出可用的骨架，请重试');
    if (
      p.kind !== 'term'
      && !/[XYZ]/.test(p.skeleton)
      && p.skeleton.split(/\s+/).length > 7
    ) {
      throw new Error('模型给出的不是可复用骨架，请重试');
    }
    if (p.kind === 'term' && !isProfessionalTermCandidate(p)) {
      throw new Error('模型没有给出可用于真实工作句的专业词汇，请重试');
    }
    o.primary = normalizeLearningItem({
      ...p,
      seeds: (p.seeds || []).slice(0, 3),
      tags: (p.tags || []).slice(0, 3),
    });
  } else {
    o.primary = null;
    o.drill = null;
  }
  if (o.bonus) {
    o.bonus.seeds = (o.bonus.seeds || []).slice(0, 3);
    o.bonus.tags = (o.bonus.tags || []).slice(0, 3);
  }
  const low = (p?.skeleton || '').toLowerCase();
  o.flagged = BLACKLIST.some(b => low.includes(b));
  return o;
}
