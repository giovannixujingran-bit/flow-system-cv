import type { AgentRecord, HeartbeatRecord, RiskRecordStored, TaskRecord } from "../types.js";

import { makeId } from "@flow-system/flow-protocol";

type ActiveHoursConfig = {
  heartbeatOfflineSeconds: number;
  staleMinutes: number;
  activeHoursStart: string;
  activeHoursEnd: string;
  activeWeekdays: number[];
};

function parseMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function isWithinActiveHours(now: Date, config: ActiveHoursConfig): boolean {
  if (!config.activeWeekdays.includes(now.getDay())) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= parseMinutes(config.activeHoursStart) && currentMinutes <= parseMinutes(config.activeHoursEnd);
}

function minutesSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 60000;
}

export function evaluateRisks(
  tasks: TaskRecord[],
  heartbeats: Map<string, HeartbeatRecord>,
  agents: Map<string, AgentRecord>,
  config: ActiveHoursConfig,
  now = new Date(),
): RiskRecordStored[] {
  const next: RiskRecordStored[] = [];
  const activeWindow = isWithinActiveHours(now, config);

  for (const task of tasks) {
    const existingCodes = new Set<string>();

    if (!["done", "archived", "invalid"].includes(task.status) && new Date(task.deadline) < now) {
      existingCodes.add("overdue");
      next.push({
        riskRecordId: makeId("evt"),
        taskId: task.taskId,
        riskCode: "overdue",
        riskLevel: "high",
        details: "Task deadline has passed and the task is still active.",
        detectedAt: now.toISOString(),
      });
    }

    if (activeWindow && ["in_progress", "waiting_review"].includes(task.status) && minutesSince(task.lastEventAt, now) >= config.staleMinutes) {
      existingCodes.add("stale");
      next.push({
        riskRecordId: makeId("evt"),
        taskId: task.taskId,
        riskCode: "stale",
        riskLevel: "medium",
        details: "Task has not emitted a new event during active hours.",
        detectedAt: now.toISOString(),
      });
    }

    const heartbeat = heartbeats.get(task.assigneeAgentId);
    const agent = agents.get(task.assigneeAgentId);
    const lastHeartbeatIso = heartbeat?.occurredAt ?? agent?.lastHeartbeatAt;
    if (lastHeartbeatIso) {
      const secondsSinceHeartbeat = (now.getTime() - new Date(lastHeartbeatIso).getTime()) / 1000;
      if (secondsSinceHeartbeat >= config.heartbeatOfflineSeconds) {
        existingCodes.add("agent-offline");
        next.push({
          riskRecordId: makeId("evt"),
          taskId: task.taskId,
          riskCode: "agent-offline",
          riskLevel: "critical",
          details: "Assigned agent heartbeat is stale.",
          detectedAt: now.toISOString(),
        });
      }
    }
  }

  return next;
}
