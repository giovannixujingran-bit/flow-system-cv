# UI Information Architecture v1

## Platform Web

- Login
- Dashboard
- Project list
- Project detail
- Task board
- Task detail
- Task create
- Agent status

## Local Agent UI

- Inbox
- Active tasks
- Task detail with checklist and timeline
- Result submission
- Agent diagnostics

## Shared display rules

- `accepted` and `in_progress` collapse to a single "In Progress" board column
- `invalid` is hidden from active boards by default
- risk badges are derived from `deadline`, `last_event_at`, heartbeat freshness, and active-hour settings
