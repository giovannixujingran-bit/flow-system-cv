import { z } from "zod";

import type { PlatformRuntime } from "../context.js";
import {
  createConversationForwardArtifacts,
  listConversationForwardTargets,
  resolveConversationForwardTarget,
} from "../domain/conversation-forwarding.js";
import {
  classifyOpenClawReplyCompletion,
  findOpenClawTaskProgressByLinkedMessageId,
  markOpenClawConversationProgress,
} from "../domain/openclaw-task-progress.js";
import { requireAgent, requireUserRead, requireUserWrite } from "../http.js";
import { appendPlatformEvent, withIdempotency } from "../runtime.js";
import { appendConversationMessage, ensureConversation, listConversationMessages, preferredAgentForUser } from "../state.js";
import type { AgentRecord, AppState, ConversationMessageRecord } from "../types.js";

const sendConversationMessageSchema = z.object({
  request_id: z.string().min(5).max(128),
  target_agent_id: z.string().min(5).max(128).optional(),
  body: z.string().trim().min(1).max(5000),
});

const sendSelfConversationMessageSchema = z.object({
  request_id: z.string().min(5).max(128),
  body: z.string().trim().min(1).max(5000),
});

const ackConversationMessageSchema = z.object({
  request_id: z.string().min(5).max(128),
  delivered_at: z.string().optional(),
});

const updateConversationMessageStatusSchema = z.object({
  request_id: z.string().min(5).max(128),
  sync_status: z.enum(["processing", "failed"]),
  sync_detail: z.string().trim().min(1).max(5000).optional().nullable(),
  occurred_at: z.string().optional(),
});

const replyConversationMessageSchema = z.object({
  request_id: z.string().min(5).max(128),
  body: z.string().trim().min(1).max(20000),
  occurred_at: z.string().optional(),
});

const executeConversationForwardSchema = z.object({
  request_id: z.string().min(5).max(128),
  target_name: z.string().trim().min(1).max(128),
  forward_body: z.string().trim().min(1).max(5000),
  task_brief_title: z.string().trim().min(1).max(200),
  task_brief_summary: z.string().trim().min(1).max(2000),
});

function serializeConversationMessage(message: ConversationMessageRecord) {
  return {
    message_id: message.messageId,
    conversation_id: message.conversationId,
    owner_user_id: message.ownerUserId,
    message_type: message.messageType,
    author_kind: message.authorKind,
    body: message.body,
    source_user_id: message.sourceUserId,
    source_display_name: message.sourceDisplayName,
    target_user_id: message.targetUserId,
    target_agent_id: message.targetAgentId,
    sync_status: message.syncStatus,
    sync_detail: message.syncDetail,
    delivered_to_agent_at: message.deliveredToAgentAt,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  };
}

function resolveCurrentConversationAgent(state: AppState, ownerUserId: string): AgentRecord | undefined {
  return preferredAgentForUser(state, ownerUserId);
}

function setConversationUpdatedAt(state: AppState, conversationId: string, updatedAt: string): void {
  const conversation = state.conversations.get(conversationId);
  if (!conversation) {
    return;
  }
  conversation.updatedAt = updatedAt;
  state.conversations.set(conversationId, conversation);
}

function updateConversationMessageSyncState(
  state: AppState,
  message: ConversationMessageRecord,
  input: {
    syncStatus: ConversationMessageRecord["syncStatus"];
    updatedAt: string;
    syncDetail?: string | undefined;
    deliveredToAgentAt?: string | undefined;
  },
): ConversationMessageRecord {
  message.syncStatus = input.syncStatus;
  if (input.syncDetail === undefined) {
    delete message.syncDetail;
  } else {
    message.syncDetail = input.syncDetail;
  }
  if (input.deliveredToAgentAt !== undefined) {
    message.deliveredToAgentAt = input.deliveredToAgentAt;
  }
  message.updatedAt = input.updatedAt;
  state.conversationMessages.set(message.messageId, message);
  setConversationUpdatedAt(state, message.conversationId, input.updatedAt);
  return message;
}

