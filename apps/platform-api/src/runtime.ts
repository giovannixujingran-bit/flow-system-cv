import path from "node:path";

import { assertTaskTransition, makeId, toBoardStatus, type UserRole } from "@flow-system/flow-protocol";

import type { PlatformApiConfig } from "./config.js";
import { evaluateRisks } from "./domain/risk-engine.js";
import { addTaskEventIndex, listTaskChecklist } from "./state.js";
import { ensureDirectory, moveFile, sanitizeFileName } from "./storage/files.js";
import type { AgentRecord, AppState, EventRecord, FileRecord, IdempotencyRecord, ProjectRecord, TaskRecord, UserRecord } from "./types.js";
import { isVersionNewer } from "./versions.js";

export function nowIso(): string {
  return new Date().toISOString();
}

function safeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function filePathFromRel(config: PlatformApiConfig, storageRelPath: string): string {
  return path.resolve(config.storageRoot, storageRelPath);
}

export function ensureStorageRoots(config: PlatformApiConfig): void {
  for (const rel of ["staged", "tasks", "projects", "archive", path.join("releases", "agents")]) {
    ensureDirectory(path.join(config.storageRoot, rel));
  }
}

export function isAgentUpdateAvailable(state: AppState, runtimeVersion: string): boolean {
  const release = state.currentAgentRelease;
  if (!release) {
    return false;
  }
  if (release.minimumRuntimeVersion && isVersionNewer(release.minimumRuntimeVersion, runtimeVersion)) {
    return false;
  }
  return isVersionNewer(release.version, runtimeVersion);
}

function roleForTask(user: UserRecord, task: TaskRecord): UserRole {
  return user.role === "admin"
    ? "admin"
    : user.userId === task.assigneeUserId
      ? "assignee"
      : "member";
}

export function canManageProject(user: UserRecord, project: ProjectRecord): boolean {
  return user.role === "admin" || user.role === "owner" || user.userId === project.ownerUserId;
}

export function roleForTaskInState(state: AppState, user: UserRecord, task: TaskRecord): UserRole {
  if (user.role === "admin") {
    return "admin";
  }

  const project = state.projects.get(task.projectId);
  if (project && canManageProject(user, project)) {
    return "owner";
  }

  return roleForTask(user, task);
}

export function canDeleteTask(state: AppState, user: UserRecord, task: TaskRecord): boolean {
  const project = state.projects.get(task.projectId);
  return project ? canManageProject(user, project) : user.role === "admin" || user.role === "owner";
}

function removeTaskChecklist(state: AppState, taskId: string): void {
  const checklistIds = state.taskChecklistIndex.get(taskId) ?? [];
  for (const checklistId of checklistIds) {
    state.checklist.delete(checklistId);
  }
  state.taskChecklistIndex.delete(taskId);
}

function removeTaskEvents(state: AppState, taskId: string): void {
  const eventIds = state.taskEventIndex.get(taskId) ?? [];
  for (const eventId of eventIds) {
    state.events.delete(eventId);
  }
  state.taskEventIndex.delete(taskId);
}

function removeTaskFiles(state: AppState, taskId: string): void {
  for (const file of [...state.fileObjects.values()]) {
    if (file.task_id === taskId) {
      state.fileObjects.delete(file.file_id);
    }
  }
}

function removeTaskRisks(state: AppState, taskId: string): void {
  for (const [riskKey, risk] of state.risks.entries()) {
    if (risk.taskId === taskId) {
      state.risks.delete(riskKey);
    }
  }
}

function removeTaskOpenClawProgress(state: AppState, taskId: string): void {
  state.openClawTaskProgress.delete(taskId);
}

export function deleteTaskState(state: AppState, taskId: string): void {
  removeTaskChecklist(state, taskId);
  removeTaskEvents(state, taskId);
  removeTaskFiles(state, taskId);
  removeTaskRisks(state, taskId);
  removeTaskOpenClawProgress(state, taskId);
  state.tasks.delete(taskId);
}

export function deleteProjectState(state: AppState, projectId: string): void {
  for (const task of [...state.tasks.values()]) {
    if (task.projectId === projectId) {
      deleteTaskState(state, task.taskId);
    }
  }

  for (const workflow of [...state.workflows.values()]) {
    if (workflow.projectId === projectId) {
      state.workflows.delete(workflow.workflowId);
    }
  }

  for (const file of [...state.fileObjects.values()]) {
    if (file.project_id === projectId) {
      state.fileObjects.delete(file.file_id);
    }
  }

  for (const [eventId, event] of state.events.entries()) {
    if (event.project_id === projectId) {
      state.events.delete(eventId);
    }
  }

  state.projects.delete(projectId);
}

