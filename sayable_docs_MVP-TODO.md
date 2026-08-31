# MVP TODO —— 从原型到「可独立安装使用」的移动端应用

> **Android MVP 状态（2026-08-31）**：已完成可签名安装版本，覆盖 Capacitor、SQLite、Keystore、每日 7 份备份、三种 LLM 协议、离线 outbox、本地通知与快捷回复、降频、Share Intent、桌面快捷入口、返回键、键盘处理和原生 TTS。发布 APK 位于 `android/app/build/outputs/apk/release/app-release.apk`。
>
> **尚需真实使用验证**：连接真机完成权限/通知/分享验收；提供 20~30 条个人真实语料后才能完成 T6 的质量基线。iOS 相关项不在本轮 Android MVP 范围。

> 起点：纯前端 PWA 原型，7 个文件，无构建步骤，数据在 `localStorage`。
> 目标：装一次、只配一个模型接入点（endpoint / base URL / API key）、**数据不会因为清缓存或隐身模式丢失**、离线能用、能主动找到你。
> 本清单只列**从原型到可日常依赖**这一段。中长期见 `PRD.md`，架构与契约见 `ENGINEERING.md`。

---

## 0. 先定形态（这一步决定后面所有事）

**结论：Capacitor 原生外壳 + SQLite + Keychain。现有前端代码 100% 复用，不重写。**

为什么不能停在 PWA：

| 你的要求 | 纯 PWA 能不能做到 | 原生外壳 |
| --- | --- | --- |
| 清缓存 / 隐身模式不丢数据 | ❌ iOS Safari 的 ITP 在 7 天无访问后可能清掉 PWA 的本地存储；隐身模式根本不给持久存储 | ✅ App 沙箱内 SQLite 文件，跟随 App 生命周期 |
| API Key 安全存放 | ❌ localStorage / IndexedDB 明文，任何同源脚本可读 | ✅ iOS Keychain / Android Keystore |
| **隔日召回的推送** | ⚠️ iOS 必须「添加到主屏幕」才有 Web Push，且不保证可靠 | ✅ **本地通知（Local Notifications）零服务端就能做到** |
| 系统分享面板里直接闪存 | ❌ Web Share Target 仅 Android Chrome 部分支持 | ✅ iOS Share Extension / Android Share Intent |
| 稳定的语音输入 | ❌ iOS WKWebView 里 `SpeechRecognition` 不可用 | ✅ 原生 STT / TTS 插件 |

> **重要修正**：上一轮我说「飞书机器人推送是 P0 承重墙」。有了原生外壳之后，**本地通知就能承担隔日召回，不需要任何服务端**。飞书机器人降级为 P2 的便利入口。这一条把项目从「需要后端」变回「纯客户端」，是形态选择带来的最大收益。

被否掉的备选：

- **React Native / Flutter 重写** —— 前端要重做，收益只有一点点原生质感，不值。
- **Tauri 2 Mobile** —— 移动端成熟度和插件生态还不够，插件（STT、Share Extension）要自己写。
- **PWA + `navigator.storage.persist()` + 定期自动导出** —— 可以作为**过渡形态**（见 T1.5），但不能作为最终形态，因为它解决不了隐身模式和 iOS 清理。

---

> **跨平台**：Capacitor 一套代码出 **iOS + Android + Web** 三端，`www/` 完全共享，差异全封在 `platform/`。上表以 iOS 为基准写，是因为 **iOS 是约束的来源**——满足 iOS 的方案 Android 一定能过，反之不成立。但 Android 有几条反向的坑（通知被 Doze / 国产 ROM 杀掉、原生 STT 依赖 GMS、返回键需接管），见 `ENGINEERING.md` §12。**建议先做 Android**（APK 直装、永不过期、Share Intent 简单一个量级），iOS 在 W4 末补。

---

## T1｜壳与持久化（决定「能不能被依赖」）

- [ ] **T1.1** 引入 Capacitor：`npm i @capacitor/core @capacitor/cli && npx cap init`，加 iOS / Android 平台。现有 `index.html / css / js` 原样放进 `www/`，不改一行业务代码。
- [ ] **T1.2** 引入构建：加 Vite（只做打包和 TS 检查，**不引框架**）。原型是原生 ESM，迁移成本≈0。
- [ ] **T1.3** **存储层换成 SQLite**（`@capacitor-community/sqlite`）：
  - 抽出 `storage.js` 接口：`get/set/query/tx`，Web 走 IndexedDB（`idb-keyval` 或 `sql.js`），原生走 SQLite。**业务代码只依赖接口，不依赖实现。**
  - 建 `schema_version` 表 + 顺序迁移函数数组，`migrate(from, to)`，每次启动跑一次。**从第一天就要有，后面加字段不至于丢数据。**
  - 写操作全部走事务；一次崩溃不能留下半条记录。
