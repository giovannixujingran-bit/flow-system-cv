# Flow System GitHub Distribution

This repo now includes a beginner-friendly install/update flow for the whole Flow System project.

For a Chinese user-facing guide, see:

- `INSTALL-CN.md`

## What the buttons do

- `install-flow-system-from-github.cmd`
  - Downloads the repo from GitHub
  - Installs it to `%USERPROFILE%\OpenClawProjects\flow-system`
  - Installs repo-local skills from `skills/*` into `~/.codex/skills`
- `start-installed-flow-system.cmd`
  - Starts the installed Flow System from the configured install path
  - If no managed account file is present, it automatically falls back to `-AllowSelfSetup`
- `update-flow-system-from-github.cmd`
  - Downloads the latest repo version and overlays it onto the installed copy
  - Preserves local runtime/state folders and selected local config files
- `package-flow-bootstrap.cmd`
  - Creates a small bootstrap zip that can be shared with other users

## Default install target

The installed project goes to:

- `%USERPROFILE%\OpenClawProjects\flow-system`

You can change that in `flow-system-distribution.config.json`.

## What is preserved on update

The update flow keeps local state by default:

- `runtime/`
- `storage/`
- `node_modules/`
- `apps/platform-web/.next/`
- `.env`
- `account-management/managed-users.json`
- `account-management/accounts-summary.txt`

This makes updates much safer for non-technical users.

## Suggested beginner flow

1. Double-click `install-flow-system-from-github.cmd`
2. Wait for it to finish
3. Double-click `start-installed-flow-system.cmd`
4. Later, double-click `update-flow-system-from-github.cmd`

On a fresh public install, the first start will open the self-setup flow so the user can create the first admin account.

## Tell OpenClaw what to do

Once these files are available on a user's machine, they can also tell OpenClaw something like:

```text
Please run install-flow-system-from-github.cmd for me, then start the installed Flow System.
```

Or later:

```text
Please run update-flow-system-from-github.cmd and then restart the installed Flow System.
```

## Repo-local skills

The install/update flow also syncs any repo-local skills found in:

- `skills/openclaw-conversation-router`
- `skills/openclaw-external-task-pipeline`

That keeps the Flow System code and its companion skills aligned.
