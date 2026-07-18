# OpenMD 发布指南

## 发布前检查

1. 更新版本、`CHANGELOG.md` 和发布说明。
2. 在 Windows 与 macOS 分别完成人工安装、启动、保存、文件关联、HTML/PDF 导出和卸载检查。
3. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm build`、`pnpm test:e2e`。
4. 确认仓库、Actions 日志和产物不包含证书、密码、Token 或本机路径。
5. 推送形如 `v0.1.0` 的标签；Release workflow 会生成平台产物并创建/更新草稿 Release。

## 未签名测试包

没有签名 Secrets 时，GitHub Actions 仍会构建未签名测试包。这些包只用于验证，可能触发 Windows
SmartScreen 或 macOS Gatekeeper，不应直接标记为稳定正式发布。

## Windows 签名 Secrets

- `WINDOWS_CSC_LINK`：PFX 的安全 URL 或 Base64 内容。
- `WINDOWS_CSC_KEY_PASSWORD`：PFX 密码。

Workflow 只在运行时把它们映射给 electron-builder 的 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。

## macOS 签名和公证 Secrets

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

证书必须是有效的 Developer ID Application 证书。Apple 凭据只保存为 GitHub Actions Secrets，绝不写入
仓库。配置后先在受保护分支或受控标签上验证签名与公证结果，再公开 Release。

## GitHub Releases 与自动更新

`electron-builder.yml` 指向 `ZHUI33/OpenMD` 的 GitHub provider。应用只在打包版、用户启用自动检查且
存在有效发布元数据时检查；异常不会阻止启动。发现版本后先询问是否下载，下载完成后再询问是否重启安装。

Release workflow 使用 GitHub 自动提供的 `github.token` 上传产物，不需要把个人 Token 写入仓库。发布前
检查草稿 Release 中同时存在安装包、DMG、更新 YAML 和 blockmap，再手动发布草稿。

## 仍需人工完成

- 购买/配置 Windows 代码签名证书。
- 配置 Apple Developer 证书、公证凭据并验证两种架构。
- 在真实 Windows 10/11、Intel Mac 和 Apple Silicon Mac 上验收。
- 补充 README 功能截图、发布说明和校验和。
- 将草稿 GitHub Release 手动切换为公开发布。
