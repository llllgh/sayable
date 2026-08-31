# 工程实现文档（ENGINEERING）

> 面向要把 `sayable` 原型做成可安装移动端应用的开发者。
> 配套：`PRD.md`（需求与分期）、`MVP-TODO.md`（近 4 周清单）

---

## 1. 目标形态与技术选型

```
┌──────────────────────────────────────────────┐
│  iOS / Android 原生外壳（Capacitor 6）        │
│  ├─ WebView：现有前端（原生 ESM，Vite 打包）   │
│  ├─ SQLite 插件      → 业务数据（唯一真源）    │
│  ├─ SecureStorage    → API Key（Keychain）    │
│  ├─ LocalNotifications → 隔日召回             │
│  ├─ SpeechRecognition / TTS → 语音            │
│  └─ Share Extension / Intent → 2 秒捕获       │
└──────────────────────────────────────────────┘
                     │ HTTPS（直连，无中间服务器）
                     ▼
        用户自己配置的 OpenAI-compatible 接入点
```

**无服务端。** 唯一曾经需要服务端的理由是推送，本地通知已经覆盖。

选型理由与被否方案见 `MVP-TODO.md` §0。

---

## 2. 目录结构（目标态）

```
sayable/
├─ www/                      # WebView 资源（Vite 输出）
├─ src/
│  ├─ main.ts                # 启动、路由、迁移、onboarding
│  ├─ ui.ts                  # 组件与弹层（无框架，直接 DOM）
│  ├─ views/                 # home / capture / drill / compress / preflight / library
│  ├─ core/
│  │  ├─ scheduler.ts        # 固定阶梯，纯函数，可单测
│  │  ├─ item.ts             # 骨架实体与状态机
│  │  └─ profile.ts
│  ├─ llm/
│  │  ├─ provider.ts         # 协议适配：chat_completions / anthropic / responses
│  │  ├─ client.ts           # 超时、重试、错误分级、JSON 容错解析
│  │  ├─ schema.ts           # 输出契约校验（zod）
│  │  └─ prompts/            # 每个任务一个文件，版本化
│  ├─ storage/
│  │  ├─ index.ts            # 唯一对外接口，业务只依赖它
│  │  ├─ sqlite.native.ts    # Capacitor SQLite
│  │  ├─ idb.web.ts          # Web 降级
│  │  ├─ migrations.ts       # 顺序迁移数组
│  │  └─ backup.ts           # 每日自动备份 + 导出/导入
│  ├─ platform/              # notify / speech / share / secure —— 全部带 web stub
│  └─ outbox.ts              # 离线待分析队列
├─ eval/                     # 提示词评测集与跑分脚本
├─ ios/  android/            # npx cap add 生成
└─ docs/                     # PRD / MVP-TODO / 本文件
```

**平台隔离铁律**：`platform/` 下每个模块都必须有 web stub，保证 `npm run dev` 在浏览器里全功能可跑（语音降级为文本、通知降级为 console）。否则开发效率会被真机调试拖垮。

---

## 3. 数据模型（SQLite）

```sql
-- 迁移版本
CREATE TABLE schema_version (version INTEGER NOT NULL);

-- 闪存 / 待处理队列（= outbox）
CREATE TABLE flash (
  id          TEXT PRIMARY KEY,
  raw         TEXT NOT NULL,             -- 原文，永不修改
  mode        TEXT NOT NULL,             -- translate | improve | derive | compress | unknown
  source      TEXT,                      -- meeting | video | chat | share | voice
  status      TEXT NOT NULL DEFAULT 'raw', -- raw | analyzing | done | failed
  fail_reason TEXT,
  created_at  INTEGER NOT NULL
);

-- 骨架（学习单元）
CREATE TABLE item (
  id            TEXT PRIMARY KEY,
  skeleton      TEXT NOT NULL,           -- The bottleneck has shifted from X to Y.
  slots         TEXT NOT NULL,           -- JSON: ["X","Y"]
  gloss_zh      TEXT NOT NULL,           -- 中文语义提示（出题用）
  why_good      TEXT,
  origin_raw    TEXT,                    -- 来源原文
  origin_flash  TEXT REFERENCES flash(id),
  box           INTEGER NOT NULL DEFAULT 0,
  due_at        INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'learning', -- learning | owned | retired
  real_use_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_item_due ON item(due_at) WHERE state != 'retired';

-- 每次产出（造句 / 答题 / 真实使用）
CREATE TABLE production (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES item(id),
  kind       TEXT NOT NULL,   -- immediate | drill | real_use
  drill_type TEXT,            -- cued_recall | pattern_completion | generation
  user_text  TEXT NOT NULL,
  verdict    TEXT,            -- natural | risky | miss | self_ok | self_miss
  feedback   TEXT,
  scene      TEXT,            -- real_use 时记录：在哪用的
  created_at INTEGER NOT NULL
);

-- 压缩练习
CREATE TABLE compression (
  id TEXT PRIMARY KEY, original TEXT NOT NULL, compressed TEXT,
  patterns TEXT, created_at INTEGER NOT NULL
);

-- 画像
CREATE TABLE profile (k TEXT PRIMARY KEY, v TEXT);

-- 病症档案（Phase 3）
CREATE TABLE symptom (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  hit_count INTEGER DEFAULT 0, last_hit_at INTEGER
);

-- 本地日志（环形，最多 500 条）
CREATE TABLE log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, event TEXT,
  detail TEXT, ms INTEGER, tokens INTEGER, created_at INTEGER
);
```

