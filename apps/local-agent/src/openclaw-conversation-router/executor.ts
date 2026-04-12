import type { ConversationForwardExecutionResponse, PlatformClient, PlatformRequestError } from "../services/platform-client.js";
import type { ConversationRouterAction, ForwardMessageAction } from "./protocol.js";

export const conversationRoutingProjectName = "OpenClaw 会话转发";

function formatForwardSuccessReply(
  payload: ConversationForwardExecutionResponse,
  action: ForwardMessageAction,
): string {
  const taskTitle =
    typeof payload.task_brief?.task_title === "string" && payload.task_brief.task_title.trim().length > 0
      ? payload.task_brief.task_title.trim()
      : action.task_brief_title;
  return `已转发给 ${payload.target.display_name} 的 OpenClaw，并在“${conversationRoutingProjectName}”项目中创建任务简报《${taskTitle}》。`;
}

function formatForwardFailureReply(action: ForwardMessageAction, error: unknown): string {
  const details =
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof (error as { details?: unknown }).details === "string"
      ? (error as { details: string }).details
      : error instanceof Error
        ? error.message
        : `无法转发给“${action.target_name}”。`;
  return `我暂时无法把这条消息转发给“${action.target_name}”：${details}`;
}

export async function executeConversationRouterAction(input: {
  client: PlatformClient;
  agentId: string;
  requestId: string;
  action: ConversationRouterAction;
}): Promise<{ replyText: string; forwardResult?: ConversationForwardExecutionResponse }> {
  if (input.action.action === "reply_only") {
    return {
      replyText: input.action.reply_text,
    };
  }

  try {
    const forwardResult = await input.client.executeConversationForward(input.agentId, {
      request_id: input.requestId,
      target_name: input.action.target_name,
      forward_body: input.action.forward_body,
      task_brief_title: input.action.task_brief_title,
      task_brief_summary: input.action.task_brief_summary,
    });
    return {
      replyText: formatForwardSuccessReply(forwardResult, input.action),
      forwardResult,
    };
  } catch (error) {
    return {
      replyText: formatForwardFailureReply(input.action, error),
    };
  }
}

export type ConversationRouterForwardError = PlatformRequestError;