- [ ] **T1.4** **API Key 移出普通存储**：用 `capacitor-secure-storage-plugin`（iOS Keychain / Android EncryptedSharedPreferences）。Key 不进 SQLite、不进日志、不进导出文件（导出时留空并提示重填）。
- [ ] **T1.5**（过渡可选）Web 版仍保留：`navigator.storage.persist()` + IndexedDB + **每次启动检测存储是否被清空，若被清空则提示从最近一次备份恢复**。
- [ ] **T1.6** **自动本地备份**：每天一次把整库导出成 JSON 写入 App 文档目录，滚动保留 7 份；设置页一键「导出到文件 / 分享」。
- [ ] **T1.7** 首启迁移：如果检测到旧 PWA 的 `localStorage.sayable.v1`，一次性导入 SQLite 后清掉。

**完成判据**：装上 App → 造一条数据 → 杀进程 → 清系统缓存 → 重开，数据还在；Key 在 Keychain 里，`sqlite3` 打开数据库文件搜不到 `sk-`。

---

## T2｜只配一个接入点就能跑（LLM 接入层）

- [ ] **T2.1** **Provider 抽象**：`{ label, protocol, baseUrl, apiKey, model, timeoutMs, maxRetry }`，`protocol ∈ chat_completions | anthropic_messages | responses`。业务只调 `llm.capture() / llm.judge() / llm.compress() / llm.preflight()`，不知道协议差异。
- [ ] **T2.2** **首启引导只有一屏**：三个输入框 + 「测一下」。测通才允许进主界面（也允许「先用演示模式」）。
- [ ] **T2.3** **能力探测**：测试请求里探测 ① 是否支持 `response_format: json_object` ② 是否支持 `stream` ③ 上下文长度。不支持结构化输出时自动切到「提示词强约束 + 容错解析」路径（去 ```json 围栏、抽第一个平衡花括号、`JSON.parse` 失败再修一次）。
- [ ] **T2.4** **错误分级**，每一级有明确的用户动作，不许出现「请求失败」这种死胡同：

  | 类型 | 判断 | 处理 |
  | --- | --- | --- |
  | 鉴权 | 401 / 403 | 直接跳设置页并高亮 Key，不重试 |
  | 模型不可用 | 404 / `model is not allowed` | 提示换模型名，附上「测一下」按钮 |
  | 限流 | 429 / 5xx | 指数退避重试 ≤3 次，仍失败则进 outbox |
  | 网络 | timeout / offline | **不报错**，静默进 outbox，原文已经在闪存里，一条都不会丢 |
  | 输出不合规 | schema 校验失败 | 带校验错误修一次；再失败则只保留原文 + 提示「这条没分析成功，可重试」，**绝不落库半成品** |

- [ ] **T2.5** **成本护栏**：每日调用上限（默认 60 次）、单次 max_tokens 上限、设置页显示本月估算用量。超限时只挡「分析」，不挡闪存和召回。
- [ ] **T2.6** **隐私声明写进 App**：一句话说清「请求直接从本机发往你配置的接入点，不经过任何第三方服务器；数据只在本机」。

**完成判据**：飞行模式下全程可用（闪存 / 召回 / 句库 / 阶梯），联网后 outbox 自动补分析；故意填错 Key 能被一句话指到该改哪里。

---

## T3｜离线优先与队列

- [ ] **T3.1** **闪存 = 唯一的写入入口，永不联网**。`inbox` 同时充当 outbox：`status ∈ raw | analyzing | done | failed`。
- [ ] **T3.2** 恢复联网 / 回到前台时自动处理 `raw` 与 `failed`（一次最多 3 条，避免一口气烧 token）。
- [ ] **T3.3** **判卷离线降级**：网络不可用时召回不中断，改为自评三档（我说对了 / 差一点 / 没说出来）。已有 fallback 分支，需要接到离线检测上。
- [ ] **T3.4** 骨架 TTS 离线可用：首次朗读时缓存音频，或直接用原生 TTS。

---

## T4｜触达（承重墙，本地通知即可）

- [ ] **T4.1** `@capacitor/local-notifications`：每天一条，默认 21:30，可改；**静默时段**（会议中 / 夜间）不打扰。
- [ ] **T4.2** 通知文案就是题目本身：`「瓶颈从 A 转到 B」怎么说？` —— 点开直接进那道题，不落首页。
- [ ] **T4.3** 只在**真有到期条目**时发，没有就不发。宁可不响，不要变成噪音。
- [ ] **T4.4** iOS 通知快捷回复（`UNTextInputNotificationAction`）：**不打开 App 就能作答**，回前台后再判卷。这是把召回成本压到最低的关键一步。
- [ ] **T4.5** 连续 3 天未响应自动降频到隔日 → 每周，恢复响应后回到每日。**不惩罚、不催、不算欠账。**
- [ ] **T4.6** **Android 通知可靠性专项**（不做的话表现是「用了三天通知就没了」）：申请 `POST_NOTIFICATIONS`（API 33+）、`USE_EXACT_ALARM`（12+）、引导关闭电池优化、国产 ROM 自启动白名单引导、**每次回前台重排未来 7 天通知**。详见 `ENGINEERING.md` §12.2。

**完成判据**：连续 7 天，每天在通知里完成 ≥1 次召回，全程不需要主动打开 App。

---

## T5｜2 秒捕获（系统级）

- [ ] **T5.1** **iOS Share Extension / Android Share Intent**：任意 App（飞书、YouTube、Safari、备忘录）选中文字 → 分享 → 「存进说得出」→ 直接落 inbox，**不打开主 App**。注意 iOS 的 Share Extension 是独立进程、拿不到主 App 的 SQLite，需先写 App Group 共享文件再由主 App 摄取（`ENGINEERING.md` §12.3）；Android 的 `ACTION_SEND` 没这个问题。
- [ ] **T5.2** 主屏 Widget / 快捷指令：一键唤起「闪存」输入框（Android 支持快捷方式，iOS 用 App Shortcuts）。
- [ ] **T5.3** **语音输入分两步**：① 先做零成本路径——聚焦 textarea，用系统输入法自带语音（三端通用，国内输入法中英混合识别比 Android 原生 STT 更好）；② 检测到原生 STT 可用时才升级为「长按即录、松手即存」。iOS WKWebView 里 Web Speech 不可用、Android 原生 STT 依赖 GMS（国产 ROM 无），所以**必须先有降级路径**，不能反过来。
- [ ] **T5.6** **Android 返回键接管**（`@capacitor/app` backButton）。不做的话任何页面按返回都直接退出 App——最容易漏、体验最致命。
- [ ] **T5.7** 键盘遮挡处理（`@capacitor/keyboard`，`resize: 'body'`）。
- [ ] **T5.4** 冷启动 < 800ms 且**输入框自动获得焦点**。捕获路径上任何一次多余点击都要当 bug 处理。
- [ ] **T5.5** 草稿逐字持久化（已有，需迁到 SQLite），进程被杀也不丢。

**完成判据**：从「听到一句话」到「已存下」≤ 5 秒，且中途不需要看屏幕做任何判断。

---

## T6｜提示词质量（这个产品的真正护城河）

- [ ] **T6.1** 建 `eval/cases.jsonl`：**用你自己的 20~30 条真实语料**（你写过的英文邮件、会上说过的话、听到的表达），标注期望结果（该抽出什么骨架 / 该判定为不值得收）。
- [ ] **T6.2** 一个离线跑分脚本，输出三个数：① 骨架可用率（你会点头说「这个我以后肯定会说」的比例，目标 ≥70%）② 病症诊断命中率 ③ LLM 味误报率（推荐了黑名单风格表达的比例，目标 0）。
- [ ] **T6.3** 提示词版本化，每次改动跑一遍回归，结果记进 `eval/history.md`。**这是唯一能防止「改好了一个 case、悄悄弄坏三个」的机制。**
- [ ] **T6.4** 黑名单可配置并随用随加（你自己觉得别扭的表达随时拉黑）。

---

## T7｜发布与可观测

- [ ] **T7.1** 本地日志（环形缓冲，最多 500 条）：调用耗时、失败原因、token 用量。设置页可查看和导出，**不上报**。
- [ ] **T7.2** 崩溃后恢复：启动时检测未完成事务，回滚并提示。
- [ ] **T7.3** 分发：iOS 走 TestFlight 或企业签名；Android 直接给 APK。**不上应用商店**——单用户工具没必要。
- [ ] **T7.4** `README` 写清一次性配置流程（三个字段从哪来）。

---

## 排期建议（一个人，兼职推进）

| 周 | 内容 | 交付 |
| --- | --- | --- |
| W1 | T1（壳 + SQLite + Keychain + 迁移 + 备份） | 装机版，数据不会丢 |
| W2 | T2 + T3（接入层 + 错误分级 + 离线队列） | 只配一个接入点就能日常用 |
| W3 | T4 + T5.3（本地通知 + 快捷回复 + 原生语音） | **承重墙立起来，不用主动打开 App** |
| W4 | T5 其余（Share Extension / Widget） + T6.1~T6.2 | 2 秒捕获 + 有了质量基线 |

W4 结束后**停手，只用不加功能**，跑满 14 天，按 `PRD.md` 的验证判据决定下一步。

---

## 刻意不做的（写下来防止手痒）

- 账号体系、云同步、多设备（先证明闭环有效；真要同步，用你自己的网盘同步那个 SQLite 文件，不做服务端）
- 发音评分、语法课程、词汇量统计
- 图谱可视化、embedding 检索
- 社交、排行榜、连续打卡天数
- 后端服务（本地通知已经覆盖了唯一必须的服务端理由）
