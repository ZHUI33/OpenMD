# Security Policy

## Supported versions

在 1.0 前，仅最新发布版本和主分支接受安全修复。

## Reporting a vulnerability

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告入口。不要创建公开 Issue，也不要附加
真实用户文档、Token、证书或其他秘密。

报告请包含受影响版本、平台、复现步骤、影响范围和可行的缓解方式。维护者会尽快确认收到报告，在确认
修复和发布窗口前请避免公开细节。

## Security boundaries

OpenMD 的 Renderer 在 `sandbox` 与 `contextIsolation` 下运行，禁用 Node.js 集成。文件、图片、导出和设置
访问都必须经过校验后的 IPC。安全修复不得通过放宽这些边界来绕过问题。
