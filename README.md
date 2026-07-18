# OpenMD

OpenMD 是一个开源、跨平台的 Markdown 桌面编辑器。它以所见即所得正文编辑为默认体验，
同时提供可切换的源码模式；不会把界面改成左右分栏预览。

![OpenMD 应用图标](resources/icon.png)

> 功能截图占位：首个公开发布候选版完成 Windows/macOS 人工验收后，在此补充编辑器、工作区和导出对话框截图。

## 功能清单

- 所见即所得 Markdown 编辑（默认）与单独源码模式
- 多标签页、最近文件和文件夹工作区
- 标题、列表、任务列表、引用、GFM 表格和目录
- CodeMirror 代码块与语法高亮
- 本地/远程图片、KaTeX 公式和安全的 Mermaid 预览
- 可配置自动保存：默认延迟 1500 ms，仅保存已有路径的文档
- 独立 HTML 导出：相对资源或本地图片 Base64，包含表格、高亮、KaTeX 和 Mermaid
- A4/Letter 正文 PDF 导出：页边距、背景和浅色打印主题
- Windows NSIS 与 macOS DMG；关联 `.md` 和 `.markdown`
- 可关闭的 GitHub Releases 更新检查，不静默下载或强制安装

OpenMD MVP 不包含账号、云同步、在线协作或 AI 功能。

## 技术架构

- Electron 43、React 19、TypeScript 5.8、Vite 7、electron-vite 4
- Milkdown/Crepe 7、CodeMirror 6、Zustand 5
- Markdown-it、Highlight.js、KaTeX、Mermaid、DOMPurify
- electron-builder 26、electron-updater 6
- Vitest、React Testing Library、Playwright Electron

桌面权限只经过下面的白名单调用链：

    Renderer → contextBridge/Preload → validated IPC → Main Process

Renderer 没有 Node.js 或 Electron 直接访问能力。主窗口启用 `contextIsolation`、`sandbox` 和
`webSecurity`，禁用 `nodeIntegration`。HTML 导出先在 Renderer 中安全渲染，再由主进程写入；
PDF 使用独立的隐藏沙箱窗口，只加载导出的正文 HTML。

## 开发方式

要求 Node.js 22.12+ 和 pnpm 10+。推荐通过 Corepack 使用仓库声明的 pnpm 版本：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

常用检查：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:e2e
```

Electron E2E 会创建独立系统临时目录，并把 `userData`、Markdown、图片和导出文件全部定向到该目录；
结束时清理，不读取或写入用户真实文档。

## 构建方式

```bash
# 当前平台的生产代码
pnpm build

# 必须在 Windows 上运行，生成 x64 NSIS
pnpm dist:win

# 必须在 macOS 上运行，生成 x64 与 arm64 DMG
pnpm dist:mac
```

产物写入 `dist/`：

- `OpenMD-<version>-x64-setup.exe`
- `OpenMD-<version>-x64.dmg`
- `OpenMD-<version>-arm64.dmg`
- GitHub 更新元数据与 blockmap（发布构建时）

### Windows 安装

运行 NSIS 安装包，选择安装目录。安装器创建开始菜单快捷方式和桌面快捷方式，并注册 `.md`、
`.markdown` 文件关联。未配置代码签名的测试包可能触发 SmartScreen；公开发布前应完成真实证书签名。

### macOS 安装

选择与 CPU 对应的 DMG（Apple Silicon 使用 arm64，Intel 使用 x64），把 OpenMD 拖入
Applications。未签名测试包需要在“系统设置 → 隐私与安全性”中确认打开；不要把这种包当作正式发布包。
签名、公证和所需 Secrets 见 [发布指南](docs/RELEASING.md)。

## 自动保存与导出

自动保存只处理已经授权且具有文件路径的 dirty 标签页。每个文档拥有独立串行队列：延迟到期后读取
最新 Markdown；同一文档不会并发写入，不同文档可以并行。失败时 dirty 状态不清除并显示错误；退出
确认前等待已开始的保存结束。未命名文档永远不会由自动保存静默选择路径。

独立 HTML 禁用原始 Markdown HTML，清洗正文与 Mermaid SVG，并通过 CSP 禁止脚本。Base64 模式嵌入
已授权的本地图片；远程 HTTP(S) 图片仍保留为远程引用。PDF 复用同一静态正文，使用浅色打印 CSS，
避免代码块、表格行、公式和图表出现不合理分页。

## GitHub Actions

- Pull Request：`lint → typecheck → unit/component tests → build`
- `v*` 标签：Windows runner 构建 x64 NSIS；macOS runner 构建 x64/arm64 DMG
- 两个平台上传 Actions artifacts，并把文件附加到草稿 GitHub Release
- 未配置签名 Secrets 时生成未签名测试包；仓库不保存证书、密码或 Token

## 路线图

- 0.1.x：修复 MVP 回归、提升可访问性和大文档性能
- 发布准备：Windows/macOS 真实签名、公证、安装与文件关联矩阵验证
- 后续版本：导出模板、打印页眉页脚和更多主题兼容性

账号、云同步、在线协作和 AI 不在当前路线图范围内。

## 贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
和 [SECURITY.md](SECURITY.md)。提交 PR 前至少运行 `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build`。

## 已知限制

- 当前发布包默认未签名；正式发布需要维护者配置平台证书和 Apple 公证。
- Base64 HTML 导出只嵌入本地已授权图片，不主动下载远程图片。
- PDF 中的远程图片受网络可用性影响。
- 自动更新以 GitHub Releases 为源；开发环境、禁用设置或缺少发布元数据时不会检查。
- 更新检查支持确认下载和确认安装，但暂不提供增量下载进度 UI。
- E2E 对系统原生文件对话框使用临时路径注入，安装器 UI、SmartScreen 和 Gatekeeper 仍需人工验收。

## 许可证

[MIT](LICENSE) © OpenMD contributors.
