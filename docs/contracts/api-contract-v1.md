# API Contract v1

## Scope

MVP covers:

- user auth via session cookies
- agent register and heartbeat
- file upload-init, content upload, complete, and streaming download
- task delivery creation
- task listing, details, status, checklist, and timeline
- event ingestion
- agent polling for pending deliveries, config, and workflow templates

## Hard rules

- All write endpoints accept `request_id` and are idempotent across retries.
- `POST /api/v1/task-deliveries` succeeds only when `target_agent_id` resolves and every referenced `file_object.status` is `ready`.
- File uploads and downloads are streaming only.
- `files/complete` recomputes `sha256` and `size_bytes` server-side before a file can become `ready`.
- `waiting_review -> done` is allowed only for `owner` and `admin`.
- `invalid` is terminal and cannot transition back into an execution state.
