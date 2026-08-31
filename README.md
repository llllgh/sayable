# 说得出 · Sayable

离线优先的个人英语表达训练器。Android MVP 使用 Capacitor 原生外壳，学习数据写入应用沙箱内的 SQLite，API Key 写入 Android Keystore。

## 安装 Android 版

已签名的 APK：

`android/app/build/outputs/apk/release/app-release.apk`

通过 USB 安装：

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

也可以把 APK 发送到手机后直接打开。Android 可能要求允许当前文件管理器“安装未知应用”。
如果此前安装过 Debug APK，需要先卸载；Debug 与 Release 的签名不同，不能互相覆盖。

首次打开时选择“中国大陆 / 海外”，并分别填写空白的模型 API Key 和语音 API Key。应用会验证文本模型、ASR 鉴权和 TTS，全部成功后才保存凭证并进入主界面。协议、公共 Base URL 和公共模型名由区域 Profile 管理，不会从本机构建环境读取私人接入参数。高级自定义配置默认折叠，其中的用户输入框在首次启动时为空。

应用支持 Chat Completions、Responses API 和 Anthropic Messages 兼容接口。需要使用其他兼容服务时，可以在设置页展开高级模型配置。

## 语音模式

- 系统语音：无需凭证，朗读使用 Android TTS；语音输入不可用时聚焦输入框，由系统输入法提供语音输入。
- 云端增强：首启时填写独立的语音 API Key，使用当前区域 Profile 的流式 ASR 和自然语音 TTS；后续可在设置页更换。
- 云端语音失败、离线或未配置时，朗读自动回退到系统 TTS；录音原始数据不写入数据库或备份。
- MVP 反馈只覆盖可懂度、完整度、流利度和节奏，不宣称提供音素级发音评分。

## Android 权限

在设置页开启召回通知后：

1. 允许通知。
2. 点击“精确提醒权限”，允许精确闹钟。
3. 点击“电池优化白名单”，允许后台提醒。
4. 国产 ROM 还需在系统设置里允许自启动。

设置页的“发送测试通知”可立即检查通知和快捷回复。正式通知只在存在到期条目时排程，答案在下次打开应用时判卷。长按桌面图标可使用“闪存”快捷入口；其他 App 分享文本时可选择“存进说得出”。

## 数据与隐私

- 学习数据：原生 SQLite；Web 版使用 IndexedDB。
- 模型与语音 API Key：按区域分别写入 Android Keystore，不进入 SQLite、Capacitor 日志、备份或 APK。
- 模型与云端语音请求：从设备直接发送到当前区域 Profile 的服务。
- 自动备份：每天一次，应用私有目录保留最近 7 份。
- 手动备份：设置 → 导出 JSON，不包含 API Key。
- 系统云备份：关闭，避免 SQLite 和安全配置进入 Android 云备份。

卸载应用会删除 SQLite 和私有自动备份。需要重装前应先导出 JSON。

## 本地开发

前置条件：

- Node.js 20+
- JDK 21
- Android SDK Platform 36
- Android SDK Build-Tools 35.0.0
- Android Platform Tools

```bash
npm install
cp .env.example .env
npm run dev
npm test
npm run check
```

构建与安装：

```bash
npm run android:debug
npm run android:release
npm run android:install
```

首次生成发布签名：

```bash
bash scripts/create-release-keystore.sh
```

必须安全备份以下两个本地文件，否则以后无法覆盖升级已安装的发布版：

- `android/sayable-release.keystore`
- `.env` 中的 `ANDROID_RELEASE_*` 参数

这两个文件均已加入 `.gitignore`。

## 验证

```bash
npm test
npm run check
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ./gradlew testDebugUnitTest lintDebug
```

工程与产品契约见：

- [`sayable_docs_MVP-TODO.md`](sayable_docs_MVP-TODO.md)
- [`sayable_docs_PRD.md`](sayable_docs_PRD.md)
- [`sayable_docs_ENGINEERING.md`](sayable_docs_ENGINEERING.md)

提示词质量基线需要把 [`eval/cases.jsonl`](eval/cases.jsonl) 中的占位样例替换为 20 至 30 条真实语料后再建立，避免用合成样例制造虚假的质量结论。
