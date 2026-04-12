import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    userId: varchar("user_id", { length: 64 }).primaryKey(),
    username: varchar("username", { length: 100 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 32 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    usernameUnique: uniqueIndex("users_username_unique").on(table.username),
  }),
);

export const sessions = pgTable(
  "auth_sessions",
  {
    sessionId: varchar("session_id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    csrfToken: varchar("csrf_token", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userIdx: index("auth_sessions_user_id_idx").on(table.userId),
  }),
);

export const bootstrapTokens = pgTable(
  "agent_bootstrap_tokens",
  {
    bootstrapTokenId: varchar("bootstrap_token_id", { length: 64 }).primaryKey(),
    tokenHash: text("token_hash").notNull(),
    tokenPlaintext: text("token_plaintext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("agent_bootstrap_tokens_token_hash_unique").on(table.tokenHash),
  }),
);

export const agents = pgTable(
  "agents",
  {
    agentId: varchar("agent_id", { length: 64 }).primaryKey(),
    agentName: varchar("agent_name", { length: 120 }).notNull(),
    machineName: varchar("machine_name", { length: 120 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    ipAddress: varchar("ip_address", { length: 100 }).notNull(),
    localUiPort: integer("local_ui_port").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    runtimeVersion: varchar("runtime_version", { length: 50 }).notNull(),
    osType: varchar("os_type", { length: 32 }).notNull(),
    capabilitiesJson: jsonb("capabilities_json").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPreview: varchar("token_preview", { length: 32 }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    ownerIdx: index("agents_owner_user_id_idx").on(table.ownerUserId),
    tokenHashUnique: uniqueIndex("agents_token_hash_unique").on(table.tokenHash),
  }),
);

export const agentHeartbeats = pgTable(
  "agent_heartbeats",
  {
    agentId: varchar("agent_id", { length: 64 }).notNull().references(() => agents.agentId, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    currentLoad: integer("current_load").notNull(),
    lastSeenTasks: integer("last_seen_tasks").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.occurredAt] }),
    occurredIdx: index("agent_heartbeats_occurred_at_idx").on(table.occurredAt),
  }),
);

