# Contributing to OpenMD

感谢参与 OpenMD。请把改动保持在本地、离线优先的 Markdown 编辑器范围内；MVP 不接受账号、云同步、
在线协作或 AI 功能。

## 开始开发

1. 安装 Node.js 22.12+ 和 pnpm 10+。
2. 运行 `pnpm install --frozen-lockfile` 和 `pnpm dev`。
3. 从最新主分支创建短生命周期分支。
4. 保持 Renderer 无 Node.js/Electron 直接访问，新增桌面能力必须使用强类型 Preload/IPC 白名单。
5. 为行为变更新增 Vitest、React Testing Library 或 Playwright 回归测试。

提交前运行：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

影响关键用户流程时再运行 `pnpm test:e2e`。E2E 数据必须继续使用临时目录。

## Pull Request

- 说明用户可见变化、安全边界和验证结果。
- 不提交 `dist/`、`out/`、测试临时目录、证书、Token、密码或本机绝对路径。
- 保持所见即所得为默认模式，不引入左右分栏预览。
- 更新 README、CHANGELOG 或发布文档中受影响的部分。
- 一个 PR 聚焦一个问题；避免夹带无关格式化。

提交贡献即表示你同意按仓库的 MIT 许可证授权该贡献。