**settings 不入 SQLite 的部分**：`apiKey` 只进 SecureStorage。`baseUrl / model / protocol / remindAt` 可以进 profile 表。

**迁移写法**（第一天就要有）：

```ts
const migrations: Array<(db: DB) => Promise<void>> = [
  m0_init,        // 建上面所有表
  m1_from_pwa,    // 读 localStorage 'sayable.v1' 导入，成功后删除
  // 以后每加一版往后 push，绝不修改已发布的函数
];
```

---

## 4. 存储接口（业务唯一依赖面）

```ts
export interface Storage {
  ready(): Promise<void>;
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;   // 所有写操作必须在事务里
  // 闪存
  addFlash(raw: string, mode: Mode, source?: string): Promise<string>;
  listFlash(status?: FlashStatus): Promise<Flash[]>;
  setFlashStatus(id: string, s: FlashStatus, reason?: string): Promise<void>;
  dropFlash(id: string): Promise<void>;
  // 骨架
  addItem(i: NewItem): Promise<string>;
  listDue(now: number, limit?: number): Promise<Item[]>;
  listItems(f?: { state?: ItemState; q?: string }): Promise<Item[]>;
  applyReview(itemId: string, passed: boolean, now: number): Promise<Item>;
  markRealUse(itemId: string, scene: string): Promise<Item>;
  // 产出
  addProduction(p: NewProduction): Promise<void>;
  // 其他
  getProfile(): Promise<Profile>;  setProfile(p: Partial<Profile>): Promise<void>;
  exportAll(): Promise<Snapshot>;  importAll(s: Snapshot): Promise<void>;
}
```

`applyReview` 与 `markRealUse` 里同时完成状态跃迁（`box ≥ 4 && real_use_count ≥ 3 → owned`），**不要把这个判断散落到 view 层**——原型里就是散的，迁移时收拢。

---

## 5. 调度器（纯函数，必须有单测）

```ts
const BOXES_DAYS = [0, 1, 3, 7, 21, 60];
const RETRY_MS = 8 * 3600_000;

export function next(box: number, passed: boolean, now: number) {
  const b = passed ? Math.min(box + 1, BOXES_DAYS.length - 1) : Math.max(box - 1, 0);
  const dueAt = passed ? now + BOXES_DAYS[b] * 86400_000 : now + RETRY_MS;
  return { box: b, dueAt };
}

export function isOwned(box: number, realUse: number) {
  return box >= 4 && realUse >= 3;
}
```

单测覆盖：连续通过到 owned、中途失败退格、box 0 失败不为负、同一天多次答题不重复推进。

---

## 6. LLM 接入层

### 6.1 Provider 适配

```ts
type Protocol = 'chat_completions' | 'anthropic_messages' | 'responses';
interface ProviderConfig {
  protocol: Protocol; baseUrl: string; apiKey: string; model: string;
  supportsJsonMode?: boolean;  // 由自检探测，不让用户填
  timeoutMs: number;           // 默认 30000
}
```

三种协议只在 `request()` 和 `extractText()` 两个函数里有分支，其余共用。

### 6.2 自检（首启唯一一次配置的核心体验）

```
POST {baseUrl}/chat/completions
body: { model, messages:[{role:'user',content:'Reply with {"ok":true} only.'}],
        response_format:{type:'json_object'}, max_tokens: 20 }
```

