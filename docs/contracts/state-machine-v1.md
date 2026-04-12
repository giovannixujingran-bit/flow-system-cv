# State Machine v1

## Task states

`new -> delivered -> received -> accepted -> in_progress -> waiting_review -> done -> archived`

Additional states:

- `invalid`

## Transition rules

- `delivered` means a task is bound to a target agent and visible to that agent.
- `received` is emitted only after the agent persists task metadata, initializes the local directory, and verifies attachments.
- `accepted` means the assignee confirmed handoff but has not started real work.
- `in_progress` is entered only after a legal start trigger.
- `waiting_review -> done` is allowed only for `owner` and `admin`.
- `invalid` is terminal and can only move to `archived`.

## Legal start triggers

- user clicked "Start task"
- first checklist item is completed
- user confirms start after opening the task folder or an attachment
- local agent receives an explicit `start_task` action
