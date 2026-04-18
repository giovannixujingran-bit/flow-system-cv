# Flow System MVP

> 本地网络任务协作平台：中心化派发 + 分布式 Agent + OpenClaw 集成。
> TypeScript monorepo · Next.js + Fastify + Drizzle · SQLite / PostgreSQL 双存储。

---

## 🖼️ 界面预览

<!-- 下列截图待补充，路径已预留 -->

![Platform Web 仪表盘](./docs/screenshots/01-platform-web-dashboard.png)

![本地 Agent 管理界面](./docs/screenshots/02-local-agent-ui.png)

![任务派发与状态追踪](./docs/screenshots/03-task-dispatch.png)

---

## 这是什么

Flow System 是一个面向 [OpenClaw](https://github.com/openclaw/openclaw) 的**团队协作层**。

解决的问题：当整个团队都在用 OpenClaw 时，怎么把"谁要做什么、做到哪一步、产出在哪里"统一管理起来？而不是每个成员各自对着自己的 OpenClaw 敲命令。

整体分三层：

- **中心平台（Platform Web + API）**：统一的项目、任务、用户、事件视图，跑在一台机器上（单机或局域网共享主机）
- **本地 Agent（每台机器一个）**：自带 SQLite 和本地 Web UI，接收平台派发的任务、调本机 OpenClaw 执行、把结果回传
- **OpenClaw 对接层**：通过 OpenClaw CLI（`openclaw gateway` / `openclaw agent`）和状态文件与本机 OpenClaw 通信，不侵入其内部

典型场景：一个内部团队需要把"用 AI 编排处理的任务"标准化为统一流水线 —— 创建任务、分配给合适的成员、追踪执行状态、收集产出物、管理访问权限。

---

## 架构

```mermaid
flowchart TB
    subgraph Browser["用户浏览器"]
        B[Next.js 页面]
    end

    subgraph Central["中心平台（单机或局域网共享）"]
        Web["Platform Web<br/>Next.js · :3000"]
        API["Platform API<br/>Fastify · :4010"]
        Store{{"存储层<br/>memory / PostgreSQL"}}
        Web -->|HTTP| API
        API <--> Store
    end

    subgraph Machine1["团队成员机器 A"]
        A1["Local Agent<br/>SQLite + 本地 UI :38500"]
        OC1["OpenClaw CLI"]
        A1 -->|子进程| OC1
    end

    subgraph Machine2["团队成员机器 B"]
        A2["Local Agent<br/>SQLite + 本地 UI :38501"]
        OC2["OpenClaw CLI"]
        A2 -->|子进程| OC2
    end

    subgraph Overlay["桌面层（可选）"]
        DO["Desktop Overlay"]
    end

    B --> Web
    API <-->|注册 / 心跳 / 任务派发| A1
    API <-->|注册 / 心跳 / 任务派发| A2
    A1 -.->|状态上报| DO

    classDef platform fill:#e3f2fd,stroke:#1976d2
    classDef agent fill:#fff3e0,stroke:#f57c00
    classDef cli fill:#f3e5f5,stroke:#7b1fa2
    class Web,API,Store platform
    class A1,A2 agent
    class OC1,OC2 cli

    style Browser fill:transparent,stroke:#888,stroke-dasharray:4 3
    style Central fill:transparent,stroke:#888,stroke-dasharray:4 3
    style Machine1 fill:transparent,stroke:#888,stroke-dasharray:4 3
    style Machine2 fill:transparent,stroke:#888,stroke-dasharray:4 3
    style Overlay fill:transparent,stroke:#888,stroke-dasharray:4 3
```

### 代码结构

```text
apps/
  platform-web/            # Next.js 仪表盘，项目/任务/用户/会话管理 UI
  platform-api/            # Fastify API，认证/文件/任务/agent/事件/风险
  local-agent/             # 本机常驻进程，自带 HTTP 服务和本地 UI
  desktop-overlay/         # 桌面叠加层（进度/通知）
  desktop-overlay-native/  # 原生 Windows 实现

packages/
  flow-protocol/           # 共享 schema、enum、ID 生成、状态机
  local-openclaw-contracts/# Local Agent ↔ OpenClaw 的跨进程契约
  local-overlay-contracts/ # Local Agent ↔ Desktop Overlay 的契约

scripts/                   # 19 个 PowerShell/Node 脚本：install / update / package / publish
account-management/        # managed 模式下的账号清单
tests/                     # 11 个 Vitest spec（~160KB，含 platform-api 和 local-agent 集成测试）
```

### 关键设计点

- **契约分层**：`flow-protocol` 包集中管理跨进程的枚举、schema、状态机，避免 3 个 TypeScript app 各自维护一套类型
- **三种 seed 模式**：`managed`（发行分发）/ `empty`（自助初始化）/ `demo`（本地演示）—— 对应不同的部署形态
- **两种存储**：`memory` 走单文件快照（快速启动），`postgres` 走 Drizzle + 迁移工具链（生产可用）
- **局域网部署**：支持一台机器做 shared host，其他机器的 Local Agent 连上来，同时浏览器仍通过 `127.0.0.1:<local_port>` 和本机 Agent 直接通信（跨机权限边界清晰）
- **安装分发做到极致**：不会命令行的用户双击 `install-flow-system-from-github.cmd` 即可自动下载便携 Node + MinGit + npm ci，对外发布准备好了

---

## Quick links

- 分发与发行说明：[FLOW-SYSTEM-DISTRIBUTION.md](./FLOW-SYSTEM-DISTRIBUTION.md)
- 中文安装向导：[INSTALL-CN.md](./INSTALL-CN.md)
- 桌面层设计：[docs/desktop-overlay-mvp.md](./docs/desktop-overlay-mvp.md)
- PostgreSQL 迁移方案：[docs/platform-api-postgres-cutover.md](./docs/platform-api-postgres-cutover.md)

---

## Windows native startup

Windows is now the default runtime mode. On first launch the project will automatically:

- download a portable Node.js runtime into `runtime/windows-tools/`
- install workspace dependencies with `npm ci`
- download a portable MinGit runtime if the machine does not already have `git.exe`

OpenClaw itself is no longer auto-installed by Flow System. The startup scripts now:

- do not auto-install OpenClaw
- do not guess Windows or WSL OpenClaw paths during startup
- start the platform and local agent even when OpenClaw is not connected
- print the last persisted OpenClaw connection status for the current agent

OpenClaw connection is now managed by the local agent itself. Use the `代理` page to:

- choose `openclaw.cmd` directly
- choose an OpenClaw root directory
- revalidate the current selection
- clear and reselect the connection

The selected connection is persisted per agent in:

- `runtime/agents/<agent-key>/agent-data/openclaw-connection.json`

On first connection the local agent validates:

- executable existence
- state directory existence
- config file existence
- auth file existence
- `openclaw --version`
- `openclaw gateway status`
- a minimal `openclaw agent` probe

If you need an explicit override for local development or CI, set `FLOW_OPENCLAW_BIN`.

For most users, this is the only command they need:

```powershell
.\start-flow-system.cmd
```

By default the platform now starts in managed-account mode. Receivers do not create the first admin account themselves. Instead, the platform reads credentials from:

- `account-management/managed-users.json`
- `account-management/accounts-summary.txt`

Use the distributed credentials to log in directly. If you need a blank self-initialized workspace for local development, start it with:

```powershell
.\start-flow-system.cmd -AllowSelfSetup
```

By default this starts a single local agent for `admin` on `http://127.0.0.1:38500`. If you need the old three-account demo mode on one machine, start it with:

```powershell
.\start-flow-system.cmd -EnableDemoAgents
```

If you also want the old seeded demo accounts, projects, and tasks for local demos, enable them explicitly:

```powershell
.\start-flow-system.cmd -EnableDemoData -EnableDemoAgents
```

Useful options:

```powershell
.\start-flow-system.cmd -NoOpen
.\start-flow-system.cmd -Restart
.\stop-flow-system.cmd
```

Start a single local agent only:

```powershell
.\start-flow-agent.cmd -OwnerUserId user_admin -AgentName ADMIN-PC -UiPort 38500
.\stop-flow-agent.cmd -OwnerUserId user_admin -UiPort 38500
```

## WSL fallback

If you still need the old WSL startup mode on a development machine, force it explicitly:

```powershell
.\start-flow-system.cmd -RuntimeMode Wsl
.\start-flow-agent.cmd -RuntimeMode Wsl -OwnerUserId user_admin -UiPort 38500
```

Or run the workspace manually inside WSL with the OpenClaw bundled Node runtime:

```bash
export PATH="$HOME/.openclaw/tools/node-v22.22.0/bin:$PATH"
cd /mnt/d/openclaw/workspace/flow-system
npm install
npm run check
npm run dev:api
npm run dev:web
npm run dev:agent
```

LAN deployment for a shared platform host:

```powershell
.\start-flow-system.cmd -BindHost 0.0.0.0 -EnableLanProxy -PlatformWebOrigin http://192.168.1.50:3000 -PlatformApiBaseUrl http://192.168.1.50:4010
.\disable-flow-system-lan.cmd
```

Start a single local agent on another Windows machine and connect it back to the shared platform:

```powershell
.\start-flow-agent.cmd -OwnerUserId user_admin -AgentName ADMIN-PC -UiPort 38500 -PlatformApiBaseUrl http://192.168.1.50:4010 -PlatformWebOrigin http://192.168.1.50:3000
.\stop-flow-agent.cmd -OwnerUserId user_admin -UiPort 38500
```

PostgreSQL cutover tooling is now available:

```bash
npm run db:generate
npm run db:migrate
npm run db:preflight
npm run db:import-current-state
npm run db:verify-import
npm run db:seed
```

## Runtime defaults

- Platform API: `http://127.0.0.1:4010`
- Platform Web: `http://127.0.0.1:3000`
- Local Agent UI (admin): `http://127.0.0.1:38500`
- OpenClaw connection: managed from the `代理` page and stored per agent in `agent-data/openclaw-connection.json`

When the platform is exposed on a LAN IP, the browser still talks to each machine's own local agent through `127.0.0.1:<local_ui_port>`. The agent now stores its own `local_ui_port` on registration and only allows update-panel requests from the configured platform web origin.

The API now supports both the legacy single-file memory snapshot mode and PostgreSQL-backed persistence for a shared platform host.

## Storage modes

- `STORAGE_MODE=memory`: current default; fastest way to run the MVP locally
- `STORAGE_MODE=postgres`: PostgreSQL-backed persistence with explicit migration/import flow
- `FLOW_SEED_MODE=managed`: default; starts with managed accounts from `account-management/`
- `FLOW_SEED_MODE=empty`: optional self-setup mode; first launch can create the first admin
- `FLOW_SEED_MODE=demo`: opt-in local demo mode with seeded users/projects/tasks

Shared-host PostgreSQL startup example:

```powershell
.\start-flow-system.cmd -StorageMode postgres -DatabaseUrl "postgres://postgres:postgres@127.0.0.1:5432/flow_system" -RunMigrations:$true -ImportCurrentState:$true
```

---

## License

MIT — see [LICENSE](./LICENSE).