- 200 且能解析 JSON → `supportsJsonMode = true`，配置完成。
- 200 但不是 JSON / 400 提示不支持 `response_format` → 去掉该字段重试一次，成功则 `supportsJsonMode = false`（走容错解析）。
- 401/403 → 「Key 不对或没权限」。
- 404 或 `model is not allowed` → 「接入点通了，但这个模型名不可用」，并提示常见写法（有些网关要填 endpoint id 而非模型名）。
- 超时 → 「接入点无响应，检查 base URL 是否带 `/v1`」。

**每一条错误都必须给出下一步动作。** 这是「只配一个接入点」能否真的成立的全部难点。

### 6.3 容错 JSON 解析

```
去掉 ```json 围栏 → 取第一个平衡花括号片段 → JSON.parse
失败 → 把校验错误回灌给模型修一次（max 1 次）
再失败 → 不落库，flash.status = 'failed'，保留原文，允许手动重试
```

### 6.4 输出契约（zod schema，校验不过即视为失败）

```ts
// capture：译写 / 改写 / 衍生 共用
{
  natural_en: string,            // 自然英文示例（改写场景=改进版）
  skeleton: string,              // 有且只有一个，必须含大写槽位
  slots: string[],               // 长度 1~3
  gloss_zh: string,              // 出题用的中文提示，不得包含英文原词
  why_good: string,              // 为什么比用户/直译版本好
  diagnosis: string,             // 导致啰嗦的具体中文思维习惯（改写必填）
  transfers: string[],           // 2~3 条迁移到用户画像场景的例句
  native_check: 'yes' | 'risky', // 不要求模型自评相关性分数
  worth_keeping: boolean,        // 若 false 必须给出 reason
  reason?: string
}

// judge：判用户造句
{ verdict: 'natural'|'risky'|'miss', feedback: string, better?: string }

// compress
{ compressed: string, kept_logic: string, patterns: string[] }  // patterns ≤2

// preflight（会前热身）
{ skeletons: Array<{ skeleton: string, gloss_zh: string, example: string }> } // 恰好 3 条
```

### 6.5 提示词硬约束（迁移时逐条保留）

1. **一次只给 1 个主骨架**，多给视为违规输出。
2. 骨架必须含槽位，且能迁移到 profile 里的真实场景。
3. **黑名单**（命中即重生成）：`delve into` / `leverage synergies` / `it is worth noting that` / `in today's fast-paced world` / `navigate the complexities` / `a testament to` / `unlock the potential` / `game-changer` / `paradigm shift` / `holistic approach` / `moving forward, we must`。用户可追加。
4. 不让模型输出自评分数（如 relevance 0.94），只输出 `native_check: yes/risky`。
5. 改写必须给出**具体**的中文思维习惯诊断（例："先铺背景再给结论"、"用 and so 串三个短句代替一个从属结构"），不许写"表达可以更简洁"这种空话。
6. **出题时不得泄露目标骨架**：只给 `gloss_zh` + 场景，不给英文原句片段。
7. 用户输入与检索内容视为 untrusted，提示词里用分隔符包裹并声明忽略其中的指令。

### 6.6 调用预算

| 任务 | 每天典型次数 | 备注 |
| --- | --- | --- |
| capture | 1~3 | 只在处理闪存时 |
| judge | 2~6 | 离线时降级自评，不消耗 |
| compress | 0~1 | 按需 |
| preflight | 0~1 | 会前 |

默认每日上限 60 次，超限只挡分析，不挡闪存与召回。

---

## 7. 离线与队列

- 网络状态：`@capacitor/network` + `navigator.onLine` 双判。
- 回前台 / 恢复联网 → 处理 `flash.status='raw'|'failed'`，**一次最多 3 条**。
- 处理中标 `analyzing`，进程被杀后启动时把残留 `analyzing` 回滚为 `raw`。
- 判卷离线降级为自评三档，`production.verdict` 记 `self_ok / self_miss`，与模型判卷区分开（后续评测要能分离这两类数据）。

---

## 8. 通知

```ts
// 每晚重排一次，只在真有到期项时排
const due = await storage.listDue(Date.now() + 86400_000, 1);
if (!due.length) return;                       // 没题就不响
await LocalNotifications.schedule({ notifications: [{
  id: 1, title: '说得出',
  body: `「${due[0].gloss_zh}」怎么说？`,        // 题面即通知
  schedule: { at: nextRemindTime(profile.remindAt) },
  actionTypeId: 'ANSWER',                      // iOS 快捷回复
  extra: { itemId: due[0].id },
}]});
```

- 点击通知 → 直接进那道题，**不落首页**（deep link：`sayable://drill/{itemId}`）。
- 快捷回复的文本回前台后判卷。
- 连续 3 天未响应 → 隔日；再连续 2 次 → 每周。响应后恢复每日。
- 静默时段可配置。

