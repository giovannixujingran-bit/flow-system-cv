# Flow System MVP

Quick links:

- English distribution notes: [FLOW-SYSTEM-DISTRIBUTION.md](./FLOW-SYSTEM-DISTRIBUTION.md)
- Chinese install guide: [INSTALL-CN.md](./INSTALL-CN.md)

Flow System is a local-network task handoff platform composed of:

- `platform-web`: Next.js project dashboard and task management UI
- `platform-api`: Fastify API for auth, files, tasks, agents, events, and risks
- `local-agent`: Windows-first local agent with SQLite state and a local web UI
- `flow-protocol`: shared schemas, enums, IDs, and state-machine rules

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
