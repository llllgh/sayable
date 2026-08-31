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

首次打开时，Base URL、API Key 和模型标识均为空，应用不会从构建环境预填或内置任何接入点信息。按所用模型服务的文档填写配置并点击“测一下并进入”；也可以暂不接入，仅使用离线闪存。

应用支持 Chat Completions、Responses API 和 Anthropic Messages 兼容接口。模型标识可以是模型名或服务商分配的 Endpoint ID。

## Android 权限

在设置页开启召回通知后：

1. 允许通知。
2. 点击“精确提醒权限”，允许精确闹钟。
3. 点击“电池优化白名单”，允许后台提醒。
4. 国产 ROM 还需在系统设置里允许自启动。

设置页的“发送测试通知”可立即检查通知和快捷回复。正式通知只在存在到期条目时排程，答案在下次打开应用时判卷。长按桌面图标可使用“闪存”快捷入口；其他 App 分享文本时可选择“存进说得出”。

## 数据与隐私

- 学习数据：原生 SQLite；Web 版使用 IndexedDB。
- API Key：Android Keystore，不进入 SQLite、日志、备份或 APK。
- 模型请求：从设备直接发送到配置的接入点。
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

- [`docs/MVP-TODO.md`](docs/MVP-TODO.md)
- [`docs/PRD.md`](docs/PRD.md)
- [`docs/ENGINEERING.md`](docs/ENGINEERING.md)

提示词质量基线需要把 [`eval/cases.jsonl`](eval/cases.jsonl) 中的占位样例替换为 20 至 30 条真实语料后再建立，避免用合成样例制造虚假的质量结论。
