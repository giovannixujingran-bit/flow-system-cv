import { makeId, type TaskDeliveryRequest, type WorkflowTemplate } from "@flow-system/flow-protocol";

import type { PlatformApiConfig } from "../config.js";
import { createDefaultOpenClawTaskProgress, syncOpenClawTaskProgressFromTask } from "./openclaw-task-progress.js";
import { appendPlatformEvent, nowIso, serializeTask } from "../runtime.js";
import {
  appendConversationMessage,
  appendTaskChecklist,
  buildChecklistForTask,
  ensureConversation,
  findActiveWorkflowTemplate,
  preferredAgentForUser,
  storeTask,
} from "../state.js";
import type { AgentRecord, AppState, ProjectRecord, TaskRecord, WorkflowRecord } from "../types.js";

export const conversationRoutingProjectId = "proj_openclaw_conversation_router";
export const conversationRoutingWorkflowTemplateId = "wf_tmpl_openclaw_conversation_router_v1";
export const conversationRoutingWorkflowId = "wf_openclaw_conversation_router";
export const conversationRoutingStepId = "step_openclaw_conversation_router_delivery";
export const conversationRoutingProjectName = "OpenClaw 会话转发";

const reusableConversationBriefStatuses = new Set<TaskRecord["status"]>([
  "delivered",
  "received",
  "accepted",
  "in_progress",
  "waiting_review",
]);

export type ConversationForwardTarget = {
  user_id: string;
  username: string;
  display_name: string;
  agent_id: string;
  online: boolean;
};

type ResolveTargetResult =
  | { ok: true; target: ConversationForwardTarget }
  | { ok: false; reason: "not_found" | "ambiguous" | "offline"; message: string };

