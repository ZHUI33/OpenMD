# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- 原子草稿备份、异常退出恢复入口，以及工作区、打开标签和活动标签恢复。
- 无样式 HTML、长图 PNG、PDF 页眉/页脚/页码/主题/标题分页。
- 每文档最近成功导出配置与“使用上次配置再次导出”。
- 1 MB、5 MB、长列表、大表格、代码块和 Mermaid 可复现性能基准。
- 浅色/深色 125%/150% 缩放、高对比度视觉回归覆盖。

### Changed

- Mermaid、图片和复杂块在接近视口时才进行昂贵渲染。
- 工作区搜索可主动取消；字数统计移到 Worker 并合并连续更新。
- 补齐菜单键盘导航、模态焦点陷阱/恢复、减弱动画和平台样式适配。

### Security

- 恢复记录仅写入 Electron `userData/recovery`，不覆盖原文件、不上传。
- HTML/PDF/PNG 继续执行 CSP、HTML/SVG 清洗和本地图片授权校验。
- Markdown 和 YAML 不会触发任意命令执行。

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
