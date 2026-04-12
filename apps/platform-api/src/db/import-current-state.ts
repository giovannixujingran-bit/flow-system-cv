import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { WorkflowTemplate } from "@flow-system/flow-protocol";
import { hashSync } from "bcryptjs";

import { readPlatformApiConfig } from "../config.js";
import { createAppState, storeUser } from "../state.js";
import { loadPlatformStateSnapshot } from "../storage/app-state.js";
import { loadManagedUsers } from "../storage/managed-users.js";
import {
  insertImportRunRecord,
  isPostgresStateEmpty,
  savePlatformStateToPostgres,
  writeSystemMetaValues,
  computeStateEntityCounts,
  updateImportRunRecord,
} from "../storage/postgres-state.js";
import { loadCurrentAgentRelease } from "../storage/releases.js";
import { closeDbClient } from "./client.js";
import { currentImportToolVersion, currentSchemaVersion, systemMetaKeys } from "./constants.js";
import type { AppState, UserRecord } from "../types.js";

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildSourceHashes(paths: string[]): { source_hashes: Record<string, string | null>; combined_hash: string } {
  const entries = paths
    .map((filePath) => [filePath, sha256File(filePath)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const combined = createHash("sha256");
  for (const [filePath, hash] of entries) {
    combined.update(`${filePath}:${hash ?? "missing"}\n`);
  }
  return {
    source_hashes: Object.fromEntries(entries),
    combined_hash: combined.digest("hex"),
  };
}

function inferImportedUserRole(userId: string): UserRecord["role"] {
  const normalized = userId.toLowerCase();
  if (normalized.includes("admin")) {
    return "admin";
  }
  if (normalized.includes("owner")) {
    return "owner";
  }
  return "member";
}

function nextImportedUsername(userId: string, existingUsernames: Set<string>): string {
  const normalizedId = userId.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
  const base = (`imported_${normalizedId}` || "imported_user").slice(0, 100);
  let candidate = base;
  let index = 1;
  while (existingUsernames.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
    index += 1;
  }
  existingUsernames.add(candidate);
  return candidate;
}

function collectReferencedUserIds(state: AppState): Set<string> {
  const userIds = new Set<string>();

  for (const agent of state.agents.values()) {
    userIds.add(agent.ownerUserId);
  }
  for (const project of state.projects.values()) {
    userIds.add(project.ownerUserId);
    for (const participantUserId of project.participantUserIds) {
      userIds.add(participantUserId);
    }
  }
  for (const task of state.tasks.values()) {
    userIds.add(task.senderUserId);
    userIds.add(task.assigneeUserId);
  }
  for (const item of state.checklist.values()) {
    if (item.completedBy) {
      userIds.add(item.completedBy);
    }
  }
  for (const file of state.fileObjects.values()) {
    if (file.allowedUploader === "user") {
      userIds.add(file.createdById);
    }
  }
  for (const conversation of state.conversations.values()) {
    userIds.add(conversation.ownerUserId);
  }
  for (const message of state.conversationMessages.values()) {
    userIds.add(message.ownerUserId);
    if (message.sourceUserId) {
      userIds.add(message.sourceUserId);
    }
    if (message.targetUserId) {
      userIds.add(message.targetUserId);
    }
  }
  for (const release of state.agentReleases.values()) {
    userIds.add(release.publishedByUserId);
  }

  return userIds;
}

function ensureHistoricalUsersExist(state: AppState): number {
  const existingUsernames = new Set([...state.users.values()].map((user) => user.username));
  const timestamp = new Date().toISOString();
  let createdCount = 0;

  for (const userId of [...collectReferencedUserIds(state)].sort()) {
    if (state.users.has(userId)) {
      continue;
    }

    storeUser(state, {
      userId,
      username: nextImportedUsername(userId, existingUsernames),
      passwordHash: hashSync(`imported-placeholder:${userId}`, 10),
      role: inferImportedUserRole(userId),
      displayName: `Imported historical user (${userId})`,
      status: "disabled",
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: timestamp,
    });
    createdCount += 1;
  }

  return createdCount;
}

function fallbackOwnerUserId(state: AppState): string {
  return state.users.get("user_admin")?.userId
    ?? [...state.users.values()].find((user) => !user.deletedAt)?.userId
    ?? [...state.users.values()][0]?.userId
    ?? "user_admin";
}

function buildImportedProjectCode(projectId: string): string {
  return `IMPORTED-${projectId.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(-12) || "PROJECT"}`;
}

function ensureHistoricalProjectsExist(state: AppState): number {
  const referencedProjectIds = new Set<string>();
  const defaultOwnerUserId = fallbackOwnerUserId(state);
  let createdCount = 0;

  for (const workflow of state.workflows.values()) {
    referencedProjectIds.add(workflow.projectId);
  }
  for (const task of state.tasks.values()) {
    referencedProjectIds.add(task.projectId);
  }
  for (const file of state.fileObjects.values()) {
    if (file.project_id) {
      referencedProjectIds.add(file.project_id);
    }
  }
  for (const event of state.events.values()) {
    if (event.project_id) {
      referencedProjectIds.add(event.project_id);
    }
  }

  for (const projectId of [...referencedProjectIds].sort()) {
    if (state.projects.has(projectId)) {
      continue;
    }

    const relatedTasks = [...state.tasks.values()].filter((task) => task.projectId === projectId);
    const ownerUserId = relatedTasks[0]?.senderUserId ?? defaultOwnerUserId;
    const participantUserIds = [...new Set([
      ownerUserId,
      ...relatedTasks.flatMap((task) => [task.senderUserId, task.assigneeUserId]),
    ])];
    const createdAt = relatedTasks[0]?.createdAt ?? new Date().toISOString();

    state.projects.set(projectId, {
      projectId,
      projectCode: buildImportedProjectCode(projectId),
      projectName: `Imported historical project (${projectId})`,
      description: "Imported placeholder project created during PostgreSQL cutover.",
      department: "imported",
      ownerUserId,
      participantUserIds,
      projectType: "imported",
      status: "paused",
      priority: "P2",
      currentStage: "Imported history",
      completionRate: 0,
      attachmentManifest: [],
      createdAt,
      updatedAt: createdAt,
    });
    createdCount += 1;
  }

  return createdCount;
}

function ensureHistoricalWorkflowTemplatesExist(state: AppState): number {
  const referencedTemplateIds = new Set<string>();
  let createdCount = 0;

  for (const workflow of state.workflows.values()) {
    referencedTemplateIds.add(workflow.workflowTemplateId);
  }
  for (const task of state.tasks.values()) {
    if (task.workflowTemplateId) {
      referencedTemplateIds.add(task.workflowTemplateId);
    }
  }

  for (const workflowTemplateId of [...referencedTemplateIds].sort()) {
    if (state.workflowTemplates.has(workflowTemplateId)) {
      continue;
    }

    const relatedTasks = [...state.tasks.values()].filter((task) => task.workflowTemplateId === workflowTemplateId);
    const stepIds = [...new Set(relatedTasks.map((task) => task.stepId).filter(Boolean))];
    const steps = (stepIds.length > 0 ? stepIds : ["step_imported"]).map((stepId, index) => ({
      step_id: stepId,
      step_code: stepId,
      step_name: stepId,
      step_order: index + 1,
      owner_role: "member",
      sla_minutes: 60,
    }));

    const template: WorkflowTemplate = {
      workflow_template_id: workflowTemplateId,
      workflow_name: `Imported workflow template (${workflowTemplateId})`,
      workflow_type: "imported",
      template_version: relatedTasks[0]?.templateVersion ?? 1,
      is_active: false,
      steps,
    };

    state.workflowTemplates.set(workflowTemplateId, template);
    createdCount += 1;
  }

  return createdCount;
}

function ensureHistoricalWorkflowsExist(state: AppState): number {
  const referencedWorkflowIds = new Set<string>();
  let createdCount = 0;

  for (const task of state.tasks.values()) {
    referencedWorkflowIds.add(task.workflowId);
  }
  for (const event of state.events.values()) {
    if (event.workflow_id) {
      referencedWorkflowIds.add(event.workflow_id);
    }
  }

  for (const workflowId of [...referencedWorkflowIds].sort()) {
    if (state.workflows.has(workflowId)) {
      continue;
    }

    const relatedTasks = [...state.tasks.values()].filter((task) => task.workflowId === workflowId);
    const relatedEvents = [...state.events.values()].filter((event) => event.workflow_id === workflowId);
    const projectId = relatedTasks[0]?.projectId
      ?? relatedEvents[0]?.project_id
      ?? [...state.projects.keys()][0]
      ?? "proj_imported_default";
    const workflowTemplateId = relatedTasks[0]?.workflowTemplateId ?? `wf_tmpl_imported_${workflowId}`;

    if (!state.workflowTemplates.has(workflowTemplateId)) {
      state.workflowTemplates.set(workflowTemplateId, {
        workflow_template_id: workflowTemplateId,
        workflow_name: `Imported workflow template (${workflowTemplateId})`,
        workflow_type: "imported",
        template_version: relatedTasks[0]?.templateVersion ?? 1,
        is_active: false,
        steps: [
          {
            step_id: relatedTasks[0]?.stepId ?? "step_imported",
            step_code: relatedTasks[0]?.stepId ?? "step_imported",
            step_name: relatedTasks[0]?.stepId ?? "step_imported",
            step_order: 1,
            owner_role: "member",
            sla_minutes: 60,
          },
        ],
      });
    }

    state.workflows.set(workflowId, {
      workflowId,
      projectId,
      workflowTemplateId,
      templateVersion: relatedTasks[0]?.templateVersion ?? 1,
      workflowName: `Imported workflow (${workflowId})`,
      workflowType: relatedTasks[0]?.taskType ?? "imported",
      status: relatedTasks[0]?.status ?? "received",
      ...(relatedTasks[0]?.stepId ? { currentStepId: relatedTasks[0].stepId } : {}),
      createdAt: relatedTasks[0]?.createdAt ?? new Date().toISOString(),
      updatedAt: relatedTasks[0]?.updatedAt ?? relatedTasks[0]?.createdAt ?? new Date().toISOString(),
    });
    createdCount += 1;
  }

  return createdCount;
}

async function main(): Promise<void> {
  const config = readPlatformApiConfig();
  if (config.storageMode !== "postgres") {
    throw new Error("db:import-current-state requires STORAGE_MODE=postgres");
  }

  if (!(await isPostgresStateEmpty(config))) {
    throw new Error("Target PostgreSQL database is not empty. Rebuild an empty database before importing.");
  }

  const state = createAppState({ seedMode: "empty" });
  const managedUsers = loadManagedUsers(config);
  for (const user of managedUsers) {
    storeUser(state, user);
  }

  const snapshot = loadPlatformStateSnapshot(config);
  const mergedUsers = new Map(state.users);
  for (const user of snapshot?.users ?? []) {
    if (!mergedUsers.has(user.userId)) {
      mergedUsers.set(user.userId, user);
    }
  }

  if (snapshot) {
    for (const user of mergedUsers.values()) {
      storeUser(state, user);
    }
    for (const agent of snapshot.agents) {
      state.agents.set(agent.agentId, agent);
    }
    for (const project of snapshot.projects) {
      state.projects.set(project.projectId, project);
    }
    for (const template of snapshot.workflowTemplates) {
      state.workflowTemplates.set(template.workflow_template_id, template);
    }
    for (const workflow of snapshot.workflows) {
      state.workflows.set(workflow.workflowId, workflow);
    }
    for (const task of snapshot.tasks) {
      state.tasks.set(task.taskId, task);
    }
    for (const item of snapshot.checklist) {
      state.checklist.set(item.checklistItemId, item);
      const ids = state.taskChecklistIndex.get(item.taskId) ?? [];
      ids.push(item.checklistItemId);
      state.taskChecklistIndex.set(item.taskId, ids);
    }
    for (const event of snapshot.events) {
      state.events.set(event.eventId, event);
      if (event.task_id) {
        const ids = state.taskEventIndex.get(event.task_id) ?? [];
        ids.push(event.eventId);
        state.taskEventIndex.set(event.task_id, ids);
      }
    }
    for (const file of snapshot.fileObjects) {
      state.fileObjects.set(file.file_id, file);
    }
    for (const heartbeat of snapshot.heartbeats) {
      state.heartbeats.set(heartbeat.agentId, heartbeat);
    }
    for (const conversation of snapshot.conversations) {
      state.conversations.set(conversation.conversationId, conversation);
    }
    for (const message of snapshot.conversationMessages) {
      state.conversationMessages.set(message.messageId, message);
      const ids = state.conversationMessageIndex.get(message.conversationId) ?? [];
      ids.push(message.messageId);
      state.conversationMessageIndex.set(message.conversationId, ids);
    }
  }

  const currentRelease = loadCurrentAgentRelease(config);
  if (currentRelease) {
    state.currentAgentRelease = currentRelease;
    state.agentReleases.set(currentRelease.version, currentRelease);
  }

  const importedHistoricalUsersCount = ensureHistoricalUsersExist(state);
  const importedHistoricalProjectsCount = ensureHistoricalProjectsExist(state);
  const importedHistoricalWorkflowTemplatesCount = ensureHistoricalWorkflowTemplatesExist(state);
  const importedHistoricalWorkflowsCount = ensureHistoricalWorkflowsExist(state);

  const counts = computeStateEntityCounts(state);
  const sourceHashes = buildSourceHashes([
    config.managedUsersFile,
    config.stateSnapshotFile,
    path.join(config.storageRoot, "releases", "agents", "current.json"),
  ]);
  const importRunId = `imprun_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const managedUsersImportedCount = managedUsers.length;
  const platformStateImportedCount = snapshot
    ? snapshot.agents.length
      + snapshot.projects.length
      + snapshot.workflowTemplates.length
      + snapshot.workflows.length
      + snapshot.tasks.length
      + snapshot.checklist.length
      + snapshot.events.length
      + snapshot.fileObjects.length
      + snapshot.heartbeats.length
      + snapshot.conversations.length
      + snapshot.conversationMessages.length
    : 0;
  const agentSqliteRecoveredCount = Number(process.env.IMPORT_AGENT_SQLITE_RECOVERED_COUNT ?? 0);

  await insertImportRunRecord(config, {
    importRunId,
    schemaVersion: currentSchemaVersion,
    toolVersion: currentImportToolVersion,
    sourceHashesJson: sourceHashes,
    countsJson: counts,
    verificationJson: {},
    managedUsersImportedCount,
    platformStateImportedCount,
    agentSqliteRecoveredCount,
    status: "running",
    startedAt: new Date(startedAt),
    completedAt: null,
  });

  try {
    await savePlatformStateToPostgres(config, state);
    const completedAt = new Date().toISOString();
    await writeSystemMetaValues(config, {
      [systemMetaKeys.schemaVersion]: currentSchemaVersion,
      [systemMetaKeys.storageMode]: "postgres",
      [systemMetaKeys.initialImportCompletedAt]: completedAt,
      [systemMetaKeys.initialImportSourceStateHash]: sourceHashes.combined_hash,
      [systemMetaKeys.initialImportToolVersion]: currentImportToolVersion,
      [systemMetaKeys.cutoverCompletedAt]: completedAt,
      [systemMetaKeys.lastImportCounts]: counts,
      [systemMetaKeys.lastCutoverStatus]: "completed",
    });
    await updateImportRunRecord(config, importRunId, {
      status: "completed",
      completedAt: new Date(completedAt),
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          import_run_id: importRunId,
          counts,
          source_hash: sourceHashes.combined_hash,
          imported_historical_users_count: importedHistoricalUsersCount,
          imported_historical_projects_count: importedHistoricalProjectsCount,
          imported_historical_workflow_templates_count: importedHistoricalWorkflowTemplatesCount,
          imported_historical_workflows_count: importedHistoricalWorkflowsCount,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await updateImportRunRecord(config, importRunId, {
      status: "failed",
      completedAt: new Date(),
    });
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbClient();
  });
