# OpenMD

OpenMD 是一个开源、跨平台的 Markdown 桌面编辑器。项目目标是提供类似 Typora
的沉浸式正文编辑体验：Markdown 在正文中直接编辑并实时呈现，不采用源码与预览左右分栏。

当前仓库处于阶段 1，仅包含安全的 Electron 桌面骨架、统一的 React 页面、基础主题和状态管理。
Markdown 编辑、文件打开与保存等产品能力尚未实现。

## 当前技术栈

- Electron 43
- React 19
- TypeScript 5.8
- Vite 7 与 electron-vite 4
- Zustand 5
- pnpm 10
- electron-builder 26
- Vitest 3
- ESLint 9
- Prettier 3

所有依赖都使用精确版本，并由 pnpm-lock.yaml 锁定。

## 开发环境要求

- Node.js 22.12 或更高版本（推荐使用 Node.js 24 LTS）
- pnpm 10 或更高版本
- Windows 10/11 或受支持的 macOS 版本

建议通过 Corepack 启用项目声明的 pnpm 版本：

    corepack enable
    corepack install

## 安装与启动

安装依赖：

    pnpm install

启动 Vite 开发服务和 Electron 桌面窗口：

    pnpm dev

## 检查与构建

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

构建 Windows 安装包：

    pnpm dist:win

在 macOS 上构建未签名的 DMG：

    pnpm dist:mac

## 安全架构

渲染进程不启用 Node.js 集成，也不能直接使用 fs、path 或 Electron 主进程 API。
BrowserWindow 启用了 contextIsolation 与 sandbox。需要桌面能力时，调用链固定为：

    Renderer → Preload 白名单 API → IPC → Main Process

Preload 只公开 DesktopApi 中声明的能力，不公开 ipcRenderer 本身。

## 项目目录

    OpenMD/
    ├─ src/
    │  ├─ main/             Electron 主进程、窗口与 IPC 注册
    │  ├─ preload/          受限的桌面 API 桥接层
    │  ├─ renderer/         React 页面、组件、状态与样式
    │  └─ shared/           IPC 通道名与跨进程类型
    ├─ resources/           electron-builder 构建资源
    ├─ tests/               Vitest 测试
    ├─ electron-builder.yml
    ├─ electron.vite.config.ts
    ├─ package.json
    ├─ tsconfig.json
    └─ README.md

## 阶段 1 人工验收

### 1. 安装与自动检查

在项目根目录依次执行：

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

预期所有命令以退出码 0 结束；测试结果应为 1 个测试文件、3 个测试全部通过。
构建后应存在 out/main/index.js、out/preload/index.js 和 out/renderer/index.html。

### 2. 窗口与页面

执行：

    pnpm dev

在打开的桌面窗口中确认：

- 窗口标题为 OpenMD，初始尺寸约 1200×800。
- 窗口不能缩小到 800×600 以下。
- 页面从上到下只有标题栏、中央编辑区占位组件和状态栏。
- 页面没有 Markdown 源码与预览的左右分栏。
- 主题选择器可以切换浅色、深色和跟随系统。

### 3. DevTools 与渲染进程隔离

在 Windows/Linux 按 Ctrl+Shift+I，在 macOS 按 Command+Option+I 打开 DevTools。
确认 Console 没有红色运行时错误，然后依次执行：

    typeof process
    typeof require
    typeof Buffer
    typeof ipcRenderer
    typeof electron
    Object.keys(window.desktop)
    await window.desktop.getAppInfo()

前五项都应返回 "undefined"。window.desktop 应只包含 getAppInfo，最后一项应返回
应用名称、版本和当前平台。再检查 src/main/window.ts 中的 BrowserWindow 配置：

    nodeIntegration: false
    contextIsolation: true
    sandbox: true

### 4. 阶段边界

确认页面仍是占位界面，不能编辑 Markdown，也没有打开、保存、自动保存、导出或同步入口。
完成检查后，在运行 pnpm dev 的终端按 Ctrl+C 结束开发进程。

### 5. 平台打包

在 Windows 上执行：

    pnpm dist:win

预期生成 dist/OpenMD-0.1.0-x64-setup.exe。在 macOS 上执行：

    pnpm dist:mac

预期生成未签名的 DMG；阶段 1 不要求配置 Apple 签名或公证。

## 当前阶段边界

阶段 1 不包含 Markdown 解析或编辑器、文件打开、文件保存、最近文件、自动保存、
侧边栏界面、导出和同步等功能。这些能力将在后续阶段按需设计与实现。
