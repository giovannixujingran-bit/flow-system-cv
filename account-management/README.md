# 账号管理目录

- `managed-users.json`：账号源文件，平台在 `FLOW_SEED_MODE=managed` 时从这里加载账号。
- `accounts-summary.txt`：给分发和人工查看用的账号汇总。

默认模式下：

- 收件人不允许自助创建首个管理员。
- 平台启动后直接使用这里的账号登录。
- 管理员在网页里新增或修改账号时，会同步写回这两个文件。

如果你手动修改了 `managed-users.json`，下次重启平台时会自动生效。
