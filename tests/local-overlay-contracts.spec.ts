import { describe, expect, it } from "vitest";

import {
  buildConversationMessageView,
  conversationThreadSchema,
  getConversationSyncLabel,
} from "../packages/local-overlay-contracts/src/conversation-thread.js";

describe("local overlay conversation sync labels", () => {
  it("accepts replied conversation messages in thread payloads", () => {
    const payload = conversationThreadSchema.parse({
      conversation_id: "conv_admin",
      owner_user_id: "user_admin",
      current_agent_id: "agent_admin",
      openclaw_connected: true,
      messages: [
        {
          message_id: "msg_1",
          conversation_id: "conv_admin",
          owner_user_id: "user_admin",
          message_type: "user_message",
          author_kind: "user",
          body: "hello",
          sync_status: "replied",
          sync_detail: null,
          delivered_to_agent_at: null,
          created_at: "2026-03-17T09:00:00.000Z",
          updated_at: "2026-03-17T09:00:01.000Z",
        },
      ],
    });

    expect(payload.messages[0]?.sync_status).toBe("replied");
  });

  it("returns simplified user-facing sync labels", () => {
    expect(getConversationSyncLabel("pending")).toBe("已发送");
    expect(getConversationSyncLabel("synced")).toBe("本机 OpenClaw 已接收");
    expect(getConversationSyncLabel("processing")).toBe("OpenClaw 处理中");
    expect(getConversationSyncLabel("replied")).toBe("已回复");
    expect(getConversationSyncLabel("failed", "gateway offline")).toBe("处理失败：gateway offline");
  });

  it("uses the replied label in message views", () => {
    const view = buildConversationMessageView({
      message_id: "msg_2",
      conversation_id: "conv_admin",
      owner_user_id: "user_admin",
      message_type: "user_message",
      author_kind: "user",
      body: "hello",
      sync_status: "replied",
      sync_detail: null,
      delivered_to_agent_at: null,
      created_at: "2026-03-17T09:00:00.000Z",
      updated_at: "2026-03-17T09:00:01.000Z",
    }, "Admin");

    expect(view.sync_label).toBe("已回复");
  });
});