function normalizeConversationBriefText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function findReusableConversationBriefTask(
  state: AppState,
  input: {
    senderUserId: string;
    targetUserId: string;
    taskBriefTitle: string;
    taskBriefSummary: string;
  },
): TaskRecord | undefined {
  const normalizedTitle = normalizeConversationBriefText(input.taskBriefTitle);
  const normalizedSummary = normalizeConversationBriefText(input.taskBriefSummary);

  return [...state.tasks.values()]
    .filter((task) =>
      task.projectId === conversationRoutingProjectId
      && task.taskType === "conversation_brief"
      && task.senderUserId === input.senderUserId
      && task.assigneeUserId === input.targetUserId
      && reusableConversationBriefStatuses.has(task.status))
    .filter((task) => {
      const taskTitle = normalizeConversationBriefText(task.taskTitle);
      const taskSummary = normalizeConversationBriefText(task.summary);
      if (taskTitle.length > 0 && taskTitle === normalizedTitle) {
        return true;
      }
      if (!normalizedSummary || !taskSummary) {
        return false;
      }
      return taskSummary === normalizedSummary
        || taskSummary.includes(normalizedSummary)
        || normalizedSummary.includes(taskSummary);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function systemWorkflowTemplate(): WorkflowTemplate {
  return {
    workflow_template_id: conversationRoutingWorkflowTemplateId,
    workflow_name: "OpenClaw 会话转发流程",
    workflow_type: "openclaw_conversation_forward",
    template_version: 1,
    is_active: true,
    steps: [
      {
        step_id: conversationRoutingStepId,
        step_code: "conversation_delivery",
        step_name: "会话转发简报",
        step_order: 1,
        owner_role: "member",
        sla_minutes: 240,
      },
    ],
  };
}

export function ensureConversationRoutingProject(state: AppState): {
  project: ProjectRecord;
  workflow: WorkflowRecord;
  template: WorkflowTemplate;
} {
  const createdAt = nowIso();

  let project = state.projects.get(conversationRoutingProjectId);
  if (!project) {
    project = {
      projectId: conversationRoutingProjectId,
      projectCode: "OPENCLAW-CONVERSATION",
      projectName: conversationRoutingProjectName,
      description: "用于记录 OpenClaw 会话转发生成的任务简报。",
      department: "operations",
      ownerUserId: "user_owner",
      participantUserIds: ["user_owner"],
      projectType: "operations",
      status: "in_progress",
      priority: "P2",
      attachmentManifest: [],
      currentStage: "进行中",
      completionRate: 0,
      createdAt,
      updatedAt: createdAt,
    };
    state.projects.set(project.projectId, project);
  }

  let template = state.workflowTemplates.get(conversationRoutingWorkflowTemplateId);
  if (!template) {
    template = systemWorkflowTemplate();
    state.workflowTemplates.set(template.workflow_template_id, template);
  }

  let workflow = state.workflows.get(conversationRoutingWorkflowId);
  if (!workflow) {
    workflow = {
      workflowId: conversationRoutingWorkflowId,
      projectId: project.projectId,
      workflowTemplateId: template.workflow_template_id,
      templateVersion: template.template_version,
      workflowName: template.workflow_name,
      workflowType: template.workflow_type,
      status: "in_progress",
      currentStepId: conversationRoutingStepId,
      createdAt,
      updatedAt: createdAt,
    };
    state.workflows.set(workflow.workflowId, workflow);
  }

  return { project, workflow, template };
}

export function isAgentOnline(state: AppState, config: PlatformApiConfig, agent: AgentRecord): boolean {
  if (agent.status !== "online") {
    return false;
  }
  const heartbeat = state.heartbeats.get(agent.agentId);
  const lastSeenAt = heartbeat?.occurredAt ?? agent.lastHeartbeatAt ?? agent.updatedAt;
  if (!lastSeenAt) {
    return false;
  }
  return Date.now() - new Date(lastSeenAt).getTime() <= config.heartbeatOfflineSeconds * 1000;
}

export function listConversationForwardTargets(
  state: AppState,
  config: PlatformApiConfig,
  requesterUserId: string,
): ConversationForwardTarget[] {
  return [...state.users.values()]
    .filter((user) => user.userId !== requesterUserId && !user.deletedAt && (user.status ?? "active") === "active")
    .map((user) => {
      const agent = preferredAgentForUser(state, user.userId);
      if (!agent) {
        return null;
      }
      return {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        agent_id: agent.agentId,
        online: isAgentOnline(state, config, agent),
      } satisfies ConversationForwardTarget;
    })
    .filter((value): value is ConversationForwardTarget => Boolean(value));
}

export function resolveConversationForwardTarget(
  targets: ConversationForwardTarget[],
  targetName: string,
): ResolveTargetResult {
  const exactName = targetName.trim();
  const displayMatches = targets.filter((target) => target.display_name === exactName);
  if (displayMatches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `找到多个显示名为“${exactName}”的目标，请改用用户名。`,
    };
  }
  const selected =
    displayMatches.length === 1
      ? displayMatches[0]
      : targets.filter((target) => target.username === exactName).length === 1
        ? targets.find((target) => target.username === exactName)
        : undefined;

  if (!selected) {
    const usernameMatches = targets.filter((target) => target.username === exactName);
    if (usernameMatches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        message: `找到多个用户名为“${exactName}”的目标，请检查成员目录。`,
      };
    }
    return {
      ok: false,
      reason: "not_found",
      message: `未找到名为“${exactName}”的在线成员。`,
    };
  }

  if (!selected.online) {
    return {
      ok: false,
      reason: "offline",
      message: `“${selected.display_name}”当前未连接本机 OpenClaw。`,
    };
  }

  return {
    ok: true,
    target: selected,
  };
}

export function createConversationForwardArtifacts(
  state: AppState,
  input: {
    requestId: string;
    senderAgent: AgentRecord;
    senderDisplayName: string;
    target: ConversationForwardTarget;
    forwardBody: string;
    taskBriefTitle: string;
    taskBriefSummary: string;
  },
): {
  forwardedMessage: ReturnType<typeof appendConversationMessage>;
  taskBrief: ReturnType<typeof serializeTask>;
} {
  const { project, workflow, template } = ensureConversationRoutingProject(state);
  const createdAt = nowIso();
  const recipientConversation = ensureConversation(state, input.target.user_id);

  const forwardedMessage = appendConversationMessage(state, {
    conversationId: recipientConversation.conversationId,
    ownerUserId: recipientConversation.ownerUserId,
    messageType: "incoming_delivery",
    authorKind: "openclaw",
    body: input.forwardBody,
    sourceUserId: input.senderAgent.ownerUserId,
    sourceDisplayName: input.senderDisplayName,
    targetUserId: input.target.user_id,
    targetAgentId: input.target.agent_id,
    syncStatus: "pending",
  });

  const reusableTask = findReusableConversationBriefTask(state, {
    senderUserId: input.senderAgent.ownerUserId,
    targetUserId: input.target.user_id,
    taskBriefTitle: input.taskBriefTitle,
    taskBriefSummary: input.taskBriefSummary,
  });

  if (reusableTask) {
    reusableTask.summary = input.taskBriefSummary;
    reusableTask.lastEventAt = createdAt;
    reusableTask.updatedAt = createdAt;
    syncOpenClawTaskProgressFromTask(state, reusableTask, {
      linkedConversationId: recipientConversation.conversationId,
      linkedMessageIds: [forwardedMessage.messageId],
      decisionSummary: "OpenClaw reused the active conversation task card instead of creating a duplicate.",
      occurredAt: createdAt,
    });
    appendPlatformEvent(state, {
      request_id: input.requestId,
      event_type: "task.progress.updated",
      task_id: reusableTask.taskId,
      project_id: reusableTask.projectId,
      workflow_id: reusableTask.workflowId,
      actor_type: "agent",
      actor_id: input.senderAgent.agentId,
      source_agent_id: input.senderAgent.agentId,
      payload: {
        source: "openclaw_conversation_router_rebind",
        target_user_id: input.target.user_id,
        forwarded_message_id: forwardedMessage.messageId,
      },
      occurred_at: createdAt,
    });
    return {
      forwardedMessage,
      taskBrief: serializeTask(state, reusableTask),
    };
  }

  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const delivery: TaskDeliveryRequest = {
    request_id: input.requestId,
    project_id: project.projectId,
    workflow_id: workflow.workflowId,
    workflow_template_id: template.workflow_template_id,
    template_version: template.template_version,
    step_id: conversationRoutingStepId,
    task_title: input.taskBriefTitle,
    task_type: "conversation_brief",
    sender_user_id: input.senderAgent.ownerUserId,
    target_user_id: input.target.user_id,
    target_agent_id: input.target.agent_id,
    priority: "medium",
    deadline,
    summary: input.taskBriefSummary,
    constraints: [],
    deliverables: ["查看转发消息", "完成处理并反馈"],
    attachment_file_ids: [],
    plan_mode: "structured",
  };

  const taskId = makeId("task");
  const task: TaskRecord = {
    taskId,
    requestId: input.requestId,
    projectId: project.projectId,
    workflowId: workflow.workflowId,
    workflowTemplateId: template.workflow_template_id,
    templateVersion: template.template_version,
    stepId: conversationRoutingStepId,
    taskTitle: input.taskBriefTitle,
    taskType: "conversation_brief",
    senderUserId: input.senderAgent.ownerUserId,
    assigneeUserId: input.target.user_id,
    assigneeAgentId: input.target.agent_id,
    priority: "medium",
    status: "delivered",
    progressPercent: 0,
    summary: input.taskBriefSummary,
    constraints: [],
    deliverables: delivery.deliverables,
    deadline,
    lastEventAt: createdAt,
    riskLevel: "none",
    attachmentManifest: [],
    createdAt,
    updatedAt: createdAt,
  };

  storeTask(state, task);
  appendTaskChecklist(state, taskId, buildChecklistForTask(taskId, delivery, findActiveWorkflowTemplate(state, template.workflow_template_id)));
  createDefaultOpenClawTaskProgress(state, task, {
    linkedConversationId: recipientConversation.conversationId,
    linkedMessageIds: [forwardedMessage.messageId],
      decisionSummary: "OpenClaw reused the active conversation task card instead of creating a duplicate.",
    currentStatusLabel: "已创建",
  });

  appendPlatformEvent(state, {
    request_id: input.requestId,
    event_type: "task.created",
    task_id: taskId,
    project_id: project.projectId,
    workflow_id: workflow.workflowId,
    actor_type: "agent",
    actor_id: input.senderAgent.agentId,
    source_agent_id: input.senderAgent.agentId,
    payload: {
      source: "openclaw_conversation_router",
      target_user_id: input.target.user_id,
      forwarded_message_id: forwardedMessage.messageId,
    },
    occurred_at: createdAt,
  });
  appendPlatformEvent(state, {
    request_id: makeId("req"),
    event_type: "task.delivered",
    task_id: taskId,
    project_id: project.projectId,
    workflow_id: workflow.workflowId,
    actor_type: "system",
    actor_id: "openclaw_conversation_router",
    source_agent_id: input.target.agent_id,
    payload: {
      target_agent_id: input.target.agent_id,
      forwarded_message_id: forwardedMessage.messageId,
    },
    occurred_at: createdAt,
  });

  return {
    forwardedMessage,
    taskBrief: serializeTask(state, task),
  };
}