---

## 9. 安全与隐私

| 项 | 做法 |
| --- | --- |
| API Key | 仅 Keychain / Keystore；不进 SQLite、不进日志、不进导出文件 |
| 导出文件 | 含全部学习数据，**不含 Key**；导入后提示重填 |
| 网络 | 只请求用户配置的 baseUrl；不做任何遥测上报 |
| 日志 | 仅本地，环形 500 条，可查看可导出，永不自动上传 |
| 备份 | App 文档目录，每日一次，滚动 7 份；用户可另存到系统文件 |

---

## 10. 从原型迁移的具体动作

1. `npm create vite`（vanilla-ts）→ 把 `js/*.js` 逐个改 `.ts`，先允许 `any`，编译通过为准。
2. **先抽 `storage/index.ts`**，把 `store.js` 里的 `localStorage` 读写全部换成接口调用。这一步做完，替换底层实现就是纯机械工作。
3. **清理 `store.js` 已知问题**：state 对象里 `inbox` / `draft` 出现了重复定义（后者覆盖前者），迁移时删掉重复键。
4. 把散在 `views.js` 里的状态跃迁判断收拢到 `core/item.ts`。
5. `npx cap add ios android`，跑通空壳。
6. 接 SQLite → 跑迁移 `m1_from_pwa`（真机上装过 PWA 的话能直接带数据过来）。
7. 接 SecureStorage → 迁 Key。
8. 接 LocalNotifications → 承重墙立起。
9. 之后按 `MVP-TODO.md` T5 / T6 推进。

**验收顺序不要变**：数据不丢 → 接入点可配 → 通知能响 → 捕获变快 → 质量可回归。任何一步没达标就往下走，后面都会返工。

---

## 11. 测试

| 层 | 内容 | 工具 |
| --- | --- | --- |
| 单元 | scheduler、状态跃迁、JSON 容错解析、schema 校验 | vitest |
| 迁移 | 每个 migration 的前后快照断言 | vitest |
| 契约 | 用固定 fixture 回放模型输出，校验 schema | vitest |
| 提示词 | `eval/cases.jsonl` 跑分（骨架可用率 / 诊断命中 / LLM 味误报） | 自写脚本 |
| 真机 | 杀进程、清缓存、飞行模式、通知点击 deep link | 手动 checklist |

必须手动跑的真机 checklist（每次发版）：

- [ ] 飞行模式下：闪存、召回、句库、导出全部可用
- [ ] 杀进程后草稿仍在
- [ ] 系统设置里清除 App 缓存后数据仍在
- [ ] 通知点击直达题目
- [ ] 填错 Key 有明确指引
- [ ] 导出文件里搜不到 `sk-`

---

## 12. 跨平台支持矩阵

一套 TypeScript 代码 → **iOS / Android / Web 三端**。`www/` 完全共享，平台差异全部封在 `platform/` 目录下，业务代码不感知。

### 12.1 能力对照

| 能力 | iOS | Android | Web（开发用） |
| --- | --- | --- | --- |
| SQLite 持久化 | ✅ `@capacitor-community/sqlite` | ✅ 同插件 | ⚠️ 降级 IndexedDB（可能被清） |
| Key 安全存储 | ✅ Keychain | ✅ EncryptedSharedPreferences / Keystore | ⚠️ 降级明文，仅本地开发 |
| 本地通知 | ✅ | ✅ **但需处理 Doze / OEM 限制，见 12.2** | ⚠️ Notification API，不可靠 |
| 通知内直接作答 | ✅ `UNTextInputNotificationAction` | ✅ `RemoteInput`，**体验比 iOS 更好** | ❌ |
| 系统分享面板捕获 | ⚠️ Share Extension，**要 App Group，见 12.3** | ✅ `intent-filter ACTION_SEND`，简单 | ❌ |
| 语音输入 | ✅ 原生 STT | ⚠️ **依赖 GMS，国产 ROM 需降级，见 12.4** | ⚠️ 仅 Chrome |
| TTS 朗读 | ✅ | ✅ | ✅ |
| 导出文件 | ✅ 分享面板 | ⚠️ Scoped Storage，走 SAF | ✅ 下载 |
| 分发成本 | ⚠️ 高（见 12.6） | ✅ **低，APK 直装** | ✅ 零 |

**结论：Android 在「装机自用」这件事上比 iOS 更省事，但在「后台可靠性」上比 iOS 更麻烦。**

### 12.2 Android 独有坑：通知可靠性（最需要认真对待的一条）

