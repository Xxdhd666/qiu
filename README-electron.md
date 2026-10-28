# 额度悬浮球 · 第四版（Electron 桌面应用）

## 当前状态（请先读）

**本目录目前只有源码，还没有打出 `win-unpacked` 和 `.exe`。**
打包需要 `npm install` 下载 Electron 与 electron-builder（还有 Windows 版 Electron 运行时），这台 Linux 机器上没有这些，也没有离线缓存；按“不联网”的要求我没有下载。源码未在真实 Electron 里运行过，只做了语法检查和用模拟 DOM 跑渲染逻辑。**没有生成压缩包，也没有任何用网页版冒充的文件。**

## 怎么打包（需要联网一次）

在任意能联网的机器（Windows 或 Linux 均可）：

```bash
cd electron-app
npm install
npm run check      # 语法检查
npm run pack       # = electron-builder --win dir --x64
```

产物在 `electron-app/dist/win-unpacked/`，里面有 `QuotaFloat.exe`。把整个 `win-unpacked` 文件夹压成 zip 即可发给用户。
配置里 `signAndEditExecutable: false`，这样在 Linux 上打包 Windows 目录不需要 wine（代价：exe 不嵌入自定义图标）。如果打包过程仍提示需要 wine，请原样记录错误，不要改回网页版。

开发时直接 `npm start` 即可运行。

## 使用

1. 解压 `win-unpacked`，双击 `QuotaFloat.exe`（免安装，无安装向导）。
2. 屏幕上出现悬浮球；点击球打开仪表盘（620×720 固定窗口，无滚动条）。
3. 拖动悬浮球：松手时离屏幕左/右边缘 ≤30px 就自动贴边，变成窄条。窄条两行：第一行大字 `5h 43%`（主），第二行小字 `周 75%`（次）；没有 5 小时限额的池（Argon）只显示周。点击窄条恢复完整球；把窄条拖离边缘也会恢复。
4. 完整球：5 小时为主（中间大数字、外圈），周为辅（内圈、下方小字）。“悬浮球显示”页单选显示哪个池。
5. 关闭仪表盘窗口不会退出：悬浮球和系统托盘保留。**退出：右键托盘图标 → 退出。**
6. 托盘菜单：显示仪表盘 / 刷新数据 / 退出。左键单击托盘图标也会打开仪表盘。
7. 设置页：浅色 / 暗色 / 跟随系统；开机自启开关（Electron 自带 `setLoginItemSettings`，不写注册表脚本）；Antigravity 自动采集状态；立即扫描。**没有手动填入口。**

## 数据从本机哪里读

- 应用启动时和之后每 5 分钟，主进程扫描 `%USERPROFILE%\.codex\sessions\**\rollout-*.jsonl`（若设置了环境变量 `CODEX_HOME` 则读它下面的 `sessions`）。
- 取最新 rollout 里最后一个带 `rate_limits` 的 `token_count` 事件作为 Codex Plus 的 5 小时 / 周额度；每个会话取最后一个 `token_count` 作为用量表的一行（最近 10 个会话）。
- 结果写到应用数据目录（Windows 上是 `%APPDATA%\quota-float\quota-data.json`），渲染进程通过 IPC 读取，不使用 `file://` fetch。
- 只读 `sessions` 下的会话文件，**不读 `auth.json` 等授权文件，不联网，不请求任何额度 API**。找不到文件时 Codex 显示“暂无数据”，不编百分比。
- 额度数字是“最近一次 Codex 记录时的快照”，不是此刻的实时额度；刷新点已过时卡片会提示“数据可能过期”。

## Antigravity 自动采集（不手动填）

实测可用的办法：直接以交互模式跑 `agy`、把 `/usage\n` 写进 stdin 管道，
agy 会把额度以 TSV 形式打到 stdout 后退出（`agy --print "/usage"` 不行，
它会把 /usage 当成模型提问而超时）。应用主进程每 5 分钟这样跑一次，
也可在托盘“刷新数据”时立即跑，解析到的百分比就是详情页和仪表盘上
显示的三个池：Gemini 组周/5 小时、Claude周/5 小时、Argon 周。
agy 自己处理登录，应用不读、不存、不输出任何授权文件或凭证，只解析百分比。
管道输出的百分比是整数（TUI 里是两位小数，如 Argon 99.91% 会显示为 100%），
这是官方输出的取整，不是编造。
前置条件：先在运行本应用的那台电脑上安装 agy 并登录过一次，且 agy 在 PATH 里
（Windows 上还会试 %USERPROFILE%\.local\bin\agy.exe 等常见路径和 where agy）；
云主机上的 agy 登录只在云主机上有效，Windows 上要再登录一次。未登录或
找不到 agy 时，设置页会显示试过的入口和上次错误，不给手动填入口。

## 真实数据 vs 自动快照

| 数据 | 性质 |
|---|---|
| Codex Plus 额度与用量行 | 真实，来自运行本应用那台电脑的 Codex 会话文件 |
| Antigravity 三个池的初始值（2026-10-27 01:11 CST 实测） | 随 `seed.json` 带入，仅作首次启动占位，第一次自动采集成功后立即替换 |
| 初始用量表里 Argon 的 −0.09% 一行 | 2026-10-27 早期人工记录，自动采集后不再新增人工行 |
| 示例 / 编造数据 | 无 |

## 文件

| 文件 | 作用 |
|---|---|
| `main.js` | 主进程：悬浮球窗口与贴边、仪表盘窗口、托盘、定时扫描、IPC、开机自启 |
| `preload.js` | 向渲染进程暴露受限的 `window.QF` |
| `scanner.js` | 本地 rollout 扫描（也可 `node scanner.js [sessions目录]` 单独运行） |
| `renderer/dashboard.html` `app.js` `style.css` | 仪表盘（复用第三版逻辑，改为窗口化、紧凑布局、明细分页） |
| `renderer/ball.html` `ball.js` `ball.css` | 悬浮球与收起窄条 |
| `seed.json` | Antigravity 初始值 |

## 已知限制

- 仪表盘按 620×720 内容区设计；屏幕可用高度小于约 760px 时窗口会被系统限制，可能出现裁切。
- 窗口尺寸是否刚好、悬浮球贴边的手感，需要在真实 Windows 上看一遍再微调。
- 仪表盘模型图例：图例在环形图下方通栏显示，模型名可换行显示全名，不再用省略号截断。
- 未做安装包、自动更新、代码签名；首次运行 Windows SmartScreen 可能提示未知发布者。
