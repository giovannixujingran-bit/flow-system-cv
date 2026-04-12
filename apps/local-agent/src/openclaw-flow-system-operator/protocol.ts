import { z } from "zod";

export const flowSystemOperatorActionNames = [
  "create_task",
  "update_task",
  "delete_task",
  "get_task",
  "list_tasks",
  "create_project",
  "update_project",
  "delete_project",
  "get_project",
  "get_project_progress",
] as const;

export const flowSystemOperatorActionSchema = z.object({
  action: z.enum(flowSystemOperatorActionNames),
  original_request: z.string().trim().min(1).optional(),
  project_name: z.string().trim().min(1).optional(),
  project_id: z.string().trim().min(1).optional(),
  project_description: z.string().trim().min(1).optional(),
  project_owner_name: z.string().trim().min(1).optional(),
  project_priority: z.string().trim().min(1).optional(),
  project_status: z.string().trim().min(1).optional(),
  project_type: z.string().trim().min(1).optional(),
  department: z.string().trim().min(1).optional(),
  participant_names: z.array(z.string().trim().min(1)).optional(),
  start_date: z.string().trim().min(1).optional(),
  due_date: z.string().trim().min(1).optional(),
  task_id: z.string().trim().min(1).optional(),
  task_name: z.string().trim().min(1).optional(),
  task_title: z.string().trim().min(1).optional(),
  task_summary: z.string().trim().min(1).optional(),
  task_priority: z.string().trim().min(1).optional(),
  task_type: z.string().trim().min(1).optional(),
  task_deadline: z.string().trim().min(1).optional(),
  task_deliverables: z.array(z.string().trim().min(1)).optional(),
  task_constraints: z.array(z.string().trim().min(1)).optional(),
  assignee_name: z.string().trim().min(1).optional(),
  assignee_user_id: z.string().trim().min(1).optional(),
  assignee_agent_id: z.string().trim().min(1).optional(),
  workflow_id: z.string().trim().min(1).optional(),
  workflow_step_id: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  confirmed: z.boolean().optional(),
  confirmation_text: z.string().trim().min(1).optional(),
});

export const flowSystemOperatorScriptResultSchema = z.object({
  ok: z.boolean(),
  action: z.string().trim().min(1),
  executed: z.boolean(),
  message: z.string(),
  requires_confirmation: z.boolean(),
  requires_clarification: z.boolean(),
  confirmation_text: z.string().nullable(),
  candidates: z.array(z.string()),
  data: z.record(z.string(), z.unknown()),
  links: z.record(z.string(), z.string()),
});

export type FlowSystemOperatorAction = z.infer<typeof flowSystemOperatorActionSchema>;
export type FlowSystemOperatorScriptResult = z.infer<typeof flowSystemOperatorScriptResultSchema>;

export type ParsedFlowSystemOperatorAction = {
  raw_text: string;
  action: FlowSystemOperatorAction | null;
  used_structured_block: boolean;
};

const actionBlockPattern = /```flow-system-operator-action\s*([\s\S]*?)```/i;

export function parseFlowSystemOperatorAction(responseText: string): ParsedFlowSystemOperatorAction {
  const rawText = responseText.trim();
  const match = rawText.match(actionBlockPattern);

  if (!match) {
    return {
      raw_text: rawText,
      action: null,
      used_structured_block: false,
    };
  }

  try {
    const actionBlock = match[1];
    if (!actionBlock) {
      throw new Error("Missing flow-system-operator-action body");
    }

    return {
      raw_text: rawText,
      action: flowSystemOperatorActionSchema.parse(JSON.parse(actionBlock.trim()) as unknown),
      used_structured_block: true,
    };
  } catch {
    return {
      raw_text: rawText,
      action: null,
      used_structured_block: true,
    };
  }
}
