# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.0] - 2026-07-27

### Added

- 当前文档查找/替换，支持大小写、全词、正则、上下项以及单项/全部替换。
- `Ctrl/Cmd + P` 快速打开、关闭/恢复标签、前后切换标签，并为每个标签保留编辑模式、光标和滚动位置。
- 专注模式、打字机模式、可调整且可持久化的文件/搜索/大纲侧栏。
- 选区格式工具条、安全的链接编辑/外部打开，以及文件树右键、新建和重命名对话框。
- YAML Front Matter、脚注、GFM Alerts、引用式链接、自动链接、原始 HTML 和未知扩展块的可视化保真编辑。
- 表格对齐、行列增删、Tab 导航以及与表格软件互通的 TSV 矩形复制粘贴。
- 原子草稿备份、异常退出恢复入口，以及工作区、打开标签和活动标签恢复。
- 无样式 HTML、长图 PNG、PDF 页眉/页脚/页码/主题/标题分页。
- 每文档最近成功导出配置与“使用上次配置再次导出”。
- 1 MB、5 MB、长列表、大表格、代码块和 Mermaid 可复现性能基准。
- 浅色/深色 125%/150% 缩放、高对比度视觉回归覆盖。

### Changed

- 文件、搜索和大纲合并为单一导航侧栏；标签栏、标题栏、状态栏和文件树统一图标与键盘交互。
- 工作区删除改为移入系统回收站；失败时保留原文件，不再回退到永久删除。
- Mermaid、图片和复杂块在接近视口时才进行昂贵渲染。
- 工作区搜索可主动取消；字数统计移到 Worker 并合并连续更新。
- 补齐菜单键盘导航、模态焦点陷阱/恢复、减弱动画和平台样式适配。

### Fixed

- 修复在所见即所得与源码模式之间切换时，未编辑的 YAML、HTML、代码围栏、引用定义、换行和同义 Markdown 标记可能被改写或丢失的问题。
- 修复复杂 Markdown 局部编辑可能影响相邻节点、跨节点选择或撤销/重做的问题。
- 修复相同路径可能出现重复标签，以及切换标签后光标、滚动位置或编辑模式丢失的问题。
- 修复导出取消或失败时仍记录配置，以及超长 PNG 可能被系统截断而未明确报错的问题。

### Security

- 恢复记录仅写入 Electron `userData/recovery`，不覆盖原文件、不上传。
- HTML/PDF/PNG 继续执行 CSP、HTML/SVG 清洗和本地图片授权校验。
- 原始 HTML 只作为源码显示；危险链接协议不会导航，Markdown 和 YAML 不会触发任意命令执行。

## [0.1.0] - 2026-07-18

### Added

- 所见即所得和源码编辑、多标签页、文件夹工作区、搜索与最近文件。
- 表格、代码高亮、图片、KaTeX、Mermaid、目录和主题设置。
- 防抖自动保存及按文档串行写入。
- 安全独立 HTML 与正文 PDF 导出。
- Windows x64 NSIS、macOS x64/arm64 DMG 和 Markdown 文件关联。
- 可确认的 GitHub Releases 更新检查。
- Vitest、React Testing Library、Playwright Electron 和 GitHub Actions。

### Security

- Renderer 沙箱、Context Isolation、IPC 请求校验、HTML/SVG 清洗和导出 CSP。

[Unreleased]: https://github.com/ZHUI33/OpenMD/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ZHUI33/OpenMD/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ZHUI33/OpenMD/releases/tag/v0.1.0
