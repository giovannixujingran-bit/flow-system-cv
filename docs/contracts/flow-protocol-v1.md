# Flow Protocol v1

## Shared entities

- `TaskDeliveryRequest`
- `TaskReply`
- `EventEnvelope`
- `WorkflowTemplate`
- `FileObject`

## Shared enums

- task statuses
- event types
- risk levels
- agent statuses
- action types
- file purpose: `attachment | result`

## ID strategy

All entity identifiers use prefixed ULIDs:

- `task_<ulid>`
- `file_<ulid>`
- `evt_<ulid>`
- `req_<ulid>`
- `agent_<ulid>`
- `proj_<ulid>`
- `wf_<ulid>`

## File delivery invariants

- `file_objects` contain only a single purpose field: `attachment` or `result`
- platform storage paths are deterministic
- file hashes are declared by the client and revalidated by the platform
