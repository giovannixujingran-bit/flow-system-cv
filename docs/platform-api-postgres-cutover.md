# Platform API PostgreSQL Cutover

## Current baseline

- Current schema version: `0001_postgres_cutover`
- Migration history lives in `apps/platform-api/src/db/migrations/`
- Runtime storage mode is selected by `STORAGE_MODE=memory|postgres`

## What PostgreSQL mode does

- `platform-api` still uses the existing route surface and in-memory domain logic.
- In `STORAGE_MODE=postgres`, the runtime now:
  - loads the full platform state from PostgreSQL on startup
  - writes successful state-changing requests back to PostgreSQL
  - exposes `/ready` with DB, storage, schema, and key-query checks
- Attachments and release packages stay on disk under `storage/`; PostgreSQL stores metadata and relative paths only.

## Supported operational commands

```bash
npm run db:migrate
npm run db:preflight
npm run db:import-current-state
npm run db:verify-import
```

## Startup flags

`start-flow-system.ps1` now supports:

- `-StorageMode memory|postgres`
- `-DatabaseUrl <postgres-url>`
- `-RunMigrations:$true|$false`
- `-ImportCurrentState:$true|$false`
- `-FailIfDbEmptyAndNoImport:$true|$false`

When `-StorageMode postgres` is used, the startup flow is:

1. run preflight
2. optionally run migrations
3. optionally import current JSON/file-backed state
4. optionally verify the import
5. start `platform-api` and wait for `/ready`

## Import sources

`db:import-current-state` imports from:

- `account-management/managed-users.json`
- `storage/platform-state.json`
- `storage/releases/agents/current.json`

The import writes `system_meta` and `import_runs` metadata, including:

- `schema_version`
- `storage_mode`
- `initial_import_completed_at`
- `initial_import_source_state_hash`
- `initial_import_tool_version`
- `cutover_completed_at`
- `last_import_counts`

## Verification

`db:verify-import` is read-only by default. It checks:

- imported counts against the latest completed `import_runs.counts_json`
- task/user/project/conversation/file/release relationships
- sample project reads
- sample task timelines
- sample attachment existence
- sample release package existence
- one `pending -> ack` conversation probe inside a rollback transaction

## Rollback model

The startup script will fail the cutover before service launch when:

- DB preflight fails
- migrations fail
- import fails
- import verification fails
- the DB is empty and import was not explicitly allowed

The old `memory` mode remains available as the fallback runtime mode.
