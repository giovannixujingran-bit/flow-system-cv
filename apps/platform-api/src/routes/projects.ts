import { z } from "zod";

import { projectUpdateRequestSchema, type ProjectUpdateRequest } from "@flow-system/flow-protocol";

import type { PlatformRuntime } from "../context.js";
import { PROJECT_DEPARTMENT_OPTIONS, PROJECT_PRIORITY_OPTIONS, PROJECT_STATUS_OPTIONS, PROJECT_TYPE_OPTIONS, createProjectRecord, listProjectOwners, listProjectParticipants, projectStatusLabel, serializeProject } from "../domain/projects.js";
import { requireUserRead, requireUserWrite } from "../http.js";
import { attachFilesToProject, canManageProject, deleteProjectState, ensureFileReady, withIdempotency } from "../runtime.js";
import type { AppState, ProjectRecord } from "../types.js";

const projectCreateSchema = z.object({
  request_id: z.string().min(5).max(128),
  project_name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  department: z.string().min(1).max(64),
  start_date: z.string().datetime({ offset: true }).optional(),
  due_date: z.string().datetime({ offset: true }).optional(),
  participant_user_ids: z.array(z.string().min(5).max(128)).min(1),
  owner_user_id: z.string().min(5).max(128),
  project_type: z.string().min(1).max(64),
  priority: z.string().min(2).max(2),
  status: z.string().min(3).max(32),
  attachment_file_ids: z.array(z.string().min(5).max(128)).default([]),
});

const departmentValues = new Set(PROJECT_DEPARTMENT_OPTIONS.map((option) => option.value));
const projectTypeValues = new Set(PROJECT_TYPE_OPTIONS.map((option) => option.value));
const projectPriorityValues = new Set(PROJECT_PRIORITY_OPTIONS.map((option) => option.value));
const projectStatusValues = new Set(PROJECT_STATUS_OPTIONS.map((option) => option.value));

function isKnownValue(value: string, values: Set<string>): boolean {
  return values.has(value);
}

function activeParticipantIds(state: AppState): Set<string> {
  return new Set(listProjectParticipants(state).map((user) => user.userId));
}

function activeOwnerIds(state: AppState): Set<string> {
  return new Set(listProjectOwners(state).map((user) => user.userId));
}

function isProjectUpdateBodyEmpty(body: ProjectUpdateRequest): boolean {
  return Object.entries(body).every(([key, value]) => ["request_id", "project_id"].includes(key) || value === undefined);
}

type ProjectUpdatePlan = {
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
  currentStage: string;
  completionRate: number;
  updatedFields: Record<string, unknown>;
};

