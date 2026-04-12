function supportedActionsList(): string {
  return [
    "- create_task",
    "- update_task",
    "- delete_task",
    "- get_task",
    "- list_tasks",
    "- create_project",
    "- update_project",
    "- delete_project",
    "- get_project",
    "- get_project_progress",
  ].join("\n");
}

export function buildFlowSystemOperatorPrompt(input: {
  ownerUserId: string;
  ownerDisplayName: string;
  currentTimeIso: string;
  userMessage: string;
}): string {
  return [
    "OUTPUT REQUIREMENT",
    "Return exactly one fenced code block named flow-system-operator-action.",
    "Do not output any prose before or after the code block.",
    "Do not claim any operation already succeeded. You are only planning one action object.",
    "",
    "Allowed action values",
    supportedActionsList(),
    "",
    "Rules",
    "- Convert the user's request into exactly one action.",
    "- Keep only fields that are useful for the chosen action.",
    "- Always include original_request.",
    "- If the user gives a relative deadline such as today, tomorrow, this afternoon, or 3pm, convert it into an absolute ISO 8601 datetime with timezone offset.",
    "- Use the user's local timezone for that conversion.",
    "- For delete confirmations, set confirmed=true only when the user explicitly says the exact confirmation phrase, and include confirmation_text exactly as spoken.",
    "- If the user asks for project progress or asks what stage a project is at, use get_project_progress.",
    "- If the user asks for a task or project status by name or id, use get_task or get_project.",
    "- If the user asks to list tasks for a project, assignee, or status, use list_tasks.",
    "- Never invent task ids, project ids, deadlines, or assignee names that are not supported by the user message.",
    "",
    "Example",
    "```flow-system-operator-action",
    '{"action":"create_task","original_request":"帮我新建一个任务，项目是新项目，让泽阳做一份 SS26 裙子趋势报告，并在 2026-03-18T15:00:00+08:00 前给我","project_name":"新项目","assignee_name":"泽阳","task_title":"SS26 裙子趋势报告","task_summary":"让泽阳做一份 SS26 裙子趋势报告，并在今天下午 3 点前给我","task_deadline":"2026-03-18T15:00:00+08:00","task_deliverables":["SS26 裙子趋势报告"]}',
    "```",
    "",
    `Current local time: ${input.currentTimeIso}`,
    "User timezone: Asia/Shanghai",
    `Current user: ${input.ownerDisplayName} (${input.ownerUserId})`,
    "User message:",
    input.userMessage.trim(),
  ].join("\n");
}
