import { z } from "zod";

import {
  actionTypeSchema,
  agentStatusSchema,
  eventTypeSchema,
  filePurposeSchema,
  riskLevelSchema,
  taskStatusSchema,
} from "./enums.js";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const entityIdSchema = z.string().min(5).max(128);
const requestIdSchema = z.string().min(5).max(128);

export const attachmentManifestItemSchema = z.object({
  file_id: entityIdSchema,
  file_name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  sha256: z.string().length(64),
  size_bytes: z.number().int().nonnegative(),
});

export const workflowTemplateStepSchema = z.object({
  step_id: entityIdSchema.optional(),
  step_code: z.string().min(1).max(100),
  step_name: z.string().min(1).max(200),
  step_order: z.number().int().positive(),
  owner_role: z.string().min(1).max(100),
  owner_user_id: entityIdSchema.optional(),
  entry_condition: z.string().max(500).optional(),
  exit_condition: z.string().max(500).optional(),
  sla_minutes: z.number().int().positive(),
  status: taskStatusSchema.optional(),
});

export const workflowTemplateSchema = z.object({
  workflow_template_id: entityIdSchema,
  workflow_name: z.string().min(1).max(200),
  workflow_type: z.string().min(1).max(100),
  template_version: z.number().int().positive(),
  is_active: z.boolean(),
  steps: z.array(workflowTemplateStepSchema).min(1),
});

export const taskDeliveryRequestSchema = z.object({
  request_id: requestIdSchema,
  project_id: entityIdSchema,
  workflow_id: entityIdSchema,
  workflow_template_id: entityIdSchema.optional(),
  template_version: z.number().int().positive().optional(),
  step_id: entityIdSchema,
  task_title: z.string().min(1).max(200),
  task_type: z.string().min(1).max(100),
  sender_user_id: entityIdSchema,
  target_user_id: entityIdSchema,
  target_agent_id: entityIdSchema,
  priority: z.enum(["low", "medium", "high", "critical"]),
  deadline: isoDateTimeSchema,
  summary: z.string().min(1).max(4000),
  constraints: z.array(z.string().min(1).max(500)).default([]),
  deliverables: z.array(z.string().min(1).max(500)).default([]),
  attachment_file_ids: z.array(entityIdSchema).default([]),
  plan_mode: z.enum(["structured", "freeform"]).default("structured"),
});

