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

## 当前阶段边界

阶段 1 不包含 Markdown 解析或编辑器、文件打开、文件保存、最近文件、自动保存、
侧边栏界面、导出和同步等功能。这些能力将在后续阶段按需设计与实现。
