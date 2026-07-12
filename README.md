# OpenMD

OpenMD 是一个开源、跨平台的 Markdown 桌面编辑器。项目目标是提供类似 Typora
的沉浸式正文编辑体验：Markdown 在正文中直接编辑并实时呈现，不采用源码与预览左右分栏。

当前仓库已完成阶段 4：除本地 Markdown 文档的新建、打开、保存、未保存修改确认和最近
文件外，正文编辑器现已支持 GFM 表格、CodeMirror 6 围栏代码块、行内代码、常用列表
行为、任务复选框和轻量插入菜单。当前仍保持单文档模式，不包含多标签页或文件夹工作区。

## 当前技术栈

- Electron 43
- React 19
- TypeScript 5.8
- Vite 7 与 electron-vite 4
- Zustand 5
- Milkdown/Crepe 7 与 CodeMirror 6
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

Preload 只公开 `window.openmd` 中声明的强类型白名单能力，不公开 `ipcRenderer` 本身。

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

## 人工验收

### 1. 安装与自动检查

在项目根目录依次执行：

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

预期所有命令以退出码 0 结束。
构建后应存在 out/main/index.js、out/preload/index.js 和 out/renderer/index.html。

### 2. 新建、打开与保存

执行：

    pnpm dev

在打开的桌面窗口中依次确认：

- 按 Ctrl/Cmd+N 后正文为空，标题为“未命名 - OpenMD”。
- 输入内容后标题前出现 `●`。
- 按 Ctrl/Cmd+S，未命名文档会打开保存对话框；不填写扩展名时自动使用 `.md`。
- 再次编辑后按 Ctrl/Cmd+S 会直接写回当前文件，保存成功后 `●` 消失。
- 按 Ctrl/Cmd+Shift+S 可以另存为并更新标题中的文件名。
- 按 Ctrl/Cmd+O 只能选择 `.md`、`.markdown` 或 `.txt`，打开后内容与 UTF-8 原文件一致。

### 3. 未保存确认

- 修改正文后执行新建、打开、重新加载、关闭窗口或退出应用。
- 确认对话框包含“保存”“不保存”“取消”。
- “保存”仅在写入成功后继续原操作；“不保存”直接继续；“取消”保留当前文档。
- 将目标目录改为不可写后重试保存，确认出现可理解的错误且文档仍显示为已修改。

### 4. 最近文件与菜单

- 成功打开或保存多个文件后，检查“文件 → 最近打开”，最近使用的文件应位于最前。
- 同一文件不会重复，列表最多 10 条；删除磁盘上的文件后，重新启动、执行其他文件操作或点击该项会自动清理。
- 检查“编辑”和“视图”菜单中的撤销、重做、剪贴板、缩放、重新加载和开发者工具命令。
- macOS 上退出命令位于标准应用菜单中。

### 5. DevTools 与渲染进程隔离

在 Windows/Linux 按 Ctrl+Shift+I，在 macOS 按 Command+Option+I 打开 DevTools。
确认 Console 没有红色运行时错误，然后依次执行：

    typeof process
    typeof require
    typeof Buffer
    typeof ipcRenderer
    typeof electron
    Object.keys(window.openmd)
    Object.keys(window.openmd.documents)
    await window.openmd.getAppInfo()

前五项都应返回 "undefined"。`window.openmd` 只应包含应用信息与受限文档 API，最后一项应返回
应用名称、版本和当前平台。再检查 src/main/window.ts 中的 BrowserWindow 配置：

    nodeIntegration: false
    contextIsolation: true
    sandbox: true

### 6. 阶段 4 正文编辑

- 使用浮动 `+` 按钮或在空段落输入 `/`，确认可插入标题、引用、三类列表、表格、代码块
  和分割线，菜单中没有图片或数学公式。
- 插入表格并直接编辑单元格；用 Tab/Shift+Tab 前后移动，确认最后一格 Tab 会新增一行。
- 通过表格悬浮按钮或右键菜单增删行列、设置列对齐，并删除整张表；保存后检查磁盘内容仍是
  `| ... |` 形式的 GFM Markdown。
- 插入代码块，依次选择 JavaScript、TypeScript、Java、Python 等语言，确认高亮、复制、
  Tab 缩进、多行选择、撤销/重做正常；保存后确认围栏语言仍为小写标准标识。
- 检查有序、无序和任务列表的 Enter、空项退出、Tab/Shift+Tab 层级调整；点击任务复选框
  后保存，确认磁盘内容在 `[ ]` 与 `[x]` 之间同步。
- 在正文、表格单元格和代码块中分别使用中文输入法连续输入，确认候选上屏期间没有重复字符、
  意外提交或光标跳动。
- 打开包含标题、链接、嵌套列表、任务项、表格、行内代码和围栏代码的外部 `.md` 文件，
  编辑后保存并重新打开，确认正文语义完整且未出现 HTML 表格或 OpenMD 私有标记。

### 7. 阶段边界

确认应用仍是单文档所见即所得编辑器，没有多标签页、文件夹工作区、自动保存、导出或同步入口。
完成检查后，在运行 pnpm dev 的终端按 Ctrl+C 结束开发进程。

### 8. 平台打包

在 Windows 上执行：

    pnpm dist:win

预期生成 dist/OpenMD-0.1.0-x64-setup.exe。在 macOS 上执行：

    pnpm dist:mac

预期生成未签名的 DMG；阶段 1 不要求配置 Apple 签名或公证。

## 当前阶段边界

阶段 4 仍只实现单文档 Markdown 编辑。本阶段不包含图片、数学公式、Mermaid、多标签页、
文件夹工作区、自动保存、导出、同步或云端能力。