export const checklistItemSchema = z.object({
  checklist_item_id: entityIdSchema,
  task_id: entityIdSchema,
  item_order: z.number().int().nonnegative(),
  item_title: z.string().min(1).max(200),
  item_description: z.string().max(1000).optional(),
  status: z.enum(["pending", "in_progress", "done"]),
  completed_at: isoDateTimeSchema.optional(),
  completed_by: entityIdSchema.optional(),
  source: z.enum(["template", "task_type", "default"]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const eventEnvelopeSchema = z.object({
  request_id: requestIdSchema,
  event_type: eventTypeSchema,
  task_id: entityIdSchema.optional(),
  project_id: entityIdSchema.optional(),
  workflow_id: entityIdSchema.optional(),
  actor_type: z.enum(["user", "agent", "system"]),
  actor_id: entityIdSchema,
  source_agent_id: entityIdSchema.optional(),
  source_machine: z.string().max(255).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurred_at: isoDateTimeSchema,
});

export const taskReplySchema = z.object({
  request_id: requestIdSchema,
  task_id: entityIdSchema,
  agent_id: entityIdSchema,
  user_id: entityIdSchema,
  status: taskStatusSchema,
  progress_percent: z.number().int().min(0).max(100),
  current_step: z.string().min(1).max(200),
  message: z.string().max(2000),
  result_files: z.array(attachmentManifestItemSchema).default([]),
  occurred_at: isoDateTimeSchema,
});

export const fileObjectSchema = z.object({
  file_id: entityIdSchema,
  task_id: entityIdSchema.optional(),
  purpose: filePurposeSchema,
  original_name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  size_bytes: z.number().int().nonnegative(),
  sha256_declared: z.string().length(64),
  sha256_actual: z.string().length(64).optional(),
  storage_rel_path: z.string().min(1).max(500),
  status: z.enum(["staged", "ready", "failed"]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const registerAgentRequestSchema = z.object({
  request_id: requestIdSchema.optional(),
  agent_name: z.string().min(1).max(100),
  machine_name: z.string().min(1).max(100),
  owner_user_id: entityIdSchema,
  ip_address: z.string().min(1).max(100),
  runtime_version: z.string().min(1).max(50),
  local_ui_port: z.number().int().positive().max(65535).default(38500),
  os_type: z.enum(["windows", "linux", "macos"]),
  capabilities: z.array(z.string().min(1).max(100)).default([]),
});

export const registerAgentResponseSchema = z.object({
  agent_id: entityIdSchema,
  agent_token: z.string().min(16),
  poll_interval_seconds: z.number().int().positive(),
});

export const heartbeatSchema = z.object({
  request_id: requestIdSchema.optional(),
  agent_id: entityIdSchema,
  status: agentStatusSchema,
  last_seen_tasks: z.number().int().nonnegative(),
  current_load: z.number().int().nonnegative(),
  occurred_at: isoDateTimeSchema.optional(),
});

export const taskStatusUpdateSchema = z.object({
  request_id: requestIdSchema,
  task_id: entityIdSchema,
  status: taskStatusSchema,
  actor_role: z.string().min(1).max(100),
  current_step: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  occurred_at: isoDateTimeSchema,
});

export const taskUpdateRequestSchema = z.object({
  request_id: requestIdSchema,
  task_id: entityIdSchema,
  project_id: entityIdSchema.optional(),
  workflow_id: entityIdSchema.optional(),
  workflow_template_id: entityIdSchema.optional(),
  template_version: z.number().int().positive().optional(),
  step_id: entityIdSchema.optional(),
  task_title: z.string().min(1).max(200).optional(),
  task_type: z.string().min(1).max(100).optional(),
  assignee_user_id: entityIdSchema.optional(),
  assignee_agent_id: entityIdSchema.optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  deadline: isoDateTimeSchema.optional(),
  summary: z.string().min(1).max(4000).optional(),
  constraints: z.array(z.string().min(1).max(500)).optional(),
  deliverables: z.array(z.string().min(1).max(500)).optional(),
});

export const checklistUpdateSchema = z.object({
  request_id: requestIdSchema,
  task_id: entityIdSchema,
  checklist_item_id: entityIdSchema,
  status: z.enum(["pending", "in_progress", "done"]),
  completed_by: entityIdSchema.optional(),
  occurred_at: isoDateTimeSchema,
});

export const projectUpdateRequestSchema = z.object({
  request_id: requestIdSchema,
  project_id: entityIdSchema,
  project_name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(4000).optional(),
  department: z.string().min(1).max(64).optional(),
  start_date: isoDateTimeSchema.optional(),
  due_date: isoDateTimeSchema.optional(),
  participant_user_ids: z.array(entityIdSchema).min(1).optional(),
  owner_user_id: entityIdSchema.optional(),
  project_type: z.string().min(1).max(64).optional(),
  priority: z.string().min(2).max(2).optional(),
  status: z.string().min(3).max(32).optional(),
});

export const openClawTaskProgressStepSchema = z.object({
  step_index: z.number().int().positive(),
  step_label: z.string().trim().min(1).max(80),
  status: z.enum(["completed", "active", "pending"]),
  actor_user_id: entityIdSchema.optional(),
  actor_display_name: z.string().trim().min(1).max(120).optional(),
  actor_avatar_text: z.string().trim().min(1).max(8).optional(),
  happened_at: isoDateTimeSchema.optional(),
  source: z.enum(["openclaw", "user", "system"]).default("openclaw"),
});

export const openClawTaskProgressUpsertSchema = z.object({
  request_id: requestIdSchema,
  linked_conversation_id: entityIdSchema.optional(),
  linked_message_id: entityIdSchema.optional(),
  steps: z.array(openClawTaskProgressStepSchema).min(1),
  active_step_index: z.number().int().positive(),
  current_status_label: z.string().trim().min(1).max(120),
  sync_task_status: z.enum(["new", "in_progress", "done"]).optional(),
  decision_summary: z.string().trim().min(1).max(500),
});

export const actionRequestSchema = z.object({
  request_id: requestIdSchema,
  action_type: actionTypeSchema,
  task_id: entityIdSchema,
  file_id: entityIdSchema.optional(),
  confirm_start: z.boolean().default(false),
  occurred_at: isoDateTimeSchema,
});

export const riskRecordSchema = z.object({
  task_id: entityIdSchema,
  risk_level: riskLevelSchema,
  risk_code: z.enum(["overdue", "stale", "agent-offline"]),
  detected_at: isoDateTimeSchema,
  details: z.string().max(1000),
});

export type TaskDeliveryRequest = z.infer<typeof taskDeliveryRequestSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type TaskReply = z.infer<typeof taskReplySchema>;
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;
export type FileObject = z.infer<typeof fileObjectSchema>;
export type RegisterAgentRequest = z.infer<typeof registerAgentRequestSchema>;
export type RegisterAgentResponse = z.infer<typeof registerAgentResponseSchema>;
export type Heartbeat = z.infer<typeof heartbeatSchema>;
export type TaskStatusUpdate = z.infer<typeof taskStatusUpdateSchema>;
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>;
export type ChecklistUpdate = z.infer<typeof checklistUpdateSchema>;
export type ProjectUpdateRequest = z.infer<typeof projectUpdateRequestSchema>;
export type OpenClawTaskProgressStep = z.infer<typeof openClawTaskProgressStepSchema>;
export type OpenClawTaskProgressUpsert = z.infer<typeof openClawTaskProgressUpsertSchema>;
export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type RiskRecord = z.infer<typeof riskRecordSchema>;