function syncConversationLinkedTaskProgress(
  state: AppState,
  input: {
    message: ConversationMessageRecord;
    requestId: string;
    agent: AgentRecord;
    occurredAt: string;
    stage: "received" | "processing" | "failed" | "replied";
    replyBody?: string;
    failureDetail?: string;
  },
): void {
  const progress = findOpenClawTaskProgressByLinkedMessageId(state, input.message.messageId);
  if (!progress) {
    return;
  }

  const task = state.tasks.get(progress.taskId);
  if (!task) {
    return;
  }

  const previousStatus = task.status;
  let eventType: "task.progress.updated" | "task.started" | "task.completed" = "task.progress.updated";
  let currentStatusLabel = "进行中";
  let decisionSummary = "OpenClaw 已接收并开始处理关联任务。";
  let stage: "received" | "processing" | "failed" | "replied" | "completed" = input.stage;

  if (input.stage === "processing") {
    currentStatusLabel = "OpenClaw 处理中";
    decisionSummary = "OpenClaw 已进入处理阶段，任务状态同步为进行中。";
  } else if (input.stage === "failed") {
    currentStatusLabel = input.failureDetail ? `处理失败：${input.failureDetail}` : "处理失败";
    decisionSummary = input.failureDetail
      ? `OpenClaw 处理失败：${input.failureDetail}`
      : "OpenClaw 处理失败，任务保持在处理中等待重试。";
  } else if (input.stage === "replied") {
    const completion = classifyOpenClawReplyCompletion(task, input.replyBody ?? "");
    if (completion.completed) {
      stage = "completed";
      currentStatusLabel = "已完成";
      decisionSummary = completion.decisionSummary;
      eventType = "task.completed";
    } else {
      currentStatusLabel = "已回复，待继续处理";
      decisionSummary = completion.decisionSummary;
    }
  }

  const record = markOpenClawConversationProgress(state, task, {
    stage,
    occurredAt: input.occurredAt,
    agent: input.agent,
    linkedMessageId: input.message.messageId,
    currentStatusLabel,
    decisionSummary,
  });

  if (eventType === "task.progress.updated" && previousStatus !== task.status && task.status === "in_progress") {
    eventType = "task.started";
  }

  appendPlatformEvent(state, {
    request_id: input.requestId,
    event_type: eventType,
    task_id: task.taskId,
    project_id: task.projectId,
    workflow_id: task.workflowId,
    actor_type: "agent",
    actor_id: input.agent.agentId,
    source_agent_id: input.agent.agentId,
    payload: {
      source: "conversation_sync",
      message_id: input.message.messageId,
      stage,
      current_status_label: record.currentStatusLabel,
      decision_summary: record.lastDecisionSummary,
    },
    occurred_at: input.occurredAt,
  });
}

function appendDeliveryReceiptIfNeeded(
  state: AppState,
  message: ConversationMessageRecord,
  agent: AgentRecord,
): void {
  if (message.messageType !== "incoming_delivery" || !message.sourceUserId || message.sourceUserId === message.ownerUserId) {
    return;
  }

  const senderConversation = ensureConversation(state, message.sourceUserId);
  const senderPreferredAgent = resolveCurrentConversationAgent(state, message.sourceUserId);
  appendConversationMessage(state, {
    conversationId: senderConversation.conversationId,
    ownerUserId: senderConversation.ownerUserId,
    messageType: "delivery_receipt",
    authorKind: "openclaw",
    body: `${agent.agentName} \u5df2\u6536\u5230\u4f60\u53d1\u7ed9 ${state.users.get(agent.ownerUserId)?.displayName ?? agent.ownerUserId} \u7684\u6d88\u606f\u3002`,
    sourceUserId: agent.ownerUserId,
    sourceDisplayName: state.users.get(agent.ownerUserId)?.displayName ?? agent.ownerUserId,
    targetUserId: message.sourceUserId,
    ...(senderPreferredAgent ? { targetAgentId: senderPreferredAgent.agentId } : {}),
    syncStatus: senderPreferredAgent ? "pending" : "none",
  });
}

