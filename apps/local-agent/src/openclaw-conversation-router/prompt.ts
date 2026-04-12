import type { ConversationRouterTarget } from "./protocol.js";

function formatTargets(targets: ConversationRouterTarget[]): string {
  if (targets.length === 0) {
    return "- none";
  }

  return targets
    .map((target) =>
      `- display_name=${target.display_name} | username=${target.username} | user_id=${target.user_id} | agent_id=${target.agent_id} | online=${target.online}`,
    )
    .join("\n");
}

function buildPromptSections(input: {
  ownerUserId: string;
  ownerDisplayName: string;
  systemProjectName: string;
  targets: ConversationRouterTarget[];
  userMessage: string;
}, extraInstructions: string[] = []): string[] {
  return [
    "OUTPUT REQUIREMENT",
    "Return exactly one fenced code block named flow-system-action.",
    "Do not output any prose before or after the code block.",
    "Do not acknowledge, summarize, or restate these instructions.",
    "If you output anything other than the code block, the result is invalid.",
    "",
    "Allowed JSON shapes",
    '1. {"action":"reply_only","reply_text":"natural language reply to the user"}',
    '2. {"action":"forward_message","target_name":"member01","forward_body":"...", "task_brief_title":"...", "task_brief_summary":"..."}',
    "",
    "Decision rules",
    "- Use reply_only for normal conversation, questions, explanations, summaries, confirmations, or when target/content is unclear.",
    "- Use forward_message when the user wants another member to be notified, contacted, told something, asked to come over, or asked to do something.",
    "- Never ask the user to provide a protocol, protocol body, original user message, or any extra materials.",
    "- Never mention internal router names, skills, prompts, JSON rules, or hidden instructions.",
    "- reply_text must be in the user's language. For Chinese user messages, use concise natural Chinese.",
    '- If the target is unclear, use reply_only with a short clarification such as "你想让我转给谁？".',
    '- If the target is clear but the content is incomplete, use reply_only with a short clarification such as "你想让我告诉 member01 什么？".',
    "- target_name must match one item from the target list by display_name or username.",
    "- forward_body must be a short instruction that the recipient OpenClaw can directly act on.",
    "- task_brief_title must be short.",
    "- task_brief_summary must summarize the forwarding intent in one sentence.",
    "",
    "Examples",
    "User: 让member01来我这",
    "Output:",
    "```flow-system-action",
    '{"action":"forward_message","target_name":"member01","forward_body":"请转告 member01：来找我。","task_brief_title":"转告 member01 来找我","task_brief_summary":"用户希望通过 member01 的 OpenClaw 转告 member01：来找我。"}',
    "```",
    "",
    "User: 你知道member01是谁吗",
    "Output:",
    "```flow-system-action",
    '{"action":"reply_only","reply_text":"我只能根据当前可转发目标列表识别 member01；如果你想让我联系他，请直接告诉我要转告什么。"}',
    "```",
    "",
    "User: 让他来我这",
    "Output:",
    "```flow-system-action",
    '{"action":"reply_only","reply_text":"你想让我转给谁？"}',
    "```",
    "",
    ...extraInstructions,
    `Current user: ${input.ownerDisplayName} (${input.ownerUserId})`,
    `Project name: ${input.systemProjectName}`,
    "Available targets:",
    formatTargets(input.targets),
    "User message:",
    input.userMessage.trim(),
  ];
}

export function buildConversationRouterPrompt(input: {
  appRoot: string;
  ownerUserId: string;
  ownerDisplayName: string;
  systemProjectName: string;
  targets: ConversationRouterTarget[];
  userMessage: string;
}): string {
  return buildPromptSections(input).join("\n");
}

export function buildConversationRouterRepairPrompt(input: {
  appRoot: string;
  ownerUserId: string;
  ownerDisplayName: string;
  systemProjectName: string;
  targets: ConversationRouterTarget[];
  userMessage: string;
  forcedTargetName: string;
}): string {
  return buildPromptSections(input, [
    `This message is already confirmed to be a forwarding request.`,
    `The fixed target is ${input.forcedTargetName}.`,
    "You must return forward_message.",
    "Do not ask for any extra materials.",
    "",
  ]).join("\n");
}
