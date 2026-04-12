import { makeId } from "@flow-system/flow-protocol";

import type { AppState, ProjectRecord, UserRecord } from "../types.js";

type ProjectOption = {
  value: string;
  label: string;
};

export const PROJECT_DEPARTMENT_OPTIONS: ProjectOption[] = [
  { value: "product", label: "产品部" },
  { value: "engineering", label: "技术部" },
  { value: "design", label: "设计部" },
  { value: "operations", label: "运营部" },
  { value: "marketing", label: "市场部" },
  { value: "finance", label: "财务部" },
];

export const PROJECT_TYPE_OPTIONS: ProjectOption[] = [
  { value: "delivery", label: "交付项目" },
  { value: "research", label: "研发项目" },
  { value: "operations", label: "运营项目" },
  { value: "marketing", label: "市场项目" },
  { value: "data", label: "数据项目" },
];

export const PROJECT_PRIORITY_OPTIONS: ProjectOption[] = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

export const PROJECT_STATUS_OPTIONS: ProjectOption[] = [
  { value: "not_started", label: "未启动" },
  { value: "in_progress", label: "进行中" },
  { value: "paused", label: "暂停" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

const projectDepartments = new Map(PROJECT_DEPARTMENT_OPTIONS.map((option) => [option.value, option.label]));
const projectTypes = new Map(PROJECT_TYPE_OPTIONS.map((option) => [option.value, option.label]));
const projectPriorities = new Map(PROJECT_PRIORITY_OPTIONS.map((option) => [option.value, option.label]));
const projectStatuses = new Map(PROJECT_STATUS_OPTIONS.map((option) => [option.value, option.label]));

export function projectDepartmentLabel(value: string): string {
  return projectDepartments.get(value) ?? value;
}

export function projectTypeLabel(value: string): string {
  return projectTypes.get(value) ?? value;
}

export function projectPriorityLabel(value: string): string {
  return projectPriorities.get(value) ?? value;
}

export function projectStatusLabel(value: string): string {
  return projectStatuses.get(value) ?? value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createProjectCode(state: AppState): string {
  const prefix = "FLOW-PROJ";
  const existingCodes = new Set([...state.projects.values()].map((project) => project.projectCode));
  let counter = state.projects.size + 1;

  while (true) {
    const candidate = `${prefix}-${String(counter).padStart(4, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

function completionRateForStatus(status: string): number {
  if (status === "done") {
    return 100;
  }
  return 0;
}

function activeUsers(state: AppState): UserRecord[] {
  return [...state.users.values()]
    .filter((user) => !user.deletedAt && (user.status ?? "active") === "active")
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
}

export function listProjectParticipants(state: AppState): UserRecord[] {
  return activeUsers(state);
}

export function listProjectOwners(state: AppState): UserRecord[] {
  return activeUsers(state).filter((user) => ["admin", "owner"].includes(user.role));
}

export function createProjectRecord(
  state: AppState,
  input: {
    projectName: string;
    description: string;
    department: string;
    startDate?: string;
    dueDate?: string;
    participantUserIds: string[];
    ownerUserId: string;
    projectType: string;
    priority: string;
    status: string;
    attachmentManifest: ProjectRecord["attachmentManifest"];
  },
): ProjectRecord {
  const createdAt = nowIso();
  const statusLabel = projectStatusLabel(input.status);

  return {
    projectId: makeId("proj"),
    projectCode: createProjectCode(state),
    projectName: input.projectName.trim(),
    description: input.description.trim(),
    department: input.department,
    ownerUserId: input.ownerUserId,
    participantUserIds: [...new Set(input.participantUserIds)],
    projectType: input.projectType,
    status: input.status,
    priority: input.priority,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    currentStage: statusLabel,
    completionRate: completionRateForStatus(input.status),
    attachmentManifest: input.attachmentManifest,
    createdAt,
    updatedAt: createdAt,
  };
}

export function serializeProject(state: AppState, project: ProjectRecord) {
  return {
    ...project,
    ownerDisplayName: state.users.get(project.ownerUserId)?.displayName ?? project.ownerUserId,
    participantDisplayNames: project.participantUserIds.map((userId) => state.users.get(userId)?.displayName ?? userId),
    departmentLabel: projectDepartmentLabel(project.department),
    projectTypeLabel: projectTypeLabel(project.projectType),
    statusLabel: projectStatusLabel(project.status),
    priorityLabel: projectPriorityLabel(project.priority),
    attachment_manifest: project.attachmentManifest,
  };
}
