CREATE TABLE IF NOT EXISTS "users" (
  "user_id" varchar(64) PRIMARY KEY NOT NULL,
  "username" varchar(100) NOT NULL,
  "password_hash" text NOT NULL,
  "role" varchar(32) NOT NULL,
  "display_name" varchar(120) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "session_id" varchar(64) PRIMARY KEY NOT NULL,
  "user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "csrf_token" varchar(128) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_bootstrap_tokens" (
  "bootstrap_token_id" varchar(64) PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "token_plaintext" text,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_bootstrap_tokens_token_hash_unique" ON "agent_bootstrap_tokens" ("token_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
  "agent_id" varchar(64) PRIMARY KEY NOT NULL,
  "agent_name" varchar(120) NOT NULL,
  "machine_name" varchar(120) NOT NULL,
  "owner_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "ip_address" varchar(100) NOT NULL,
  "local_ui_port" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "runtime_version" varchar(50) NOT NULL,
  "os_type" varchar(32) NOT NULL,
  "capabilities_json" jsonb NOT NULL,
  "token_hash" text NOT NULL,
  "token_preview" varchar(32) NOT NULL,
  "last_heartbeat_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_user_id_idx" ON "agents" ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_token_hash_unique" ON "agents" ("token_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_heartbeats" (
  "agent_id" varchar(64) NOT NULL REFERENCES "agents"("agent_id") ON DELETE RESTRICT,
  "occurred_at" timestamptz NOT NULL,
  "status" varchar(32) NOT NULL,
  "current_load" integer NOT NULL,
  "last_seen_tasks" integer NOT NULL,
  PRIMARY KEY ("agent_id", "occurred_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_heartbeats_occurred_at_idx" ON "agent_heartbeats" ("occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "project_id" varchar(64) PRIMARY KEY NOT NULL,
  "project_code" varchar(64) NOT NULL,
  "project_name" varchar(200) NOT NULL,
  "description" text NOT NULL,
  "department" varchar(64) NOT NULL,
  "owner_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "participant_user_ids_json" jsonb NOT NULL,
  "project_type" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL,
  "priority" varchar(32) NOT NULL,
  "start_date" timestamptz,
  "due_date" timestamptz,
  "current_stage" varchar(120) NOT NULL,
  "completion_rate" integer NOT NULL,
  "attachment_manifest_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_project_code_unique" ON "projects" ("project_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_owner_user_id_idx" ON "projects" ("owner_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_templates" (
  "workflow_template_id" varchar(64) PRIMARY KEY NOT NULL,
  "workflow_name" varchar(200) NOT NULL,
  "workflow_type" varchar(100) NOT NULL,
  "template_version" integer NOT NULL,
  "is_active" boolean NOT NULL,
  "steps_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
  "workflow_id" varchar(64) PRIMARY KEY NOT NULL,
  "project_id" varchar(64) NOT NULL REFERENCES "projects"("project_id") ON DELETE RESTRICT,
  "workflow_template_id" varchar(64) NOT NULL REFERENCES "workflow_templates"("workflow_template_id") ON DELETE RESTRICT,
  "template_version" integer NOT NULL,
  "workflow_name" varchar(200) NOT NULL,
  "workflow_type" varchar(100) NOT NULL,
  "status" varchar(32) NOT NULL,
  "current_step_id" varchar(64),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_project_id_idx" ON "workflows" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_template_id_idx" ON "workflows" ("workflow_template_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "task_id" varchar(64) PRIMARY KEY NOT NULL,
  "request_id" varchar(128) NOT NULL,
  "project_id" varchar(64) NOT NULL REFERENCES "projects"("project_id") ON DELETE RESTRICT,
  "workflow_id" varchar(64) NOT NULL REFERENCES "workflows"("workflow_id") ON DELETE RESTRICT,
  "workflow_template_id" varchar(64) REFERENCES "workflow_templates"("workflow_template_id") ON DELETE RESTRICT,
  "template_version" integer,
  "step_id" varchar(64) NOT NULL,
  "task_title" varchar(200) NOT NULL,
  "task_type" varchar(100) NOT NULL,
  "sender_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "assignee_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "assignee_agent_id" varchar(64) NOT NULL REFERENCES "agents"("agent_id") ON DELETE RESTRICT,
  "priority" varchar(32) NOT NULL,
  "status" varchar(32) NOT NULL,
  "progress_percent" integer NOT NULL,
  "summary" text NOT NULL,
  "constraints_json" jsonb NOT NULL,
  "deliverables_json" jsonb NOT NULL,
  "deadline" timestamptz NOT NULL,
  "received_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "last_event_at" timestamptz NOT NULL,
  "risk_level" varchar(32) NOT NULL,
  "local_task_path" text,
  "output_path" text,
  "attachment_manifest_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_request_id_idx" ON "tasks" ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_id_idx" ON "tasks" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_agent_id_idx" ON "tasks" ("assignee_agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_last_event_at_idx" ON "tasks" ("last_event_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_checklist_items" (
  "checklist_item_id" varchar(64) PRIMARY KEY NOT NULL,
  "task_id" varchar(64) NOT NULL REFERENCES "tasks"("task_id") ON DELETE RESTRICT,
  "item_order" integer NOT NULL,
  "item_title" varchar(200) NOT NULL,
  "item_description" text,
  "status" varchar(32) NOT NULL,
  "completed_at" timestamptz,
  "completed_by" varchar(64),
  "source" varchar(32) NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_checklist_items_task_id_idx" ON "task_checklist_items" ("task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
  "event_id" varchar(64) PRIMARY KEY NOT NULL,
  "request_id" varchar(128) NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "task_id" varchar(64) REFERENCES "tasks"("task_id") ON DELETE RESTRICT,
  "project_id" varchar(64) REFERENCES "projects"("project_id") ON DELETE RESTRICT,
  "workflow_id" varchar(64) REFERENCES "workflows"("workflow_id") ON DELETE RESTRICT,
  "actor_type" varchar(32) NOT NULL,
  "actor_id" varchar(64) NOT NULL,
  "source_agent_id" varchar(64) REFERENCES "agents"("agent_id") ON DELETE RESTRICT,
  "source_machine" varchar(255),
  "payload_json" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_task_id_idx" ON "events" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_occurred_at_idx" ON "events" ("occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_objects" (
  "file_id" varchar(64) PRIMARY KEY NOT NULL,
  "task_id" varchar(64) REFERENCES "tasks"("task_id") ON DELETE RESTRICT,
  "project_id" varchar(64) REFERENCES "projects"("project_id") ON DELETE RESTRICT,
  "purpose" varchar(32) NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "content_type" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256_declared" varchar(64) NOT NULL,
  "sha256_actual" varchar(64),
  "storage_rel_path" text NOT NULL,
  "status" varchar(32) NOT NULL,
  "created_by_kind" varchar(16) NOT NULL,
  "created_by_user_id" varchar(64) REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "created_by_agent_id" varchar(64) REFERENCES "agents"("agent_id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "file_objects_created_by_check" CHECK (
    (
      "created_by_kind" = 'user'
      AND "created_by_user_id" IS NOT NULL
      AND "created_by_agent_id" IS NULL
    )
    OR (
      "created_by_kind" = 'agent'
      AND "created_by_agent_id" IS NOT NULL
      AND "created_by_user_id" IS NULL
    )
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_objects_task_id_idx" ON "file_objects" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_objects_project_id_idx" ON "file_objects" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
  "conversation_id" varchar(64) PRIMARY KEY NOT NULL,
  "owner_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_owner_user_id_idx" ON "conversations" ("owner_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "message_id" varchar(64) PRIMARY KEY NOT NULL,
  "conversation_id" varchar(64) NOT NULL REFERENCES "conversations"("conversation_id") ON DELETE RESTRICT,
  "owner_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "message_type" varchar(64) NOT NULL,
  "author_kind" varchar(32) NOT NULL,
  "body" text NOT NULL,
  "source_user_id" varchar(64) REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "source_display_name" varchar(120),
  "target_user_id" varchar(64) REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "target_agent_id" varchar(64) REFERENCES "agents"("agent_id") ON DELETE RESTRICT,
  "sync_status" varchar(32) NOT NULL,
  "delivered_to_agent_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_target_agent_sync_status_idx" ON "conversation_messages" ("target_agent_id", "sync_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_records" (
  "risk_record_id" varchar(64) PRIMARY KEY NOT NULL,
  "task_id" varchar(64) NOT NULL REFERENCES "tasks"("task_id") ON DELETE RESTRICT,
  "risk_code" varchar(64) NOT NULL,
  "risk_level" varchar(32) NOT NULL,
  "details" text NOT NULL,
  "detected_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_records_task_id_idx" ON "risk_records" ("task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "idempotency_key" varchar(256) PRIMARY KEY NOT NULL,
  "endpoint" varchar(160) NOT NULL,
  "actor_id" varchar(64) NOT NULL,
  "response_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_releases" (
  "version" varchar(50) PRIMARY KEY NOT NULL,
  "notes" text NOT NULL,
  "package_rel_path" text NOT NULL,
  "package_sha256" varchar(64) NOT NULL,
  "package_size_bytes" bigint NOT NULL,
  "minimum_runtime_version" varchar(50),
  "published_by_user_id" varchar(64) NOT NULL REFERENCES "users"("user_id") ON DELETE RESTRICT,
  "published_at" timestamptz NOT NULL,
  "is_current" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_releases_is_current_idx" ON "agent_releases" ("is_current");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_meta" (
  "meta_key" varchar(128) PRIMARY KEY NOT NULL,
  "value_json" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
  "import_run_id" varchar(64) PRIMARY KEY NOT NULL,
  "schema_version" varchar(64) NOT NULL,
  "tool_version" varchar(64) NOT NULL,
  "source_hashes_json" jsonb NOT NULL,
  "counts_json" jsonb NOT NULL,
  "verification_json" jsonb NOT NULL,
  "managed_users_imported_count" integer NOT NULL DEFAULT 0,
  "platform_state_imported_count" integer NOT NULL DEFAULT 0,
  "agent_sqlite_recovered_count" integer NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_status_idx" ON "import_runs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_started_at_idx" ON "import_runs" ("started_at");