function buildProjectUpdatePlan(
  state: AppState,
  project: ProjectRecord,
  body: ProjectUpdateRequest,
): { ok: true; plan: ProjectUpdatePlan } | { ok: false; status: number; error: string } {
  const department = body.department ?? project.department;
  if (!isKnownValue(department, departmentValues)) {
    return { ok: false, status: 400, error: "Invalid project department" };
  }

  const projectType = body.project_type ?? project.projectType;
  if (!isKnownValue(projectType, projectTypeValues)) {
    return { ok: false, status: 400, error: "Invalid project type" };
  }

  const priority = body.priority ?? project.priority;
  if (!isKnownValue(priority, projectPriorityValues)) {
    return { ok: false, status: 400, error: "Invalid project priority" };
  }

  const status = body.status ?? project.status;
  if (!isKnownValue(status, projectStatusValues)) {
    return { ok: false, status: 400, error: "Invalid project status" };
  }

  const ownerUserId = body.owner_user_id ?? project.ownerUserId;
  if (!activeOwnerIds(state).has(ownerUserId)) {
    return { ok: false, status: 400, error: "Project owner must be an active admin or owner" };
  }

  const participantIds = [...new Set([...(body.participant_user_ids ?? project.participantUserIds), ownerUserId])];
  const allowedParticipantIds = activeParticipantIds(state);
  if (participantIds.some((userId) => !allowedParticipantIds.has(userId))) {
    return { ok: false, status: 400, error: "Project participants contain an unknown or disabled user" };
  }

  const startDate = body.start_date ?? project.startDate;
  const dueDate = body.due_date ?? project.dueDate;
  if (startDate && dueDate && startDate > dueDate) {
    return { ok: false, status: 400, error: "Expected due date must be after the start date" };
  }

  return {
    ok: true,
    plan: {
      projectName: body.project_name ?? project.projectName,
      description: body.description ?? project.description,
      department,
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      participantUserIds: participantIds,
      ownerUserId,
      projectType,
      priority,
      status,
      currentStage: projectStatusLabel(status),
      completionRate: status === "done" ? 100 : project.status === "done" ? 0 : project.completionRate,
      updatedFields: Object.fromEntries(
        Object.entries({
          ...(body.project_name !== undefined ? { project_name: body.project_name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.department !== undefined ? { department } : {}),
          ...(body.start_date !== undefined ? { start_date: startDate } : {}),
          ...(body.due_date !== undefined ? { due_date: dueDate } : {}),
          ...(body.participant_user_ids !== undefined ? { participant_user_ids: participantIds } : {}),
          ...(body.owner_user_id !== undefined ? { owner_user_id: ownerUserId } : {}),
          ...(body.project_type !== undefined ? { project_type: projectType } : {}),
          ...(body.priority !== undefined ? { priority } : {}),
          ...(body.status !== undefined ? { status } : {}),
        }).filter(([, value]) => value !== undefined),
      ),
    },
  };
}

export function registerProjectRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.get("/api/v1/project-create-options", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }

    return {
      departments: PROJECT_DEPARTMENT_OPTIONS,
      project_types: PROJECT_TYPE_OPTIONS,
      priorities: PROJECT_PRIORITY_OPTIONS,
      statuses: PROJECT_STATUS_OPTIONS,
      owners: listProjectOwners(state).map((user) => ({
        user_id: user.userId,
        display_name: user.displayName,
        role: user.role,
      })),
      participants: listProjectParticipants(state).map((user) => ({
        user_id: user.userId,
        display_name: user.displayName,
        role: user.role,
      })),
    };
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }

    const body = projectCreateSchema.parse(request.body ?? {});
    if (!isKnownValue(body.department, departmentValues)) {
      return reply.code(400).send({ error: "Invalid project department" });
    }
    if (!isKnownValue(body.project_type, projectTypeValues)) {
      return reply.code(400).send({ error: "Invalid project type" });
    }
    if (!isKnownValue(body.priority, projectPriorityValues)) {
      return reply.code(400).send({ error: "Invalid project priority" });
    }
    if (!isKnownValue(body.status, projectStatusValues)) {
      return reply.code(400).send({ error: "Invalid project status" });
    }

    const allowedOwnerIds = new Set(listProjectOwners(state).map((user) => user.userId));
    if (!allowedOwnerIds.has(body.owner_user_id)) {
      return reply.code(400).send({ error: "Project owner must be an active admin or owner" });
    }

    const participantIds = [...new Set(body.participant_user_ids)];
    const allowedParticipantIds = new Set(listProjectParticipants(state).map((user) => user.userId));
    if (participantIds.some((userId) => !allowedParticipantIds.has(userId))) {
      return reply.code(400).send({ error: "Project participants contain an unknown or disabled user" });
    }

    if (body.start_date && body.due_date && body.start_date > body.due_date) {
      return reply.code(400).send({ error: "Expected due date must be after the start date" });
    }

    const totalAttachmentBytes = body.attachment_file_ids
      .map((fileId) => ensureFileReady(state, fileId).size_bytes)
      .reduce((sum, value) => sum + value, 0);
    if (totalAttachmentBytes > config.maxTaskBytes) {
      return reply.code(400).send({ error: `Project attachment payload exceeds ${config.maxTaskBytes} bytes` });
    }

    const result = await withIdempotency(state, "POST:/api/v1/projects", context.user.userId, body.request_id, () => {
      const project = createProjectRecord(state, {
        projectName: body.project_name,
        description: body.description,
        department: body.department,
        ...(body.start_date ? { startDate: body.start_date } : {}),
        ...(body.due_date ? { dueDate: body.due_date } : {}),
        participantUserIds: participantIds,
        ownerUserId: body.owner_user_id,
        projectType: body.project_type,
        priority: body.priority,
        status: body.status,
        attachmentManifest: [],
      });

      project.attachmentManifest = attachFilesToProject(state, config, project.projectId, body.attachment_file_ids);
      project.updatedAt = new Date().toISOString();
      state.projects.set(project.projectId, project);

      return {
        project_id: project.projectId,
        project_code: project.projectCode,
      };
    });

    return reply.code(201).send(result);
  });

  app.patch("/api/v1/projects/:projectId", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { projectId: string };
    const project = state.projects.get(params.projectId);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    if (!canManageProject(context.user, project)) {
      return reply.code(403).send({ error: "Update permission denied" });
    }

    const body = projectUpdateRequestSchema.parse({
      ...(request.body as object),
      project_id: params.projectId,
    });
    if (isProjectUpdateBodyEmpty(body)) {
      return reply.code(400).send({ error: "At least one project field must be updated" });
    }

    const planResult = buildProjectUpdatePlan(state, project, body);
    if (!planResult.ok) {
      return reply.code(planResult.status).send({ error: planResult.error });
    }

    const result = await withIdempotency(state, `PATCH:/api/v1/projects/${params.projectId}`, context.user.userId, body.request_id, () => {
      project.projectName = planResult.plan.projectName;
      project.description = planResult.plan.description;
      project.department = planResult.plan.department;
      if (planResult.plan.startDate) {
        project.startDate = planResult.plan.startDate;
      } else {
        delete project.startDate;
      }
      if (planResult.plan.dueDate) {
        project.dueDate = planResult.plan.dueDate;
      } else {
        delete project.dueDate;
      }
      project.participantUserIds = planResult.plan.participantUserIds;
      project.ownerUserId = planResult.plan.ownerUserId;
      project.projectType = planResult.plan.projectType;
      project.priority = planResult.plan.priority;
      project.status = planResult.plan.status;
      project.currentStage = planResult.plan.currentStage;
      project.completionRate = planResult.plan.completionRate;
      project.updatedAt = new Date().toISOString();

      return serializeProject(state, project);
    });

    return result;
  });

  app.delete("/api/v1/projects/:projectId", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { projectId: string };
    const project = state.projects.get(params.projectId);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    if (!canManageProject(context.user, project)) {
      return reply.code(403).send({ error: "Delete permission denied" });
    }

    deleteProjectState(state, project.projectId);

    return {
      accepted: true,
      deleted_project_id: project.projectId,
    };
  });
}
