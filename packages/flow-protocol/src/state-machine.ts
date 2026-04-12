import type { BoardStatus, TaskStatus, UserRole } from "./enums.js";

import { boardStatusSchema } from "./enums.js";

const transitions: Record<TaskStatus, TaskStatus[]> = {
  new: ["delivered"],
  delivered: ["received", "invalid"],
  received: ["accepted", "invalid"],
  accepted: ["in_progress", "invalid"],
  in_progress: ["waiting_review", "invalid"],
  waiting_review: ["done", "invalid"],
  done: ["archived"],
  archived: [],
  invalid: ["archived"],
};

export const legalStartTriggers = [
  "ui.start_button",
  "checklist.first_item_completed",
  "ui.open_confirmed_start",
  "agent.start_task_action",
] as const;

export type StartTrigger = (typeof legalStartTriggers)[number];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "done" || status === "archived" || status === "invalid";
}

export function canTransitionTaskStatus(current: TaskStatus, next: TaskStatus, role: UserRole): boolean {
  if (!transitions[current].includes(next)) {
    return false;
  }

  if (current === "waiting_review" && next === "done") {
    return role === "admin" || role === "owner";
  }

  if (next === "invalid") {
    return role === "admin";
  }

  return true;
}

export function assertTaskTransition(current: TaskStatus, next: TaskStatus, role: UserRole): void {
  if (!canTransitionTaskStatus(current, next, role)) {
    throw new Error(`Illegal task transition: ${current} -> ${next} for role ${role}`);
  }
}

export function toBoardStatus(status: TaskStatus): BoardStatus {
  if (status === "accepted" || status === "in_progress") {
    return boardStatusSchema.Enum.in_progress;
  }
  if (status === "archived" || status === "invalid") {
    return boardStatusSchema.Enum.done;
  }
  return boardStatusSchema.parse(status);
}

export function requiresExplicitReview(status: TaskStatus): boolean {
  return status === "waiting_review";
}
