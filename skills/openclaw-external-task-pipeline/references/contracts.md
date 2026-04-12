# Contracts

This skill uses a strict layer split:

- `@flow-system/flow-protocol`: transport request/response schemas only
- `platform-api` domain: normalized task, progress model, reply snapshots, persistence companion record
- serializers/web UI: read-only consumers of validated domain output

## Transport contracts

Add transport schemas in `packages/flow-protocol/src/schemas.ts`.

```ts
type ExternalTaskIntakeRequest = {
  request_id: string;
  target_user_id: string;
  target_agent_id?: string;
  payload: IncomingTaskPayload;
};

type ExternalTaskIntakeResponse = {
  accepted: true;
  task_id: string;
  external_task: UITaskModel;
  assistant_reply: AssistantReplySnapshot;
  appended_conversation_reply: boolean;
};

type ExternalTaskProgressUpdateRequest = {
  request_id: string;
  stage_index: 1 | 2 | 3 | 4 | 5;
  current_text: string;
  note?: string;
  occurred_at: string;
  source: "agent" | "user" | "system";
};

type ExternalTaskProgressUpdateResponse = {
  accepted: true;
  task_id: string;
  progress_items: TaskProgressItem[];
  assistant_reply: AssistantReplySnapshot;
  updated_at: string;
  appended_conversation_reply: boolean;
};
```

Rules:

- `request_id` is required for idempotency.
- `target_agent_id` is optional; if omitted, resolve the preferred agent for `target_user_id`.
- The progress-update request accepts one authoritative `current_text` for the new active stage.
- Route responses should return the latest task-facing projection plus reply snapshot so callers can sync immediately.

## Core domain types

```ts
type IncomingTaskPayload = {
  source: {
    channel: "openclaw-node" | "conversation-forward" | "manual-import";
    node_id?: string;
    user_id?: string;
    user_display_name?: string;
    message_id?: string;
    conversation_id?: string;
  };
  title?: string;
  body?: string;
  deadline?: string | null;
  links?: Array<{ url: string; label?: string; kind?: "reference" | "input" | "output" }>;
  attachments?: Array<{ file_id?: string; file_name: string; content_type?: string; size_bytes?: number }>;
  expected_output?: { primary?: "excel" | "document" | "text" | "slides" | "mixed"; notes?: string };
  context_blocks?: string[];
  raw_payload: Record<string, unknown>;
};

type NormalizedTask = {
  task_kind: "trend-summary" | "research-summary" | "data-collection" | "document-drafting" | "generic-analysis";
  title: string;
  summary: string;
  source_label: string;
  due_at?: string;
  deliverable: {
    primary: "excel" | "document" | "text" | "slides" | "mixed";
    format_hint?: string;
  };
  inputs: {
    links: Array<{ url: string; label: string; kind: "reference" | "input" | "output" }>;
    attachments: Array<{ file_id?: string; file_name: string; content_type?: string; size_bytes?: number }>;
    context_blocks: string[];
  };
  current_stage: {
    stage_index: 1 | 2 | 3 | 4 | 5;
    stage_code: "intake" | "collecting-material" | "synthesizing" | "structuring-output" | "awaiting-confirmation";
    stage_label: string;
  };
  suggested_steps: string[];
  ui_hints: {
    subject_label: string;
    due_label?: string;
    deliverable_label: string;
  };
};

type TaskProgressItem = {
  stage_index: 1 | 2 | 3 | 4 | 5;
  stage_code: NormalizedTask["current_stage"]["stage_code"];
  stage_label: string;
  status: "completed" | "active" | "pending";
  current_text: string;
  updated_at: string;
  note?: string;
};

type AssistantReplySnapshot = {
  revision: number;
  body: string;
  current_stage_text: string;
  next_step_text: string;
  created_at: string;
  source: "intake" | "progress-update";
};

type ExternalTaskRecord = {
  task_id: string;
  record_version: number;
  incoming: IncomingTaskPayload;
  normalized: NormalizedTask;
  progress_items: TaskProgressItem[];
  latest_reply: AssistantReplySnapshot;
  reply_history: AssistantReplySnapshot[];
  updated_at: string;
};

type UITaskModel = {
  task_id: string;
  title: string;
  summary: string;
  source_label: string;
  due_label?: string;
  deliverable_label: string;
  materials: {
    links: Array<{ url: string; label: string }>;
    attachments: Array<{ file_name: string; size_bytes?: number }>;
  };
  current_status_label: string;
  progress_items: TaskProgressItem[];
  assistant_reply: AssistantReplySnapshot;
};
```

## Canonical rules

- `NormalizedTask` does not carry `progress_text`.
- `TaskProgressItem.current_text` is the only canonical field for the visible current-progress sentence.
- `NormalizedTask.current_stage` tells the system which stage is active; it does not duplicate the display sentence.
- `ExternalTaskRecord.latest_reply` and `reply_history` are persisted product data.

## Persistence contract

Add `externalTasks: Map<string, ExternalTaskRecord>` to `AppState`.

Memory snapshot:

- Extend `PlatformStateSnapshot` in `storage/app-state.ts` with `externalTasks: ExternalTaskRecord[]`
- Load/save it beside `tasks`, `events`, and `conversationMessages`

Postgres:

```ts
external_task_records (
  task_id varchar(64) primary key references tasks(task_id),
  record_version integer not null,
  incoming_json jsonb not null,
  normalized_json jsonb not null,
  progress_items_json jsonb not null,
  latest_reply_json jsonb not null,
  reply_history_json jsonb not null,
  updated_at timestamptz not null
)
```

## Serializer contract

Extend task serialization with an optional field:

```ts
type SerializedTask = {
  // existing fields
  external_task?: UITaskModel;
};
```

Rules:

- Only attach `external_task` when a companion record exists.
- Ordinary tasks must continue to serialize exactly as before plus `external_task: undefined`.
- Serializer logic reads validated domain data only. No raw payload parsing. No AI calls.
