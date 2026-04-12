import { z } from "zod";
import { openClawStatusSchema } from "@flow-system/local-openclaw-contracts";

import { conversationMessageSchema, conversationMessageViewSchema } from "./conversation-thread.js";

export const overlayOrbStateSchema = z.enum(["idle", "unread", "processing", "error"]);
export type OverlayOrbState = z.infer<typeof overlayOrbStateSchema>;

export const overlayUnreadStateSchema = z.object({
  count: z.number().int().min(0),
  last_openclaw_message_at: z.string().nullable(),
});
export type OverlayUnreadState = z.infer<typeof overlayUnreadStateSchema>;

export const overlayBootstrapSchema = z.object({
  owner_user_id: z.string(),
  owner_display_name: z.string(),
  agent_id: z.string().nullable(),
  local_ui_port: z.number().int().min(1),
  platform_web_origin: z.string(),
  openclaw_connected: z.boolean(),
  openclaw_status: openClawStatusSchema,
  unread: overlayUnreadStateSchema,
  current_task_count: z.number().int().min(0),
  orb_state: overlayOrbStateSchema,
  last_platform_url: z.string().nullable(),
});
export type OverlayBootstrap = z.infer<typeof overlayBootstrapSchema>;

export const overlayConversationMessageSchema = conversationMessageSchema;
export type OverlayConversationMessage = z.infer<typeof overlayConversationMessageSchema>;

export const overlayConversationsResponseSchema = z.object({
  owner_display_name: z.string(),
  openclaw_connected: z.boolean(),
  openclaw_status: openClawStatusSchema,
  connection_label: z.string(),
  unread: overlayUnreadStateSchema,
  messages: z.array(overlayConversationMessageSchema),
  message_views: z.array(conversationMessageViewSchema),
});
export type OverlayConversationsResponse = z.infer<typeof overlayConversationsResponseSchema>;

export const overlayConversationSendSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type OverlayConversationSendInput = z.infer<typeof overlayConversationSendSchema>;

export const overlayTaskCardSchema = z.object({
  task_id: z.string(),
  project_id: z.string(),
  project_name: z.string(),
  task_title: z.string(),
  user_display_name: z.string(),
  status: z.string(),
  deadline: z.string(),
  last_event_at: z.string(),
  local_task_path: z.string(),
});
export type OverlayTaskCard = z.infer<typeof overlayTaskCardSchema>;

export const overlayTaskListResponseSchema = z.object({
  tasks: z.array(overlayTaskCardSchema),
});
export type OverlayTaskListResponse = z.infer<typeof overlayTaskListResponseSchema>;

export const overlayOpenTaskResultSchema = z.object({
  task_id: z.string(),
  opened_target: z.enum(["platform", "local"]),
  destination: z.string(),
  platform_reachable: z.boolean(),
});
export type OverlayOpenTaskResult = z.infer<typeof overlayOpenTaskResultSchema>;

export const overlayHealthSchema = z.object({
  ok: z.literal(true),
  openclaw_connected: z.boolean(),
  openclaw_status: openClawStatusSchema,
  orb_state: overlayOrbStateSchema,
});
export type OverlayHealth = z.infer<typeof overlayHealthSchema>;