隔日召回是这个产品的承重墙，而 Android 会主动杀掉它：

- [ ] **权限**：Android 13+（API 33）`POST_NOTIFICATIONS` 是运行时权限，必须显式申请，不申请就静默不发。
- [ ] **精确闹钟**：Android 12+ 需 `SCHEDULE_EXACT_ALARM`，13+ 建议 `USE_EXACT_ALARM`。否则通知时间会被系统合并漂移（21:30 可能变成 23:00 才响）。
- [ ] **Doze / 电池优化**：引导用户执行一次 `requestIgnoreBatteryOptimizations`。
- [ ] **国产 ROM 自启动白名单**（小米「自启动管理」、华为「应用启动管理」、OPPO/vivo「后台冻结」）——这些 ROM 会在杀后台时连带清掉已排定的 AlarmManager 任务。**Capacitor 插件解决不了，只能在首启做一次引导。**
- [ ] **兜底策略**：不要只依赖单次排程。每次 App 回到前台就**重排未来 7 天的通知**（`LocalNotifications.getPending()` 比对后补齐）。这样即使被杀过一次，下次打开就自动恢复。

> 这一条如果不做，Android 上的表现会是「用了三天通知就没了」，而且用户根本不知道为什么。

### 12.3 iOS 独有坑：Share Extension 拿不到主 App 的数据库

Share Extension 是**独立进程**，无法直接读写主 App 沙箱里的 SQLite。两种做法：

- **推荐（简单）**：Extension 只把原文写进 App Group 共享目录的一个 `pending.jsonl`；主 App 下次启动时摄取并落库。闪存本来就不需要即时反馈，这个延迟完全可接受。
- 复杂做法：把 SQLite 文件放进 App Group 容器，两边共享——要处理跨进程锁，不值得。

Android 侧不存在这个问题，`ACTION_SEND` 直接唤起主 App 的一个透明 Activity 即可。

### 12.4 Android 语音降级（国产 ROM 必做）

`@capacitor-community/speech-recognition` 在 Android 上走 Google `SpeechRecognizer`，**无 GMS 的国产 ROM 直接不可用**。

降级方案很划算：**直接聚焦 textarea，让用户用系统输入法自带的语音输入**。国内输入法（讯飞、百度、搜狗）的中英混合识别质量普遍好于 Google Android STT，而且零代码、零权限。

所以实现顺序应该是：
1. 先做「聚焦输入框」这条零成本路径（三端通用）；
2. 检测到原生 STT 可用时才升级为「长按即录」。

不要反过来——反过来会在国产机上直接不可用。

### 12.5 Android 其他必做项

- [ ] **返回键**：`@capacitor/app` 的 `backButton` 必须接管。不接管的话，用户在任何页面按返回都会直接退出 App——这是最容易被忽略、体验最致命的一条。
- [ ] **键盘遮挡**：`@capacitor/keyboard` 设 `resize: 'body'`，否则输入框被键盘顶掉。
- [ ] **minSdk 24+**，Vite `target: 'es2020'`。Android WebView 版本随系统走，老设备可能缺 API。
- [ ] **导出文件**：Android 10+ Scoped Storage，用 `Filesystem` 写 `Directory.Documents` + 分享，或走 SAF 让用户选位置。

### 12.6 分发

| 平台 | 方式 | 成本 |
| --- | --- | --- |
| Android | 构建 release APK 直接装 | 自签名即可，**永不过期**，最适合自用 |
| iOS | TestFlight | 需 99 美元/年开发者账号，构建 90 天过期 |
| iOS | 免费个人签名（Xcode 直连） | 免费，但 **7 天就要重签**，日常自用很痛苦 |
| iOS | 企业签名 | 视公司资源 |

### 12.7 实施顺序建议：先 Android，再 iOS

理由：

1. 分发零成本、零过期，改一版装一版，迭代快 3 倍。
2. Share Intent 比 iOS Share Extension 简单一个量级（不用 App Group、不用共享容器）。
3. `adb logcat` + Chrome DevTools 远程调试 WebView，比 Safari Web Inspector 顺手。
4. Android 的通知坑（12.2）**必须在架构里预留「回前台重排」机制**，这个机制在 iOS 上也是有益的；反过来先做 iOS 则容易漏掉它，后期补要改调度逻辑。

`MVP-TODO.md` 的 W1~W4 排期在 Android 上执行，iOS 只在 W4 末做一次 `npx cap add ios` 验证——业务代码不用改，只需补 12.3 的 Share Extension 与签名。