function appendUserConversationMessage(
  state: AppState,
  input: {
    senderUserId: string;
    senderDisplayName: string;
    targetAgent: AgentRecord;
    body: string;
  },
) {
  const senderConversation = ensureConversation(state, input.senderUserId);
  const recipientConversation = ensureConversation(state, input.targetAgent.ownerUserId);
  const isSelfConversation = input.targetAgent.ownerUserId === input.senderUserId;
  const targetUser = state.users.get(input.targetAgent.ownerUserId);

  const userMessage = appendConversationMessage(state, {
    conversationId: senderConversation.conversationId,
    ownerUserId: senderConversation.ownerUserId,
    messageType: "user_message",
    authorKind: "user",
    body: input.body,
    sourceUserId: input.senderUserId,
    sourceDisplayName: input.senderDisplayName,
    targetUserId: input.targetAgent.ownerUserId,
    ...(isSelfConversation
      ? {
          targetAgentId: input.targetAgent.agentId,
          syncStatus: "pending" as const,
        }
      : {
          syncStatus: "none" as const,
        }),
  });

  if (!isSelfConversation) {
    appendConversationMessage(state, {
      conversationId: senderConversation.conversationId,
      ownerUserId: senderConversation.ownerUserId,
      messageType: "sender_ack",
      authorKind: "openclaw",
      body: `\u5df2\u8f6c\u4ea4\u7ed9 ${targetUser?.displayName ?? input.targetAgent.agentName} \u7684 OpenClaw\uff0c\u7b49\u5f85\u5bf9\u65b9\u672c\u5730\u63a5\u6536\u3002`,
      sourceUserId: input.senderUserId,
      sourceDisplayName: input.senderDisplayName,
      targetUserId: input.targetAgent.ownerUserId,
      syncStatus: "none",
    });

    appendConversationMessage(state, {
      conversationId: recipientConversation.conversationId,
      ownerUserId: recipientConversation.ownerUserId,
      messageType: "incoming_delivery",
      authorKind: "openclaw",
      body: `${input.senderDisplayName} \u53d1\u6765\u6d88\u606f\uff1a${input.body}`,
      sourceUserId: input.senderUserId,
      sourceDisplayName: input.senderDisplayName,
      targetUserId: input.targetAgent.ownerUserId,
      targetAgentId: input.targetAgent.agentId,
      syncStatus: "pending",
    });
  }

  return {
    senderConversation,
    userMessage,
  };
}

