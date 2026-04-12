CREATE TABLE IF NOT EXISTS "openclaw_task_progress" (
  "task_id" varchar(64) PRIMARY KEY REFERENCES "tasks"("task_id") ON DELETE RESTRICT,
  "linked_conversation_id" varchar(64),
  "linked_message_ids_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "steps_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "active_step_index" integer NOT NULL,
  "current_status_label" varchar(120) NOT NULL,
  "last_decision_summary" text NOT NULL,
  "updated_at" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "openclaw_task_progress_conversation_id_idx"
  ON "openclaw_task_progress" ("linked_conversation_id");
