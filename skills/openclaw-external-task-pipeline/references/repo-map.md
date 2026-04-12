# Repo Map

Use this map to ground implementation before editing.

## Core integration seams

- `apps/platform-api/src/app.ts`
  - Registers all API routes.
  - Add `registerExternalTaskRoutes(runtime)` here when introducing the new intake/update routes.
- `packages/flow-protocol/src/schemas.ts`
  - Holds public transport schemas such as task delivery, status updates, and agent registration.
  - Only add external-task transport contracts here.
- `apps/platform-api/src/routes/tasks.ts`
  - Owns ordinary platform task creation, status updates, checklist updates, task events, and task serialization exposure.
  - This file is a downstream consumer of external-task projection, not the place for AI understanding logic.
- `apps/platform-api/src/routes/conversations.ts`
  - Owns conversation message flow and already appends `openclaw_reply`.
  - Use existing `openclaw_reply` semantics for linked reply emission.
- `apps/platform-web/app/tasks/tasks-board.tsx`
  - Current list UI for task cards.
  - Renders a placeholder 5-step progress model based on coarse task status.
  - External-task progress should plug in here as an optional projection, without breaking the existing fallback.

## Existing domain/state seams

- `apps/platform-api/src/runtime.ts`
  - Contains `serializeTask`.
  - Safe place to append a null-safe external-task projection field.
  - Do not call AI or parse raw external payloads here.
- `apps/platform-api/src/types.ts`
  - Defines `AppState`, `TaskRecord`, `ConversationMessageRecord`, and persistence-facing state shapes.
  - Add `externalTasks: Map<string, ExternalTaskRecord>` here.
- `apps/platform-api/src/storage/app-state.ts`
  - Owns memory snapshot load/save.
  - Must be extended if `AppState` gains `externalTasks`.
- `apps/platform-api/src/storage/postgres-state.ts`
  - Owns Postgres load/save.
  - Must be extended for any new `external_task_records` table.
- `apps/platform-api/src/db/schema.ts`
  - Owns Postgres table definitions.
  - Add the dedicated external-task companion table here.

## Existing conversation/task helpers

- `apps/platform-api/src/state.ts`
  - Contains `appendConversationMessage`, checklist builders, task storage helpers, and preferred-agent lookup.
- `apps/platform-api/src/domain/conversation-forwarding.ts`
  - Shows an existing example of turning one input into both a conversation artifact and a `TaskRecord`.
  - Good reference for orchestration shape, not for AI or UI projection.

## Existing UI consumers

- `apps/platform-web/app/tasks/page.tsx`
  - Fetches task list and passes it into the task board.
- `apps/platform-web/app/tasks/[taskId]/page.tsx`
  - Detail page consumer for serialized task payloads.
- `apps/platform-web/app/globals.css`
  - Contains current task-card layout, stepper visuals, and fallback presentation styles.

## Optional follow-on seam

- `packages/local-overlay-contracts/src/schemas.ts`
  - Only touch this if the user explicitly wants overlay support for external-task projection.
  - It is not required for the first pass of the platform web implementation.

## Recommended additions

- `apps/platform-api/src/routes/external-tasks.ts`
- `apps/platform-api/src/domain/external-task-intake/incoming.ts`
- `apps/platform-api/src/domain/external-task-intake/understand.ts`
- `apps/platform-api/src/domain/external-task-intake/normalize.ts`
- `apps/platform-api/src/domain/external-task-intake/progress.ts`
- `apps/platform-api/src/domain/external-task-intake/reply.ts`
- `apps/platform-api/src/domain/external-task-intake/ui.ts`
- `apps/platform-api/src/domain/external-task-intake/persist.ts`