export function setTaskRiskLevel(task: TaskRecord, risks: AppState["risks"]): void {
  const relevant = [...risks.values()].filter((risk) => risk.taskId === task.taskId).map((risk) => risk.riskLevel);
  if (relevant.includes("critical")) {
    task.riskLevel = "critical";
  } else if (relevant.includes("high")) {
    task.riskLevel = "high";
  } else if (relevant.includes("medium")) {
    task.riskLevel = "medium";
  } else if (relevant.includes("low")) {
    task.riskLevel = "low";
  } else {
    task.riskLevel = "none";
  }
}

export function runRiskScan(state: AppState, config: PlatformApiConfig): void {
  state.risks.clear();
  const nextRisks = evaluateRisks([...state.tasks.values()], state.heartbeats, state.agents, config, new Date());
  for (const risk of nextRisks) {
    state.risks.set(`${risk.taskId}:${risk.riskCode}`, risk);
  }
  for (const task of state.tasks.values()) {
    setTaskRiskLevel(task, state.risks);
  }
}

export async function withIdempotency<T>(
  state: AppState,
  endpoint: string,
  actorId: string,
  requestId: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const key = `${actorId}:${endpoint}:${requestId}`;
  const existing = state.idempotency.get(key);
  if (existing) {
    return existing.response as T;
  }
  const response = await fn();
  const record: IdempotencyRecord = {
    key,
    endpoint,
    actorId,
    response: safeJson(response),
    createdAt: nowIso(),
  };
  state.idempotency.set(key, record);
  return response;
}

export function appendPlatformEvent(state: AppState, eventInput: Omit<EventRecord, "eventId" | "receivedAt">): EventRecord {
  const event: EventRecord = {
    ...eventInput,
    eventId: makeId("evt"),
    receivedAt: nowIso(),
  };
  state.events.set(event.eventId, event);
  if (event.task_id) {
    addTaskEventIndex(state, event.task_id, event.eventId);
    const task = state.tasks.get(event.task_id);
    if (task) {
      task.lastEventAt = event.occurred_at;
      task.updatedAt = nowIso();
    }
  }
  return event;
}

export function ensureFileReady(state: AppState, fileId: string): FileRecord {
  const file = state.fileObjects.get(fileId);
  if (!file) {
    throw new Error(`Unknown file: ${fileId}`);
  }
  if (file.status !== "ready") {
    throw new Error(`File ${fileId} is not ready`);
  }
  return file;
}

function attachmentTargetRel(taskId: string, file: FileRecord): string {
  return path.join("tasks", taskId, "attachments", `${file.file_id}-${sanitizeFileName(file.original_name)}`);
}

function projectAttachmentTargetRel(projectId: string, file: FileRecord): string {
  return path.join("projects", projectId, "attachments", `${file.file_id}-${sanitizeFileName(file.original_name)}`);
}

export function resultTargetRel(taskId: string, file: FileRecord): string {
  return path.join("tasks", taskId, "results", `${file.file_id}-${sanitizeFileName(file.original_name)}`);
}

function attachFilesToTarget(
  state: AppState,
  config: PlatformApiConfig,
  target: { kind: "task"; id: string } | { kind: "project"; id: string },
  fileIds: string[],
): Array<TaskRecord["attachmentManifest"][number] | ProjectRecord["attachmentManifest"][number]> {
  return fileIds.map((fileId) => {
    const file = ensureFileReady(state, fileId);
    if (file.purpose !== "attachment") {
      throw new Error(`File ${fileId} is not an attachment`);
    }

    const sourcePath = filePathFromRel(config, file.storage_rel_path);
    const targetRel = target.kind === "task"
      ? attachmentTargetRel(target.id, file)
      : projectAttachmentTargetRel(target.id, file);
    const targetPath = filePathFromRel(config, targetRel);
    if (sourcePath !== targetPath) {
      moveFile(sourcePath, targetPath);
    }
    if (target.kind === "task") {
      file.task_id = target.id;
      delete file.project_id;
    } else {
      file.project_id = target.id;
      delete file.task_id;
    }
    file.storage_rel_path = targetRel;
    file.updated_at = nowIso();
    state.fileObjects.set(file.file_id, file);

    return {
      file_id: file.file_id,
      file_name: file.original_name,
      content_type: file.content_type,
      sha256: file.sha256_actual ?? file.sha256_declared,
      size_bytes: file.size_bytes,
    };
  });
}

