import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildConversationRouterPrompt, buildConversationRouterRepairPrompt } from "../apps/local-agent/src/openclaw-conversation-router/prompt.js";
import { parseConversationRouterAction } from "../apps/local-agent/src/openclaw-conversation-router/protocol.js";

describe("openclaw conversation router", () => {
  it("parses explicit forward_message action blocks", () => {
    const parsed = parseConversationRouterAction(`\`\`\`flow-system-action
{"action":"forward_message","target_name":"member01","forward_body":"请今天 18:00 前确认鞋面表。","task_brief_title":"确认鞋面表","task_brief_summary":"用户希望 member01 今天 18:00 前确认鞋面表。"}
\`\`\``);

    expect(parsed.used_structured_block).toBe(true);
    expect(parsed.action).toMatchObject({
      action: "forward_message",
      target_name: "member01",
      forward_body: "请今天 18:00 前确认鞋面表。",
    });
  });

  it("falls back to reply_only when OpenClaw returns free text", () => {
    const parsed = parseConversationRouterAction("可以，你把要总结的内容发我。");

    expect(parsed.used_structured_block).toBe(false);
    expect(parsed.action).toEqual({
      action: "reply_only",
      reply_text: "可以，你把要总结的内容发我。",
    });
  });

  it("falls back to reply_only when the structured block is invalid", () => {
    const parsed = parseConversationRouterAction(`\`\`\`flow-system-action
{"action":"forward_message","target_name":123}
\`\`\``);

    expect(parsed.used_structured_block).toBe(true);
    expect(parsed.action).toEqual({
      action: "reply_only",
      reply_text: "我刚才没有整理好转发指令，请再说一次，或明确告诉我要转发给谁。",
    });
  });

  it("builds a clean prompt that forbids protocol collection", () => {
    const prompt = buildConversationRouterPrompt({
      appRoot: process.cwd(),
      ownerUserId: "user_owner",
      ownerDisplayName: "景然",
      systemProjectName: "OpenClaw 会话转发",
      targets: [
        {
          user_id: "user_member01",
          username: "member01",
          display_name: "member01",
          agent_id: "agent_member01",
          online: true,
        },
      ],
      userMessage: "你知道member01是谁吗",
    });

    expect(prompt).toContain("你知道member01是谁吗");
    expect(prompt).toContain("Never ask the user to provide a protocol");
    expect(prompt).toContain("我只能根据当前可转发目标列表识别 member01");
    expect(prompt).not.toContain("???");
  });

  it("builds a repair prompt that forces a fixed target", () => {
    const prompt = buildConversationRouterRepairPrompt({
      appRoot: path.resolve(process.cwd()),
      ownerUserId: "user_owner",
      ownerDisplayName: "景然",
      systemProjectName: "OpenClaw 会话转发",
      targets: [
        {
          user_id: "user_member01",
          username: "member01",
          display_name: "member01",
          agent_id: "agent_member01",
          online: true,
        },
      ],
      userMessage: "让member01来我这",
      forcedTargetName: "member01",
    });

    expect(prompt).toContain("The fixed target is member01");
    expect(prompt).toContain("You must return forward_message");
    expect(prompt).toContain("Do not ask for any extra materials");
  });
});
