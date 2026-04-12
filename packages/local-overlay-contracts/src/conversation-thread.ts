import { z } from "zod";

export const conversationSyncStatusSchema = z.enum(["none", "pending", "synced", "processing", "replied", "failed"]);
export type ConversationSyncStatus = z.infer<typeof conversationSyncStatusSchema>;

export const conversationMessageSchema = z.object({
  message_id: z.string(),
  conversation_id: z.string(),
  owner_user_id: z.string(),
  message_type: z.string(),
  author_kind: z.enum(["user", "openclaw"]),
  body: z.string(),
  source_user_id: z.string().nullable().optional(),
  source_display_name: z.string().nullable().optional(),
  target_user_id: z.string().nullable().optional(),
  target_agent_id: z.string().nullable().optional(),
  sync_status: conversationSyncStatusSchema,
  sync_detail: z.string().nullable().optional(),
  delivered_to_agent_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationThreadSchema = z.object({
  conversation_id: z.string(),
  owner_user_id: z.string(),
  current_agent_id: z.string().nullable(),
  openclaw_connected: z.boolean(),
  messages: z.array(conversationMessageSchema),
});
export type ConversationThread = z.infer<typeof conversationThreadSchema>;

export const conversationMessageViewSchema = z.object({
  message_id: z.string(),
  author_kind: z.enum(["user", "openclaw"]),
  author_label: z.string(),
  body: z.string(),
  time_label: z.string(),
  sync_label: z.string().nullable(),
  align: z.enum(["left", "right"]),
});
export type ConversationMessageView = z.infer<typeof conversationMessageViewSchema>;

export function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function getConversationSyncLabel(status: ConversationSyncStatus, detail?: string | null): string | null {
  if (status === "pending") {
    return "\u5df2\u53d1\u9001";
  }
  if (status === "synced") {
    return "\u672c\u673a OpenClaw \u5df2\u63a5\u6536";
  }
  if (status === "processing") {
    return "OpenClaw \u5904\u7406\u4e2d";
  }
  if (status === "replied") {
    return "\u5df2\u56de\u590d";
  }
  if (status === "failed") {
    return detail && detail.trim().length > 0
      ? `\u5904\u7406\u5931\u8d25\uff1a${detail.trim()}`
      : "\u5904\u7406\u5931\u8d25";
  }
  return null;
}

export function getConversationConnectionLabel(connected: boolean): string {
  return connected ? "\u5df2\u8fde\u63a5\u672c\u673a OpenClaw" : "\u672a\u8fde\u63a5\u672c\u673a OpenClaw";
}

export function buildConversationMessageView(
  message: ConversationMessage,
  ownerDisplayName: string,
): ConversationMessageView {
  return conversationMessageViewSchema.parse({
    message_id: message.message_id,
    author_kind: message.author_kind,
    author_label: message.author_kind === "user" ? ownerDisplayName : "OpenClaw",
    body: message.body,
    time_label: formatConversationTime(message.created_at),
    sync_label: message.author_kind === "user" ? getConversationSyncLabel(message.sync_status, message.sync_detail) : null,
    align: message.author_kind === "user" ? "right" : "left",
  });
}

export function buildConversationMessageViews(
  messages: ConversationMessage[],
  ownerDisplayName: string,
): ConversationMessageView[] {
  return messages.map((message) => buildConversationMessageView(message, ownerDisplayName));
}
