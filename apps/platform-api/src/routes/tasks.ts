import {
  actionRequestSchema,
  checklistUpdateSchema,
  eventEnvelopeSchema,
  makeId,
  openClawTaskProgressUpsertSchema,
  taskDeliveryRequestSchema,
  taskStatusUpdateSchema,
  taskUpdateRequestSchema,
  type TaskUpdateRequest,
} from "@flow-system/flow-protocol";

import type { PlatformRuntime } from "../context.js";
import { canReadTask, requireWriteContext, requireUserRead, requireUserWrite } from "../http.js";
import {
  createDefaultOpenClawTaskProgress,
  syncOpenClawTaskProgressFromTask,
  syncTaskStatusFromOpenClaw,
  upsertOpenClawTaskProgressFromPayload,
} from "../domain/openclaw-task-progress.js";
import {
  appendPlatformEvent,
  canManageProject,
  attachFilesToTask,
  canDeleteTask,
  deleteTaskState,
  ensureTaskFileReady,
  maybePromoteToInProgress,
  roleForTaskInState,
  serializeTask,
  transitionTaskStatus,
  withIdempotency,
} from "../runtime.js";
import {
  appendTaskChecklist,
  buildChecklistForTask,
  findActiveWorkflowTemplate,
  listTaskChecklist,
  listTaskResponsibles,
  preferredAgentForUser,
  storeTask,
  taskEvents,
} from "../state.js";
import type { AppState, EventRecord, TaskRecord, UserRecord } from "../types.js";

function eventTypeForStatus(status: TaskRecord["status"]): EventRecord["event_type"] {
  switch (status) {
    case "received":
      return "task.received";
    case "accepted":
      return "task.accepted";
    case "in_progress":
      return "task.started";
    case "waiting_review":
      return "task.submitted";
    case "done":
      return "task.completed";
    case "archived":
      return "task.archived";
    default:
      return "task.progress.updated";
  }
}

const managerOnlyTaskUpdateFields = new Set<keyof Omit<TaskUpdateRequest, "request_id" | "task_id">>([
  "assignee_user_id",
  "assignee_agent_id",
  "priority",
  "project_id",
  "workflow_id",
  "workflow_template_id",
  "template_version",
  "step_id",
  "task_type",
]);

type TaskUpdatePlan = {
  nextProjectId: string;
  nextWorkflowId: string;
  nextWorkflowTemplateId?: string;
  nextTemplateVersion?: number;
  nextStepId: string;
  nextAssigneeUserId: string;
  nextAssigneeAgentId: string;
  updatedFields: Record<string, unknown>;
};

function activeUserOrNull(state: AppState, userId: string): UserRecord | null {
  const user = state.users.get(userId);
  if (!user || user.deletedAt || (user.status ?? "active") !== "active") {
    return null;
  }
  return user;
}

function isTaskUpdateBodyEmpty(body: TaskUpdateRequest): boolean {
  return Object.entries(body).every(([key, value]) => ["request_id", "task_id"].includes(key) || value === undefined);
}

