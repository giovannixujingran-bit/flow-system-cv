import { z } from "zod";

export const conversationRouterTargetSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  agent_id: z.string(),
  online: z.boolean(),
});

export const replyOnlyActionSchema = z.object({
  action: z.literal("reply_only"),
  reply_text: z.string().trim().min(1),
});

export const forwardMessageActionSchema = z.object({
  action: z.literal("forward_message"),
  target_name: z.string().trim().min(1).max(128),
  forward_body: z.string().trim().min(1).max(5000),
  task_brief_title: z.string().trim().min(1).max(200),
  task_brief_summary: z.string().trim().min(1).max(2000),
});

export const conversationRouterActionSchema = z.discriminatedUnion("action", [
  replyOnlyActionSchema,
  forwardMessageActionSchema,
]);

export type ConversationRouterTarget = z.infer<typeof conversationRouterTargetSchema>;
export type ReplyOnlyAction = z.infer<typeof replyOnlyActionSchema>;
export type ForwardMessageAction = z.infer<typeof forwardMessageActionSchema>;
export type ConversationRouterAction = z.infer<typeof conversationRouterActionSchema>;

export type ParsedConversationRouterAction = {
  raw_text: string;
  action: ConversationRouterAction;
  used_structured_block: boolean;
};

const actionBlockPattern = /```flow-system-action\s*([\s\S]*?)```/i;
const defaultFallbackReply =
  "\u6211\u6682\u65f6\u65e0\u6cd5\u5904\u7406\u8fd9\u6761\u8bf7\u6c42\uff0c\u8bf7\u6362\u4e00\u79cd\u66f4\u660e\u786e\u7684\u8bf4\u6cd5\u3002";
const invalidActionFallbackReply =
  "\u6211\u521a\u624d\u6ca1\u6709\u6574\u7406\u597d\u8f6c\u53d1\u6307\u4ee4\uff0c\u8bf7\u518d\u8bf4\u4e00\u6b21\uff0c\u6216\u660e\u786e\u544a\u8bc9\u6211\u8981\u8f6c\u53d1\u7ed9\u8c01\u3002";

function fallbackReply(text: string, fallbackText?: string): ReplyOnlyAction {
  return {
    action: "reply_only",
    reply_text: fallbackText ?? (text.trim() || defaultFallbackReply),
  };
}

export function parseConversationRouterAction(responseText: string): ParsedConversationRouterAction {
  const rawText = responseText.trim();
  const match = rawText.match(actionBlockPattern);

  if (!match) {
    return {
      raw_text: rawText,
      action: fallbackReply(rawText),
      used_structured_block: false,
    };
  }

  try {
    const actionBlock = match[1];
    if (!actionBlock) {
      throw new Error("Missing flow-system-action body");
    }

    const payload = JSON.parse(actionBlock.trim()) as unknown;
    return {
      raw_text: rawText,
      action: conversationRouterActionSchema.parse(payload),
      used_structured_block: true,
    };
  } catch {
    return {
      raw_text: rawText,
      action: fallbackReply(rawText, invalidActionFallbackReply),
      used_structured_block: true,
    };
  }
}