export function ensureTaskFileReady(state: AppState, fileId: string): FileRecord {
  return ensureFileReady(state, fileId);
}

export function attachFilesToTask(state: AppState, config: PlatformApiConfig, taskId: string, fileIds: string[]): Array<TaskRecord["attachmentManifest"][number]> {
  return attachFilesToTarget(state, config, { kind: "task", id: taskId }, fileIds) as Array<TaskRecord["attachmentManifest"][number]>;
}

export function attachFilesToProject(
  state: AppState,
  config: PlatformApiConfig,
  projectId: string,
  fileIds: string[],
): Array<ProjectRecord["attachmentManifest"][number]> {
  return attachFilesToTarget(state, config, { kind: "project", id: projectId }, fileIds) as Array<ProjectRecord["attachmentManifest"][number]>;
}

export function maybePromoteToInProgress(state: AppState, task: TaskRecord, source: "user" | "agent", actorId: string): void {
  if (!["received", "accepted"].includes(task.status)) {
    return;
  }

  task.status = "in_progress";
  task.startedAt = task.startedAt ?? nowIso();
  task.updatedAt = nowIso();
  appendPlatformEvent(state, {
    request_id: makeId("req"),
    event_type: "task.started",
    task_id: task.taskId,
    project_id: task.projectId,
    workflow_id: task.workflowId,
    actor_type: source,
    actor_id: actorId,
    source_agent_id: source === "agent" ? actorId : undefined,
    payload: { trigger: source },
    occurred_at: nowIso(),
  });
}

export function transitionTaskStatus(task: TaskRecord, nextStatus: TaskRecord["status"], role: UserRole, occurredAt: string): void {
  assertTaskTransition(task.status, nextStatus, role);
  task.status = nextStatus;
  if (nextStatus === "received") {
    task.receivedAt = task.receivedAt ?? occurredAt;
  }
  if (nextStatus === "in_progress") {
    task.startedAt = task.startedAt ?? occurredAt;
  }
  if (nextStatus === "done") {
    task.completedAt = task.completedAt ?? occurredAt;
    task.progressPercent = 100;
  }
  task.updatedAt = nowIso();
  task.lastEventAt = occurredAt;
}

export function serializeTask(state: AppState, task: TaskRecord) {
  const project = state.projects.get(task.projectId);
  const openClawProgress = state.openClawTaskProgress.get(task.taskId);

  return {
    task_id: task.taskId,
    request_id: task.requestId,
    project_id: task.projectId,
    project_name: project?.projectName ?? task.projectId,
    project_owner_user_id: project?.ownerUserId,
    workflow_id: task.workflowId,
    workflow_template_id: task.workflowTemplateId,
    template_version: task.templateVersion,
    step_id: task.stepId,
    task_title: task.taskTitle,
    task_type: task.taskType,
    sender_user_id: task.senderUserId,
    assignee_user_id: task.assigneeUserId,
    assignee_display_name: state.users.get(task.assigneeUserId)?.displayName ?? task.assigneeUserId,
    assignee_agent_id: task.assigneeAgentId,
    priority: task.priority,
    status: task.status,
    board_status: toBoardStatus(task.status),
    progress_percent: task.progressPercent,
    summary: task.summary,
    constraints: task.constraints,
    deliverables: task.deliverables,
    deadline: task.deadline,
    received_at: task.receivedAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    last_event_at: task.lastEventAt,
    risk_level: task.riskLevel,
    local_task_path: task.localTaskPath,
    output_path: task.outputPath,
    attachment_manifest: task.attachmentManifest,
    checklist: listTaskChecklist(state, task.taskId),
    risk_records: [...state.risks.values()].filter((risk) => risk.taskId === task.taskId),
    openclaw_progress: openClawProgress
      ? {
          ...(openClawProgress.linkedConversationId ? { linked_conversation_id: openClawProgress.linkedConversationId } : {}),
          active_step_index: openClawProgress.activeStepIndex,
          current_status_label: openClawProgress.currentStatusLabel,
          updated_at: openClawProgress.updatedAt,
          steps: openClawProgress.steps.map((step) => ({
            step_index: step.stepIndex,
            step_label: step.stepLabel,
            status: step.status,
            actor_user_id: step.actorUserId,
            actor_display_name: step.actorDisplayName,
            actor_avatar_text: step.actorAvatarText,
            happened_at: step.happenedAt,
            source: step.source,
          })),
        }
      : undefined,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

export function isTaskVisibleToAgent(task: TaskRecord, agent: AgentRecord): boolean {
  return task.assigneeAgentId === agent.agentId;
}