function buildTaskUpdatePlan(
  state: AppState,
  user: UserRecord,
  task: TaskRecord,
  body: TaskUpdateRequest,
): { ok: true; plan: TaskUpdatePlan } | { ok: false; status: number; error: string } {
  const role = roleForTaskInState(state, user, task);
  if (role === "member") {
    return { ok: false, status: 403, error: "Update permission denied" };
  }

  if (role === "assignee") {
    const managerField = Object.entries(body).find(([key, value]) => value !== undefined && managerOnlyTaskUpdateFields.has(key as keyof Omit<TaskUpdateRequest, "request_id" | "task_id">));
    if (managerField) {
      return { ok: false, status: 403, error: "Assignee can only update task content fields" };
    }
  }

  const nextProjectId = body.project_id ?? task.projectId;
  const nextProject = state.projects.get(nextProjectId);
  if (!nextProject) {
    return { ok: false, status: 400, error: "project_id could not be resolved" };
  }

  if (body.project_id && !canManageProject(user, nextProject)) {
    return { ok: false, status: 403, error: "Project reassignment permission denied" };
  }

  const nextWorkflowId = body.workflow_id ?? task.workflowId;
  const nextWorkflow = state.workflows.get(nextWorkflowId);
  if (!nextWorkflow) {
    return { ok: false, status: 400, error: "workflow_id could not be resolved" };
  }
  if (nextWorkflow.projectId !== nextProjectId) {
    return { ok: false, status: 400, error: "workflow_id must belong to the selected project" };
  }

  if (body.project_id && body.workflow_id === undefined) {
    const currentWorkflow = state.workflows.get(task.workflowId);
    if (!currentWorkflow || currentWorkflow.projectId !== nextProjectId) {
      return { ok: false, status: 400, error: "workflow_id must be provided when moving a task to another project" };
    }
  }

  if (body.workflow_template_id && !state.workflowTemplates.has(body.workflow_template_id)) {
    return { ok: false, status: 400, error: "workflow_template_id could not be resolved" };
  }

  let nextAssigneeUserId = task.assigneeUserId;
  let nextAssigneeAgentId = task.assigneeAgentId;

  const resolvedAssigneeUser = body.assignee_user_id ? activeUserOrNull(state, body.assignee_user_id) : undefined;
  if (body.assignee_user_id && !resolvedAssigneeUser) {
    return { ok: false, status: 400, error: "assignee_user_id could not be resolved to an active user" };
  }

  const resolvedAssigneeAgent = body.assignee_agent_id ? state.agents.get(body.assignee_agent_id) : undefined;
  if (body.assignee_agent_id && !resolvedAssigneeAgent) {
    return { ok: false, status: 400, error: "assignee_agent_id could not be resolved" };
  }

  if (body.assignee_user_id && body.assignee_agent_id) {
    const assigneeUser = resolvedAssigneeUser;
    const assigneeAgent = resolvedAssigneeAgent;
    if (!assigneeUser || !assigneeAgent) {
      return { ok: false, status: 400, error: "Assignee update could not be resolved" };
    }
    if (assigneeAgent.ownerUserId !== assigneeUser.userId) {
      return { ok: false, status: 400, error: "assignee_agent_id must belong to assignee_user_id" };
    }
    nextAssigneeUserId = assigneeUser.userId;
    nextAssigneeAgentId = assigneeAgent.agentId;
  } else if (body.assignee_user_id) {
    const assigneeUser = resolvedAssigneeUser;
    if (!assigneeUser) {
      return { ok: false, status: 400, error: "assignee_user_id could not be resolved to an active user" };
    }
    const preferredAgent = preferredAgentForUser(state, assigneeUser.userId);
    if (!preferredAgent) {
      return { ok: false, status: 400, error: "assignee_user_id has no registered agent" };
    }
    nextAssigneeUserId = assigneeUser.userId;
    nextAssigneeAgentId = preferredAgent.agentId;
  } else if (body.assignee_agent_id) {
    const assigneeAgent = resolvedAssigneeAgent;
    if (!assigneeAgent) {
      return { ok: false, status: 400, error: "assignee_agent_id could not be resolved" };
    }
    const assigneeUser = activeUserOrNull(state, assigneeAgent.ownerUserId);
    if (!assigneeUser) {
      return { ok: false, status: 400, error: "assignee_agent_id owner is not an active user" };
    }
    nextAssigneeUserId = assigneeUser.userId;
    nextAssigneeAgentId = assigneeAgent.agentId;
  }

  let nextWorkflowTemplateId = body.workflow_template_id ?? task.workflowTemplateId;
  let nextTemplateVersion = body.template_version ?? task.templateVersion;
  if (body.workflow_id) {
    nextWorkflowTemplateId = body.workflow_template_id ?? nextWorkflow.workflowTemplateId;
    nextTemplateVersion = body.template_version ?? nextWorkflow.templateVersion;
  }

  const nextStepId = body.step_id ?? task.stepId;
  const updatedFields = Object.fromEntries(
    Object.entries({
      ...(body.project_id !== undefined ? { project_id: nextProjectId } : {}),
      ...(body.workflow_id !== undefined ? { workflow_id: nextWorkflowId } : {}),
      ...(nextWorkflowTemplateId !== task.workflowTemplateId ? { workflow_template_id: nextWorkflowTemplateId } : {}),
      ...(nextTemplateVersion !== task.templateVersion ? { template_version: nextTemplateVersion } : {}),
      ...(body.step_id !== undefined ? { step_id: nextStepId } : {}),
      ...(body.task_title !== undefined ? { task_title: body.task_title } : {}),
      ...(body.task_type !== undefined ? { task_type: body.task_type } : {}),
      ...(body.assignee_user_id !== undefined ? { assignee_user_id: nextAssigneeUserId } : {}),
      ...(body.assignee_agent_id !== undefined || body.assignee_user_id !== undefined ? { assignee_agent_id: nextAssigneeAgentId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.constraints !== undefined ? { constraints: body.constraints } : {}),
      ...(body.deliverables !== undefined ? { deliverables: body.deliverables } : {}),
    }).filter(([, value]) => value !== undefined),
  );

  return {
    ok: true,
    plan: {
      nextProjectId,
      nextWorkflowId,
      ...(nextWorkflowTemplateId !== undefined ? { nextWorkflowTemplateId } : {}),
      ...(nextTemplateVersion !== undefined ? { nextTemplateVersion } : {}),
      nextStepId,
      nextAssigneeUserId,
      nextAssigneeAgentId,
      updatedFields,
    },
  };
}

export function registerTaskRoutes(runtime: PlatformRuntime): void {
  const { app, state, config, scanRisks } = runtime;

  app.get("/api/v1/task-create-options", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }

    return {
      responsibles: listTaskResponsibles(state).map(({ user, agent }) => ({
        user_id: user.userId,
        display_name: user.displayName,
        role: user.role,
        preferred_agent_id: agent.agentId,
        agent_status: agent.status,
      })),
    };
  });

  app.post("/api/v1/task-deliveries", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }
    const delivery = taskDeliveryRequestSchema.parse(request.body ?? {});
    const result = await withIdempotency(state, "POST:/api/v1/task-deliveries", context.user.userId, delivery.request_id, () => {
      const agent = state.agents.get(delivery.target_agent_id);
      const sender = state.users.get(delivery.sender_user_id);
      const assignee = state.users.get(delivery.target_user_id);
      if (!agent) {
        throw new Error("target_agent_id could not be resolved");
      }
      if (!sender || sender.deletedAt || (sender.status ?? "active") !== "active") {
        throw new Error("sender_user_id could not be resolved to an active user");
      }
      if (!assignee || assignee.deletedAt || (assignee.status ?? "active") !== "active") {
        throw new Error("target_user_id could not be resolved to an active user");
      }
      const totalBytes = delivery.attachment_file_ids
        .map((fileId) => ensureTaskFileReady(state, fileId).size_bytes)
        .reduce((sum, value) => sum + value, 0);
      if (totalBytes > config.maxTaskBytes) {
        throw new Error(`Task attachment payload exceeds ${config.maxTaskBytes} bytes`);
      }

      const template = findActiveWorkflowTemplate(state, delivery.workflow_template_id);
      const workflowTemplateId = template?.workflow_template_id ?? delivery.workflow_template_id;
      const templateVersion = template?.template_version ?? delivery.template_version;
      const taskId = makeId("task");
      const createdAt = new Date().toISOString();
      const attachmentManifest = attachFilesToTask(state, config, taskId, delivery.attachment_file_ids);
      const baseTask: TaskRecord = {
        taskId,
        requestId: delivery.request_id,
        projectId: delivery.project_id,
        workflowId: delivery.workflow_id,
        stepId: delivery.step_id,
        taskTitle: delivery.task_title,
        taskType: delivery.task_type,
        senderUserId: delivery.sender_user_id,
        assigneeUserId: delivery.target_user_id,
        assigneeAgentId: delivery.target_agent_id,
        priority: delivery.priority,
        status: "delivered",
        progressPercent: 0,
        summary: delivery.summary,
        constraints: delivery.constraints,
        deliverables: delivery.deliverables,
        deadline: delivery.deadline,
        lastEventAt: createdAt,
        riskLevel: "none",
        attachmentManifest,
        createdAt,
        updatedAt: createdAt,
      };
      const task: TaskRecord = workflowTemplateId === undefined && templateVersion === undefined
        ? baseTask
        : {
            ...baseTask,
            ...(workflowTemplateId !== undefined ? { workflowTemplateId } : {}),
            ...(templateVersion !== undefined ? { templateVersion } : {}),
      };
      storeTask(state, task);
      appendTaskChecklist(state, taskId, buildChecklistForTask(taskId, delivery, template));
      createDefaultOpenClawTaskProgress(state, task, {
        decisionSummary: "任务已创建，等待 OpenClaw 或负责人继续推进。",
        currentStatusLabel: "已创建",
      });
      appendPlatformEvent(state, {
        request_id: delivery.request_id,
        event_type: "task.created",
        task_id: taskId,
        project_id: task.projectId,
        workflow_id: task.workflowId,
        actor_type: "user",
        actor_id: context.user.userId,
        payload: { attachment_file_ids: delivery.attachment_file_ids },
        occurred_at: createdAt,
      });
      appendPlatformEvent(state, {
        request_id: makeId("req"),
        event_type: "task.delivered",
        task_id: taskId,
        project_id: task.projectId,
        workflow_id: task.workflowId,
        actor_type: "system",
        actor_id: "system_router",
        source_agent_id: delivery.target_agent_id,
        payload: { target_agent_id: agent.agentId },
        occurred_at: createdAt,
      });
      return {
        task_id: task.taskId,
        delivery_status: "delivered",
        target_agent_id: task.assigneeAgentId,
      };
    });

    return result;
  });

  app.get("/api/v1/tasks", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    scanRisks();
    const query = request.query as Record<string, string | undefined>;
    let tasks = [...state.tasks.values()];
    if (query.project_id) {
      tasks = tasks.filter((task) => task.projectId === query.project_id);
    }
    if (query.status) {
      tasks = tasks.filter((task) => task.status === query.status);
    }
    if (query.assignee_user_id) {
      tasks = tasks.filter((task) => task.assigneeUserId === query.assignee_user_id);
    }
    if (query.agent_id) {
      tasks = tasks.filter((task) => task.assigneeAgentId === query.agent_id);
    }
    if (query.risk_level) {
      tasks = tasks.filter((task) => task.riskLevel === query.risk_level);
    }
    return tasks.map((task) => serializeTask(state, task));
  });

  app.get("/api/v1/tasks/:taskId", async (request, reply) => {
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (!canReadTask(request, state, task)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    scanRisks();
    return serializeTask(state, task);
  });

  app.patch("/api/v1/tasks/:taskId", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const body = taskUpdateRequestSchema.parse({
      ...(request.body as object),
      task_id: params.taskId,
    });
    if (isTaskUpdateBodyEmpty(body)) {
      return reply.code(400).send({ error: "At least one task field must be updated" });
    }

    const planResult = buildTaskUpdatePlan(state, context.user, task, body);
    if (!planResult.ok) {
      return reply.code(planResult.status).send({ error: planResult.error });
    }

    const occurredAt = new Date().toISOString();
    const result = await withIdempotency(state, `PATCH:/api/v1/tasks/${params.taskId}`, context.user.userId, body.request_id, () => {
      task.projectId = planResult.plan.nextProjectId;
      task.workflowId = planResult.plan.nextWorkflowId;
      if (planResult.plan.nextWorkflowTemplateId !== undefined) {
        task.workflowTemplateId = planResult.plan.nextWorkflowTemplateId;
      } else {
        delete task.workflowTemplateId;
      }
      if (planResult.plan.nextTemplateVersion !== undefined) {
        task.templateVersion = planResult.plan.nextTemplateVersion;
      } else {
        delete task.templateVersion;
      }
      task.stepId = planResult.plan.nextStepId;
      task.assigneeUserId = planResult.plan.nextAssigneeUserId;
      task.assigneeAgentId = planResult.plan.nextAssigneeAgentId;
      if (body.task_title !== undefined) {
        task.taskTitle = body.task_title;
      }
      if (body.task_type !== undefined) {
        task.taskType = body.task_type;
      }
      if (body.priority !== undefined) {
        task.priority = body.priority;
      }
      if (body.deadline !== undefined) {
        task.deadline = body.deadline;
      }
      if (body.summary !== undefined) {
        task.summary = body.summary;
      }
      if (body.constraints !== undefined) {
        task.constraints = body.constraints;
      }
      if (body.deliverables !== undefined) {
        task.deliverables = body.deliverables;
      }
      task.updatedAt = occurredAt;
      task.lastEventAt = occurredAt;

      appendPlatformEvent(state, {
        request_id: body.request_id,
        event_type: "task.progress.updated",
        task_id: task.taskId,
        project_id: task.projectId,
        workflow_id: task.workflowId,
        actor_type: "user",
        actor_id: context.user.userId,
        payload: {
          updated_fields: planResult.plan.updatedFields,
        },
        occurred_at: occurredAt,
      });
      const syncOptions: Parameters<typeof syncOpenClawTaskProgressFromTask>[2] = {
        forceCreate: true,
        decisionSummary: "任务信息已更新，任务卡片步骤已同步刷新。",
        occurredAt,
      };
      const currentStatusLabel = task.status === "done" ? "已完成" : task.status === "in_progress" ? "进行中" : undefined;
      if (currentStatusLabel) {
        syncOptions.currentStatusLabel = currentStatusLabel;
      }
      syncOpenClawTaskProgressFromTask(state, task, syncOptions);

      return serializeTask(state, task);
    });
    return result;
  });

  app.patch("/api/v1/tasks/:taskId/status", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Task is not assigned to this agent" });
    }
    const body = taskStatusUpdateSchema.parse(request.body ?? {});
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    const role = context.kind === "user" ? roleForTaskInState(state, context.user, task) : "assignee";
    const result = await withIdempotency(state, `PATCH:/api/v1/tasks/${params.taskId}/status`, actorId, body.request_id, () => {
      transitionTaskStatus(task, body.status, role, body.occurred_at);
      syncOpenClawTaskProgressFromTask(state, task, {
        forceCreate: true,
        decisionSummary: `任务状态已更新为 ${body.status}。`,
        occurredAt: body.occurred_at,
      });
      appendPlatformEvent(state, {
        request_id: body.request_id,
        event_type: eventTypeForStatus(body.status),
        task_id: task.taskId,
        project_id: task.projectId,
        workflow_id: task.workflowId,
        actor_type: context.kind === "user" ? "user" : "agent",
        actor_id: actorId,
        source_agent_id: context.kind === "agent" ? context.agent.agentId : undefined,
        payload: {
          current_step: body.current_step,
          message: body.message,
          status: body.status,
        },
        occurred_at: body.occurred_at,
      });
      return serializeTask(state, task);
    });
    return result;
  });

  app.post("/api/v1/tasks/:taskId/openclaw-progress", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    if (context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Task is not assigned to this agent" });
    }
    if (context.kind === "user") {
      const role = roleForTaskInState(state, context.user, task);
      if (role !== "admin" && role !== "owner" && role !== "assignee") {
        return reply.code(403).send({ error: "OpenClaw progress update denied" });
      }
    }

    const body = openClawTaskProgressUpsertSchema.parse({
      ...(request.body as object),
      task_id: params.taskId,
    });
    if (body.active_step_index > body.steps.length) {
      return reply.code(400).send({ error: "active_step_index must reference an existing step" });
    }

    const occurredAt = new Date().toISOString();
    const actorId = context.kind === "agent" ? context.agent.agentId : context.user.userId;
    const result = await withIdempotency(
      state,
      `POST:/api/v1/tasks/${params.taskId}/openclaw-progress`,
      actorId,
      body.request_id,
      () => {
        const progress = upsertOpenClawTaskProgressFromPayload(state, task, body);
        if (body.sync_task_status) {
          syncTaskStatusFromOpenClaw(task, body.sync_task_status, occurredAt);
        }
        appendPlatformEvent(state, {
          request_id: body.request_id,
          event_type: "task.progress.updated",
          task_id: task.taskId,
          project_id: task.projectId,
          workflow_id: task.workflowId,
          actor_type: context.kind === "agent" ? "agent" : "user",
          actor_id: actorId,
          source_agent_id: context.kind === "agent" ? context.agent.agentId : undefined,
          payload: {
            source: "openclaw_progress",
            active_step_index: progress.activeStepIndex,
            current_status_label: progress.currentStatusLabel,
            decision_summary: progress.lastDecisionSummary,
          },
          occurred_at: occurredAt,
        });
        return serializeTask(state, task);
      },
    );

    return result;
  });

  app.get("/api/v1/tasks/:taskId/checklist", async (request, reply) => {
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (!canReadTask(request, state, task)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return listTaskChecklist(state, task.taskId);
  });

  app.patch("/api/v1/tasks/:taskId/checklist/:itemId", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { taskId: string; itemId: string };
    const task = state.tasks.get(params.taskId);
    const item = state.checklist.get(params.itemId);
    if (!task || !item || item.taskId !== task.taskId) {
      return reply.code(404).send({ error: "Checklist item not found" });
    }
    if (context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Task is not assigned to this agent" });
    }
    const body = checklistUpdateSchema.parse({
      ...(request.body as object),
      task_id: params.taskId,
      checklist_item_id: params.itemId,
    });
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    const result = await withIdempotency(state, `PATCH:/api/v1/tasks/${params.taskId}/checklist/${params.itemId}`, actorId, body.request_id, () => {
      item.status = body.status;
      item.updatedAt = new Date().toISOString();
      if (body.status === "done") {
        item.completedAt = body.occurred_at;
        item.completedBy = body.completed_by ?? actorId;
      }
      state.checklist.set(item.checklistItemId, item);

      const checklist = listTaskChecklist(state, task.taskId);
      const doneCount = checklist.filter((value) => value.status === "done").length;
      task.progressPercent = checklist.length === 0 ? 0 : Math.round((doneCount / checklist.length) * 100);
      task.updatedAt = new Date().toISOString();
      task.lastEventAt = body.occurred_at;

      appendPlatformEvent(state, {
        request_id: body.request_id,
        event_type: "task.checklist.updated",
        task_id: task.taskId,
        project_id: task.projectId,
        workflow_id: task.workflowId,
        actor_type: context.kind === "user" ? "user" : "agent",
        actor_id: actorId,
        source_agent_id: context.kind === "agent" ? context.agent.agentId : undefined,
        payload: {
          checklist_item_id: item.checklistItemId,
          status: body.status,
          progress_percent: task.progressPercent,
        },
        occurred_at: body.occurred_at,
      });

      if (item.itemOrder === 0 && body.status === "done") {
        maybePromoteToInProgress(state, task, context.kind === "agent" ? "agent" : "user", actorId);
      }

      return {
        item,
        task: serializeTask(state, task),
      };
    });
    return result;
  });

  app.post("/api/v1/events", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const event = eventEnvelopeSchema.parse(request.body ?? {});
    if (!event.task_id) {
      return reply.code(400).send({ error: "task_id is required for /api/v1/events" });
    }
    const taskId = event.task_id;
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    const result = await withIdempotency(state, "POST:/api/v1/events", actorId, event.request_id, () => {
      const task = state.tasks.get(taskId);
      if (task && context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
        throw new Error("Task is not assigned to this agent");
      }
      const stored = appendPlatformEvent(state, event);
      if (task) {
        if (["task.received", "task.accepted", "task.started", "task.submitted", "task.completed", "task.archived"].includes(event.event_type)) {
          const status =
            event.event_type === "task.received"
              ? "received"
              : event.event_type === "task.accepted"
                ? "accepted"
                : event.event_type === "task.started"
                  ? "in_progress"
                  : event.event_type === "task.submitted"
                      ? "waiting_review"
                      : event.event_type === "task.completed"
                        ? "done"
                        : "archived";
          const role = context.kind === "user" ? roleForTaskInState(state, context.user, task) : "assignee";
          transitionTaskStatus(task, status, role, event.occurred_at);
        }
      }
      return {
        accepted: true,
        event_id: stored.eventId,
      };
    });
    return result;
  });

  app.get("/api/v1/tasks/:taskId/events", async (request, reply) => {
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (!canReadTask(request, state, task)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return taskEvents(state, params.taskId)
      .map((eventId) => state.events.get(eventId))
      .filter((value): value is EventRecord => Boolean(value))
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  });

  app.post("/api/v1/tasks/:taskId/actions", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Task is not assigned to this agent" });
    }
    const body = actionRequestSchema.parse({
      ...(request.body as object),
      task_id: params.taskId,
    });
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    if (body.action_type === "start_task") {
      maybePromoteToInProgress(state, task, context.kind === "agent" ? "agent" : "user", actorId);
    }
    if ((body.action_type === "open_task_folder" || body.action_type === "open_attachment") && body.confirm_start) {
      maybePromoteToInProgress(state, task, context.kind === "agent" ? "agent" : "user", actorId);
    }
    return { accepted: true };
  });

  app.delete("/api/v1/tasks/:taskId", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { taskId: string };
    const task = state.tasks.get(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    if (!canDeleteTask(state, context.user, task)) {
      return reply.code(403).send({ error: "Delete permission denied" });
    }

    deleteTaskState(state, task.taskId);

    return {
      accepted: true,
      deleted_task_id: task.taskId,
    };
  });
}