export const projects = pgTable(
  "projects",
  {
    projectId: varchar("project_id", { length: 64 }).primaryKey(),
    projectCode: varchar("project_code", { length: 64 }).notNull(),
    projectName: varchar("project_name", { length: 200 }).notNull(),
    description: text("description").notNull(),
    department: varchar("department", { length: 64 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    participantUserIdsJson: jsonb("participant_user_ids_json").notNull(),
    projectType: varchar("project_type", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    priority: varchar("priority", { length: 32 }).notNull(),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    currentStage: varchar("current_stage", { length: 120 }).notNull(),
    completionRate: integer("completion_rate").notNull(),
    attachmentManifestJson: jsonb("attachment_manifest_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    projectCodeUnique: uniqueIndex("projects_project_code_unique").on(table.projectCode),
    ownerIdx: index("projects_owner_user_id_idx").on(table.ownerUserId),
  }),
);

export const workflowTemplates = pgTable("workflow_templates", {
  workflowTemplateId: varchar("workflow_template_id", { length: 64 }).primaryKey(),
  workflowName: varchar("workflow_name", { length: 200 }).notNull(),
  workflowType: varchar("workflow_type", { length: 100 }).notNull(),
  templateVersion: integer("template_version").notNull(),
  isActive: boolean("is_active").notNull(),
  stepsJson: jsonb("steps_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const workflows = pgTable(
  "workflows",
  {
    workflowId: varchar("workflow_id", { length: 64 }).primaryKey(),
    projectId: varchar("project_id", { length: 64 }).notNull().references(() => projects.projectId, { onDelete: "restrict" }),
    workflowTemplateId: varchar("workflow_template_id", { length: 64 }).notNull().references(() => workflowTemplates.workflowTemplateId, { onDelete: "restrict" }),
    templateVersion: integer("template_version").notNull(),
    workflowName: varchar("workflow_name", { length: 200 }).notNull(),
    workflowType: varchar("workflow_type", { length: 100 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    currentStepId: varchar("current_step_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    projectIdx: index("workflows_project_id_idx").on(table.projectId),
    templateIdx: index("workflows_template_id_idx").on(table.workflowTemplateId),
  }),
);

export const tasks = pgTable(
  "tasks",
  {
    taskId: varchar("task_id", { length: 64 }).primaryKey(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    projectId: varchar("project_id", { length: 64 }).notNull().references(() => projects.projectId, { onDelete: "restrict" }),
    workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.workflowId, { onDelete: "restrict" }),
    workflowTemplateId: varchar("workflow_template_id", { length: 64 }).references(() => workflowTemplates.workflowTemplateId, {
      onDelete: "restrict",
    }),
    templateVersion: integer("template_version"),
    stepId: varchar("step_id", { length: 64 }).notNull(),
    taskTitle: varchar("task_title", { length: 200 }).notNull(),
    taskType: varchar("task_type", { length: 100 }).notNull(),
    senderUserId: varchar("sender_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    assigneeUserId: varchar("assignee_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    assigneeAgentId: varchar("assignee_agent_id", { length: 64 }).notNull().references(() => agents.agentId, { onDelete: "restrict" }),
    priority: varchar("priority", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    progressPercent: integer("progress_percent").notNull(),
    summary: text("summary").notNull(),
    constraintsJson: jsonb("constraints_json").notNull(),
    deliverablesJson: jsonb("deliverables_json").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    riskLevel: varchar("risk_level", { length: 32 }).notNull(),
    localTaskPath: text("local_task_path"),
    outputPath: text("output_path"),
    attachmentManifestJson: jsonb("attachment_manifest_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    requestIdIdx: index("tasks_request_id_idx").on(table.requestId),
    projectIdx: index("tasks_project_id_idx").on(table.projectId),
    assigneeUserIdx: index("tasks_assignee_user_id_idx").on(table.assigneeUserId),
    assigneeAgentIdx: index("tasks_assignee_agent_id_idx").on(table.assigneeAgentId),
    statusIdx: index("tasks_status_idx").on(table.status),
    lastEventIdx: index("tasks_last_event_at_idx").on(table.lastEventAt),
  }),
);

export const checklistItems = pgTable(
  "task_checklist_items",
  {
    checklistItemId: varchar("checklist_item_id", { length: 64 }).primaryKey(),
    taskId: varchar("task_id", { length: 64 }).notNull().references(() => tasks.taskId, { onDelete: "restrict" }),
    itemOrder: integer("item_order").notNull(),
    itemTitle: varchar("item_title", { length: 200 }).notNull(),
    itemDescription: text("item_description"),
    status: varchar("status", { length: 32 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: varchar("completed_by", { length: 64 }),
    source: varchar("source", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    taskIdx: index("task_checklist_items_task_id_idx").on(table.taskId),
  }),
);

export const events = pgTable(
  "events",
  {
    eventId: varchar("event_id", { length: 64 }).primaryKey(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    taskId: varchar("task_id", { length: 64 }).references(() => tasks.taskId, { onDelete: "restrict" }),
    projectId: varchar("project_id", { length: 64 }).references(() => projects.projectId, { onDelete: "restrict" }),
    workflowId: varchar("workflow_id", { length: 64 }).references(() => workflows.workflowId, { onDelete: "restrict" }),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    actorId: varchar("actor_id", { length: 64 }).notNull(),
    sourceAgentId: varchar("source_agent_id", { length: 64 }).references(() => agents.agentId, { onDelete: "restrict" }),
    sourceMachine: varchar("source_machine", { length: 255 }),
    payloadJson: jsonb("payload_json").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    taskIdx: index("events_task_id_idx").on(table.taskId),
    occurredIdx: index("events_occurred_at_idx").on(table.occurredAt),
  }),
);

export const fileObjects = pgTable(
  "file_objects",
  {
    fileId: varchar("file_id", { length: 64 }).primaryKey(),
    taskId: varchar("task_id", { length: 64 }).references(() => tasks.taskId, { onDelete: "restrict" }),
    projectId: varchar("project_id", { length: 64 }).references(() => projects.projectId, { onDelete: "restrict" }),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256Declared: varchar("sha256_declared", { length: 64 }).notNull(),
    sha256Actual: varchar("sha256_actual", { length: 64 }),
    storageRelPath: text("storage_rel_path").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    createdByKind: varchar("created_by_kind", { length: 16 }).notNull(),
    createdByUserId: varchar("created_by_user_id", { length: 64 }).references(() => users.userId, { onDelete: "restrict" }),
    createdByAgentId: varchar("created_by_agent_id", { length: 64 }).references(() => agents.agentId, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    taskIdx: index("file_objects_task_id_idx").on(table.taskId),
    projectIdx: index("file_objects_project_id_idx").on(table.projectId),
    createdByCheck: check(
      "file_objects_created_by_check",
      sql`(
        (${table.createdByKind} = 'user' and ${table.createdByUserId} is not null and ${table.createdByAgentId} is null) or
        (${table.createdByKind} = 'agent' and ${table.createdByAgentId} is not null and ${table.createdByUserId} is null)
      )`,
    ),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    conversationId: varchar("conversation_id", { length: 64 }).primaryKey(),
    ownerUserId: varchar("owner_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    ownerIdx: index("conversations_owner_user_id_idx").on(table.ownerUserId),
  }),
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    messageId: varchar("message_id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 64 }).notNull().references(() => conversations.conversationId, {
      onDelete: "restrict",
    }),
    ownerUserId: varchar("owner_user_id", { length: 64 }).notNull().references(() => users.userId, { onDelete: "restrict" }),
    messageType: varchar("message_type", { length: 64 }).notNull(),
    authorKind: varchar("author_kind", { length: 32 }).notNull(),
    body: text("body").notNull(),
    sourceUserId: varchar("source_user_id", { length: 64 }).references(() => users.userId, { onDelete: "restrict" }),
    sourceDisplayName: varchar("source_display_name", { length: 120 }),
    targetUserId: varchar("target_user_id", { length: 64 }).references(() => users.userId, { onDelete: "restrict" }),
    targetAgentId: varchar("target_agent_id", { length: 64 }).references(() => agents.agentId, { onDelete: "restrict" }),
    syncStatus: varchar("sync_status", { length: 32 }).notNull(),
    syncDetail: text("sync_detail"),
    deliveredToAgentAt: timestamp("delivered_to_agent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationIdx: index("conversation_messages_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    targetSyncIdx: index("conversation_messages_target_agent_sync_status_idx").on(table.targetAgentId, table.syncStatus),
  }),
);

export const openclawTaskProgress = pgTable(
  "openclaw_task_progress",
  {
    taskId: varchar("task_id", { length: 64 }).primaryKey().references(() => tasks.taskId, { onDelete: "restrict" }),
    linkedConversationId: varchar("linked_conversation_id", { length: 64 }),
    linkedMessageIdsJson: jsonb("linked_message_ids_json").notNull(),
    stepsJson: jsonb("steps_json").notNull(),
    activeStepIndex: integer("active_step_index").notNull(),
    currentStatusLabel: varchar("current_status_label", { length: 120 }).notNull(),
    lastDecisionSummary: text("last_decision_summary").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationIdx: index("openclaw_task_progress_conversation_id_idx").on(table.linkedConversationId),
  }),
);

export const riskRecords = pgTable(
  "risk_records",
  {
    riskRecordId: varchar("risk_record_id", { length: 64 }).primaryKey(),
    taskId: varchar("task_id", { length: 64 }).notNull().references(() => tasks.taskId, { onDelete: "restrict" }),
    riskCode: varchar("risk_code", { length: 64 }).notNull(),
    riskLevel: varchar("risk_level", { length: 32 }).notNull(),
    details: text("details").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    taskIdx: index("risk_records_task_id_idx").on(table.taskId),
  }),
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  idempotencyKey: varchar("idempotency_key", { length: 256 }).primaryKey(),
  endpoint: varchar("endpoint", { length: 160 }).notNull(),
  actorId: varchar("actor_id", { length: 64 }).notNull(),
  responseJson: jsonb("response_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const agentReleases = pgTable(
  "agent_releases",
  {
    version: varchar("version", { length: 50 }).primaryKey(),
    notes: text("notes").notNull(),
    packageRelPath: text("package_rel_path").notNull(),
    packageSha256: varchar("package_sha256", { length: 64 }).notNull(),
    packageSizeBytes: bigint("package_size_bytes", { mode: "number" }).notNull(),
    minimumRuntimeVersion: varchar("minimum_runtime_version", { length: 50 }),
    publishedByUserId: varchar("published_by_user_id", { length: 64 }).notNull().references(() => users.userId, {
      onDelete: "restrict",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (table) => ({
    currentIdx: index("agent_releases_is_current_idx").on(table.isCurrent),
  }),
);

export const systemMeta = pgTable("system_meta", {
  metaKey: varchar("meta_key", { length: 128 }).primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const importRuns = pgTable(
  "import_runs",
  {
    importRunId: varchar("import_run_id", { length: 64 }).primaryKey(),
    schemaVersion: varchar("schema_version", { length: 64 }).notNull(),
    toolVersion: varchar("tool_version", { length: 64 }).notNull(),
    sourceHashesJson: jsonb("source_hashes_json").notNull(),
    countsJson: jsonb("counts_json").notNull(),
    verificationJson: jsonb("verification_json").notNull(),
    managedUsersImportedCount: integer("managed_users_imported_count").notNull().default(0),
    platformStateImportedCount: integer("platform_state_imported_count").notNull().default(0),
    agentSqliteRecoveredCount: integer("agent_sqlite_recovered_count").notNull().default(0),
    status: varchar("status", { length: 32 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index("import_runs_status_idx").on(table.status),
    startedIdx: index("import_runs_started_at_idx").on(table.startedAt),
  }),
);
