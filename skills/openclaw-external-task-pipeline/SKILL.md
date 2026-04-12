---
name: openclaw-external-task-pipeline
description: Use when working in a flow-system checkout on external OpenClaw task intake, AI-first task understanding, normalized task models, progress-card generation, UI task projection, reply snapshot persistence, or external-task progress updates.
---

# OpenClaw External Task Pipeline

## When To Use

Use this skill when the user wants to design, implement, review, or extend the `flow-system` ability to:

- receive tasks from other OpenClaw nodes or forwarded conversation payloads
- normalize external task payloads into stable internal task data
- generate reusable progress items for task cards
- map normalized task data into the platform web task UI
- create and persist assistant-style reply snapshots
- append `openclaw_reply` conversation messages that stay aligned with task-card progress
- add or refine `POST /api/v1/external-tasks/intake`
- add or refine `POST /api/v1/external-tasks/:taskId/progress`

Do not use this skill for general task CRUD, ordinary workflow template changes, or unrelated frontend styling work.

## First Pass

Always ground in the current seams before editing:

1. Resolve the active `flow-system` workspace root before editing. Prefer the current workspace when it contains `apps/platform-api`, `apps/platform-web`, and `packages/flow-protocol`.
2. Read [references/repo-map.md](references/repo-map.md).
3. Read [references/contracts.md](references/contracts.md).
4. Read [references/what-not-to-edit.md](references/what-not-to-edit.md).
5. If progress copy or reply wording is involved, read [references/progress-and-replies.md](references/progress-and-replies.md).
6. If the task is ambiguous, read [references/examples.md](references/examples.md) before changing schemas or routes.

## Default Workflow

This skill defaults to implementation, not a plan-only pass.

1. Inspect the existing route, serializer, state, persistence, and task-card seams from the repo map.
2. Add or update protocol-layer schemas only for transport contracts.
3. Implement or extend a dedicated domain pipeline under `apps/platform-api/src/domain/external-task-intake/`.
4. Persist a companion record for external-task data and reply snapshots.
5. Expose external-task UI projection through task serialization with null-safe fallback for ordinary tasks.
6. Update the platform web task UI to consume external-task projection when available, otherwise preserve current fallback rendering.
7. If conversation linkage is present, append an `openclaw_reply` using existing message semantics.
8. Run the validation steps from [references/validation.md](references/validation.md).

If the user explicitly asks for design only, stop after producing the design artifact they asked for. Otherwise, carry the work through implementation and validation.

## Implementation Rules

- Keep the main pipeline shape:
  `IncomingTaskPayload -> AI understanding candidate -> NormalizedTask -> TaskProgressItem[] -> UITaskModel + AssistantReplySnapshot -> persistence + serializer projection`
- Add these routes unless the user explicitly requests a different integration surface:
  - `POST /api/v1/external-tasks/intake`
  - `POST /api/v1/external-tasks/:taskId/progress`
- Keep route handlers thin. Parsing, understanding, normalization, progress generation, reply generation, and persistence belong in domain services.
- Use AI as the preferred understanding layer, but never trust model output raw. Re-validate and canonicalize everything before it reaches state, serializers, or UI.
- Persist both `latest_reply` and `reply_history`. Reply snapshots are product data, not transient render data.
- Store current progress text only in `TaskProgressItem.current_text`.
- Keep `NormalizedTask.current_stage` as the stage pointer only. Do not add a duplicate `progress_text` field there.
- Preserve the existing task-card fallback for non-external tasks.
- Keep internal companion-record types in `platform-api`; do not move them into `@flow-system/flow-protocol`.

## Reference Loading

- Read [references/contracts.md](references/contracts.md) before changing `flow-protocol`, `AppState`, Postgres schema, or route payloads.
- Read [references/progress-and-replies.md](references/progress-and-replies.md) before changing task-card progress text or reply wording.
- Read [references/examples.md](references/examples.md) before writing prompts, normalizers, or mapping logic for new task kinds.
- Read [references/validation.md](references/validation.md) before closing the task.

## Finish Checklist

Before finishing:

- Re-read [references/what-not-to-edit.md](references/what-not-to-edit.md) if the patch touched serializers, task UI, or conversations.
- Run the skill validator for this skill.
- Run the required workspace build and typecheck commands from [references/validation.md](references/validation.md).
- Verify ordinary tasks still render without the external-task projection.
