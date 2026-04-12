import { z } from "zod";

export const taskStatuses = [
  "new",
  "delivered",
  "received",
  "accepted",
  "in_progress",
  "waiting_review",
  "done",
  "archived",
  "invalid",
] as const;

export const eventTypes = [
  "task.created",
  "task.delivered",
  "task.received",
  "task.accepted",
  "task.started",
  "task.checklist.updated",
  "task.progress.updated",
  "task.reminder.sent",
  "task.output.detected",
  "task.submitted",
  "task.completed",
  "task.archived",
  "task.failed",
  "agent.heartbeat",
] as const;

export const riskLevels = ["none", "low", "medium", "high", "critical"] as const;
export const agentStatuses = ["online", "offline", "degraded"] as const;
export const actionTypes = ["open_task_folder", "open_attachment", "open_output_folder", "start_task"] as const;
export const filePurposes = ["attachment", "result"] as const;
export const userRoles = ["admin", "owner", "member", "assignee"] as const;
export const boardStatuses = ["new", "delivered", "received", "in_progress", "waiting_review", "done"] as const;

export const taskStatusSchema = z.enum(taskStatuses);
export const eventTypeSchema = z.enum(eventTypes);
export const riskLevelSchema = z.enum(riskLevels);
export const agentStatusSchema = z.enum(agentStatuses);
export const actionTypeSchema = z.enum(actionTypes);
export const filePurposeSchema = z.enum(filePurposes);
export const userRoleSchema = z.enum(userRoles);
export const boardStatusSchema = z.enum(boardStatuses);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type FilePurpose = z.infer<typeof filePurposeSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type BoardStatus = z.infer<typeof boardStatusSchema>;
