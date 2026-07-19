<div align="center">
  <img src="resources/icon.png" width="112" height="112" alt="OpenMD 图标">
  <h1>OpenMD</h1>
  <p><strong>打开就能写的本地 Markdown 桌面编辑器</strong></p>
  <p>默认所见即所得，需要时一键切换源码；没有左右分栏，也不需要账号。</p>
  <p>
    <a href="https://github.com/ZHUI33/OpenMD/releases/latest"><strong>下载安装</strong></a>
    · <a href="docs/USER_GUIDE.md">使用手册</a>
    · <a href="CONTRIBUTING.md">参与贡献</a>
    · <a href="https://github.com/ZHUI33/OpenMD/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/github/actions/workflow/status/ZHUI33/OpenMD/ci.yml?branch=main&label=CI" alt="CI 状态">
    <img src="https://img.shields.io/github/v/release/ZHUI33/OpenMD?display_name=tag&include_prereleases" alt="最新版本">
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-2563eb" alt="支持 Windows 和 macOS">
    <img src="https://img.shields.io/github/license/ZHUI33/OpenMD" alt="MIT 许可证">
  </p>
</div>

![OpenMD 所见即所得编辑器、工作区、表格和公式](docs/images/openmd-editor.png)

## 下载与安装

打开 [GitHub Releases](https://github.com/ZHUI33/OpenMD/releases/latest)，按电脑类型下载：

| 系统                | 下载文件                      | 适用设备              |
| ------------------- | ----------------------------- | --------------------- |
| Windows             | `OpenMD-<版本>-x64-setup.exe` | 64 位 Windows 10/11   |
| macOS Apple Silicon | `OpenMD-<版本>-arm64.dmg`     | M1、M2、M3、M4 等 Mac |
| macOS Intel         | `OpenMD-<版本>-x64.dmg`       | Intel 处理器 Mac      |

### Windows

1. 双击下载的 `setup.exe`。
2. 选择安装位置并完成安装。
3. 从桌面或开始菜单打开 OpenMD。
4. 安装后可以直接双击 `.md`、`.markdown` 文件。

### macOS

1. 打开与处理器对应的 DMG。
2. 把 OpenMD 拖入 `Applications`（应用程序）。
3. 从应用程序目录打开 OpenMD。

> 当前测试包可能尚未完成商业代码签名。请只从本仓库 Releases 下载，并核对 Release 中提供的校验值。正式发布前的签名状态会在每个 Release 中明确标注。

## 3 分钟上手

1. 按 `Ctrl/Cmd + N` 新建文档，直接像普通文字编辑器一样输入内容。
2. 按 `Ctrl/Cmd + S` 第一次保存；选择文件名和位置。
3. 点击右上角“设置”开启自动保存，默认在停止输入 1.5 秒后保存。
4. 按 `Ctrl/Cmd + /` 在所见即所得与 Markdown 源码之间切换。
5. 点击“打开文件夹”，用左侧文件树管理一组笔记或项目文档。
6. 点击“导出 HTML”或“导出 PDF”，生成可以分享的成品文档。

最常用快捷键：

| 操作         | Windows            | macOS             |
| ------------ | ------------------ | ----------------- |
| 新建         | `Ctrl + N`         | `Cmd + N`         |
| 打开文件     | `Ctrl + O`         | `Cmd + O`         |
| 打开文件夹   | `Ctrl + Shift + O` | `Cmd + Shift + O` |
| 保存         | `Ctrl + S`         | `Cmd + S`         |
| 切换编辑模式 | `Ctrl + /`         | `Cmd + /`         |
| 工作区搜索   | `Ctrl + Shift + F` | `Cmd + Shift + F` |
| 导出 HTML    | `Ctrl + Alt + H`   | `Cmd + Alt + H`   |
| 导出 PDF     | `Ctrl + Alt + P`   | `Cmd + Alt + P`   |

需要图片、公式、Mermaid、自动保存或导出方面的操作说明？请查看 [完整用户手册](docs/USER_GUIDE.md)。

## 为什么选择 OpenMD

| 特点           | 你得到什么                                               |
| -------------- | -------------------------------------------------------- |
| 所见即所得优先 | 不必盯着 Markdown 标记写作，界面也不是左右分栏           |
| 本地优先       | 文档就是磁盘上的普通 Markdown 文件，无账号、无云端依赖   |
| 随时查看源码   | 一键进入 CodeMirror 源码模式，不锁定文件格式             |
| 项目级写作     | 多标签页、文件夹工作区、目录大纲和全文搜索               |
| 完整内容能力   | 表格、任务列表、代码高亮、图片、KaTeX 和 Mermaid         |
| 可交付导出     | 独立 HTML 与只包含正文的 A4/Letter PDF                   |
| 开源跨平台     | MIT 许可，支持 Windows x64、macOS Intel 与 Apple Silicon |

OpenMD 专注于本地 Markdown 写作。第一版不包含账号、云同步、在线协作或 AI 功能。

## 功能一览

- 默认所见即所得，也可以把源码模式设为默认。
- 标题、强调、列表、任务列表、引用、链接、GFM 表格和目录。
- CodeMirror 代码块、语法高亮、行号、自动换行和搜索。
- 本地或远程图片，支持图片资源目录规则。
- KaTeX 行内/块级公式与安全的 Mermaid 图表预览。
- 多标签页、最近文件、文件夹工作区、文档大纲和全文搜索。
- 可配置自动保存；未命名文档不会被静默写入未知位置。
- 独立 HTML 导出，可引用相对图片或嵌入本地图片 Base64。
- A4/Letter PDF 导出，支持页边距和打印背景。
- 浅色、深色、跟随系统与用户主题。
- `.md`、`.markdown` 文件关联和可关闭的更新检查。

## 项目介绍

OpenMD 是 Electron + React + TypeScript 桌面应用。Renderer 不直接访问 Node.js 或 Electron；所有文件、工作区、导出和设置操作都经过受限的 Preload API 与经过校验的 IPC。

```mermaid
flowchart LR
  UI[React / Milkdown / CodeMirror] --> API[contextBridge 白名单 API]
  API --> IPC[经过校验的 IPC]
  IPC --> MAIN[Electron Main]
  MAIN --> FILES[本地文件与导出]
```

核心技术：

- Electron 43、React 19、TypeScript 5.8、Vite 7、electron-vite 4
- Milkdown/Crepe 7、CodeMirror 6、Zustand 5
- Markdown-it、Highlight.js、KaTeX、Mermaid、DOMPurify
- electron-builder、electron-updater
- Vitest、React Testing Library、Playwright Electron

## 本地开发

需要 Node.js 22.12+ 与 pnpm 10+：

```bash
git clone https://github.com/ZHUI33/OpenMD.git
cd OpenMD
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

常用质量检查：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm build
```

E2E 测试使用独立系统临时目录，不会读写用户真实文档。

## 构建安装包

```bash
# Windows x64 NSIS，必须在 Windows 上执行
pnpm dist:win

# macOS x64 + arm64 DMG，必须在 macOS 上执行
pnpm dist:mac
```

产物写入 `dist/`。平台签名、公证、GitHub Secrets 和正式发布流程见 [发布指南](docs/RELEASING.md)。

## 参与项目

欢迎以下类型的贡献：

- 复现清晰的 bug 报告和小范围修复。
- Windows/macOS 安装与兼容性反馈。
- 编辑体验、可访问性和大文档性能改进。
- 文档、截图、翻译与主题。

提交代码前请阅读 [贡献指南](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md) 与 [安全策略](SECURITY.md)。如果 OpenMD 对你有帮助，欢迎点一个 Star；它会让更多需要本地 Markdown 编辑器的人看到项目。

## 路线图

- `0.1.x`：MVP 回归修复、安装体验、可访问性与大文档性能。
- 发布准备：Windows/macOS 真实签名、公证及安装矩阵验收。
- 后续版本：导出模板、打印页眉页脚、更多主题和国际化。

账号、云同步、在线协作和 AI 不在当前路线图范围内。

## 已知限制

- 测试构建默认未签名，正式发布需要平台证书和 Apple 公证。
- Base64 HTML 导出只嵌入已授权的本地图片；不会主动下载远程图片。
- PDF 中的远程图片依赖导出时的网络状态。
- 自动更新只在发布版启动时检查，暂时没有增量下载进度界面。
- 安装器、SmartScreen 与 Gatekeeper 仍需要每个版本人工验收。

## 许可证

[MIT](LICENSE) © OpenMD contributors.