export function registerConversationRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.get("/api/v1/conversations/thread", async (request, reply) => {
    const context = requireUserRead(request, reply, state);
    if (!context) {
      return;
    }

    const currentAgent = resolveCurrentConversationAgent(state, context.user.userId);
    const conversation = ensureConversation(state, context.user.userId);
    return {
      conversation_id: conversation.conversationId,
      owner_user_id: conversation.ownerUserId,
      current_agent_id: currentAgent?.agentId ?? null,
      openclaw_connected: Boolean(currentAgent),
      messages: listConversationMessages(state, conversation.conversationId).map(serializeConversationMessage),
    };
  });

  app.post("/api/v1/conversations/messages", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }

    const body = sendConversationMessageSchema.parse(request.body ?? {});
    const targetAgent = body.target_agent_id
      ? state.agents.get(body.target_agent_id)
      : resolveCurrentConversationAgent(state, context.user.userId);
    if (!targetAgent) {
      return reply.code(400).send({ error: "Current OpenClaw agent is not available" });
    }

    const result = await withIdempotency(
      state,
      "POST:/api/v1/conversations/messages",
      context.user.userId,
      body.request_id,
      () => {
        const { senderConversation, userMessage } = appendUserConversationMessage(state, {
          senderUserId: context.user.userId,
          senderDisplayName: context.user.displayName,
          targetAgent,
          body: body.body,
        });

        return {
          accepted: true,
          conversation_id: senderConversation.conversationId,
          message: serializeConversationMessage(userMessage),
          messages: listConversationMessages(state, senderConversation.conversationId).map(serializeConversationMessage),
        };
      },
    );

    return result;
  });

  app.post("/api/v1/agents/:agentId/conversations/self/messages", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const body = sendSelfConversationMessageSchema.parse(request.body ?? {});

    const result = await withIdempotency(
      state,
      `POST:/api/v1/agents/${params.agentId}/conversations/self/messages`,
      context.agent.agentId,
      body.request_id,
      () => {
        const owner = state.users.get(context.agent.ownerUserId);
        const { senderConversation, userMessage } = appendUserConversationMessage(state, {
          senderUserId: context.agent.ownerUserId,
          senderDisplayName: owner?.displayName ?? context.agent.ownerUserId,
          targetAgent: context.agent,
          body: body.body,
        });

        return {
          accepted: true,
          conversation_id: senderConversation.conversationId,
          message: serializeConversationMessage(userMessage),
          messages: listConversationMessages(state, senderConversation.conversationId).map(serializeConversationMessage),
        };
      },
    );

    return result;
  });

  app.get("/api/v1/agents/:agentId/conversations/thread", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const conversation = ensureConversation(state, context.agent.ownerUserId);
    return {
      conversation_id: conversation.conversationId,
      owner_user_id: conversation.ownerUserId,
      current_agent_id: context.agent.agentId,
      openclaw_connected: true,
      messages: listConversationMessages(state, conversation.conversationId).map(serializeConversationMessage),
    };
  });

  app.get("/api/v1/agents/:agentId/conversation-targets", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    return listConversationForwardTargets(state, config, context.agent.ownerUserId);
  });

  app.post("/api/v1/agents/:agentId/conversation-forwards", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const body = executeConversationForwardSchema.parse(request.body ?? {});
    const senderDisplayName = state.users.get(context.agent.ownerUserId)?.displayName ?? context.agent.ownerUserId;

    const result = await withIdempotency(
      state,
      `POST:/api/v1/agents/${params.agentId}/conversation-forwards`,
      context.agent.agentId,
      body.request_id,
      () => {
        const targets = listConversationForwardTargets(state, config, context.agent.ownerUserId);
        const resolved = resolveConversationForwardTarget(targets, body.target_name);
        if (!resolved.ok) {
          throw new Error(resolved.message);
        }

        const artifacts = createConversationForwardArtifacts(state, {
          requestId: body.request_id,
          senderAgent: context.agent,
          senderDisplayName,
          target: resolved.target,
          forwardBody: body.forward_body,
          taskBriefTitle: body.task_brief_title,
          taskBriefSummary: body.task_brief_summary,
        });

        return {
          accepted: true,
          target: resolved.target,
          forwarded_message: serializeConversationMessage(artifacts.forwardedMessage),
          task_brief: artifacts.taskBrief,
        };
      },
    );

    return result;
  });

  app.get("/api/v1/agents/:agentId/conversations/messages/pending", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    return [...state.conversationMessages.values()]
      .filter((message) => message.targetAgentId === context.agent.agentId && message.syncStatus === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(serializeConversationMessage);
  });

  app.post("/api/v1/agents/:agentId/conversations/messages/:messageId/ack", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string; messageId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const body = ackConversationMessageSchema.parse(request.body ?? {});

    const result = await withIdempotency(
      state,
      `POST:/api/v1/agents/${params.agentId}/conversations/messages/${params.messageId}/ack`,
      context.agent.agentId,
      body.request_id,
      () => {
        const message = state.conversationMessages.get(params.messageId);
        if (!message || message.targetAgentId !== context.agent.agentId) {
          throw new Error("Conversation message not found");
        }

        if (message.syncStatus === "pending") {
          const deliveredAt = body.delivered_at ?? new Date().toISOString();
          const firstDelivery = !message.deliveredToAgentAt;
          updateConversationMessageSyncState(state, message, {
            syncStatus: "synced",
            updatedAt: deliveredAt,
            deliveredToAgentAt: deliveredAt,
          });
          if (firstDelivery) {
            appendDeliveryReceiptIfNeeded(state, message, context.agent);
          }
          syncConversationLinkedTaskProgress(state, {
            message,
            requestId: body.request_id,
            agent: context.agent,
            occurredAt: deliveredAt,
            stage: "received",
          });
        }

        return {
          accepted: true,
          message_id: params.messageId,
          delivered_to_agent_at: message.deliveredToAgentAt,
          message: serializeConversationMessage(message),
        };
      },
    );

    return result;
  });

  app.post("/api/v1/agents/:agentId/conversations/messages/:messageId/status", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string; messageId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const body = updateConversationMessageStatusSchema.parse(request.body ?? {});

    const result = await withIdempotency(
      state,
      `POST:/api/v1/agents/${params.agentId}/conversations/messages/${params.messageId}/status`,
      context.agent.agentId,
      body.request_id,
      () => {
        const message = state.conversationMessages.get(params.messageId);
        if (!message || message.targetAgentId !== context.agent.agentId) {
          throw new Error("Conversation message not found");
        }

        if (message.syncStatus !== "replied") {
          const occurredAt = body.occurred_at ?? new Date().toISOString();
          const nextStatus = body.sync_status;
          const nextDetail = nextStatus === "failed" ? body.sync_detail ?? undefined : undefined;
          const canUpdate =
            nextStatus === "failed"
              ? true
              : message.syncStatus === "pending" || message.syncStatus === "synced" || message.syncStatus === "processing";

          if (canUpdate) {
            const firstDelivery = !message.deliveredToAgentAt;
            updateConversationMessageSyncState(state, message, {
              syncStatus: nextStatus,
              syncDetail: nextDetail,
              updatedAt: occurredAt,
              deliveredToAgentAt: message.deliveredToAgentAt ?? occurredAt,
            });
            if (firstDelivery) {
              appendDeliveryReceiptIfNeeded(state, message, context.agent);
            }
            syncConversationLinkedTaskProgress(state, {
              message,
              requestId: body.request_id,
              agent: context.agent,
              occurredAt,
              stage: nextStatus === "failed" ? "failed" : "processing",
              ...(nextDetail ? { failureDetail: nextDetail } : {}),
            });
          }
        }

        return {
          accepted: true,
          message: serializeConversationMessage(message),
          occurred_at: body.occurred_at ?? message.updatedAt,
        };
      },
    );

    return result;
  });

  app.post("/api/v1/agents/:agentId/conversations/messages/:messageId/reply", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string; messageId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    const body = replyConversationMessageSchema.parse(request.body ?? {});

    const result = await withIdempotency(
      state,
      `POST:/api/v1/agents/${params.agentId}/conversations/messages/${params.messageId}/reply`,
      context.agent.agentId,
      body.request_id,
      () => {
        const sourceMessage = state.conversationMessages.get(params.messageId);
        if (!sourceMessage || sourceMessage.targetAgentId !== context.agent.agentId) {
          throw new Error("Conversation message not found");
        }

        const occurredAt = body.occurred_at ?? new Date().toISOString();
        const firstDelivery = !sourceMessage.deliveredToAgentAt;
        updateConversationMessageSyncState(state, sourceMessage, {
          syncStatus: "replied",
          syncDetail: undefined,
          updatedAt: occurredAt,
          deliveredToAgentAt: sourceMessage.deliveredToAgentAt ?? occurredAt,
        });
        if (firstDelivery) {
          appendDeliveryReceiptIfNeeded(state, sourceMessage, context.agent);
        }

        const replyMessage = appendConversationMessage(state, {
          conversationId: sourceMessage.conversationId,
          ownerUserId: sourceMessage.ownerUserId,
          messageType: "openclaw_reply",
          authorKind: "openclaw",
          body: body.body,
          sourceUserId: context.agent.ownerUserId,
          sourceDisplayName: context.agent.agentName,
          targetUserId: sourceMessage.sourceUserId ?? sourceMessage.ownerUserId,
          syncStatus: "none",
        });
        syncConversationLinkedTaskProgress(state, {
          message: sourceMessage,
          requestId: body.request_id,
          agent: context.agent,
          occurredAt,
          stage: "replied",
          replyBody: body.body,
        });
        const linkedProgress = findOpenClawTaskProgressByLinkedMessageId(state, sourceMessage.messageId);
        if (linkedProgress && !linkedProgress.linkedMessageIds.includes(replyMessage.messageId)) {
          linkedProgress.linkedMessageIds = [...linkedProgress.linkedMessageIds, replyMessage.messageId];
          linkedProgress.updatedAt = occurredAt;
          state.openClawTaskProgress.set(linkedProgress.taskId, linkedProgress);
        }

        return {
          accepted: true,
          source_message: serializeConversationMessage(sourceMessage),
          message: serializeConversationMessage(replyMessage),
          occurred_at: occurredAt,
        };
      },
    );

    return result;
  });
}
