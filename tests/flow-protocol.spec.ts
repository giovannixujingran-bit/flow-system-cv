import { describe, expect, it } from "vitest";

import {
  assertTaskTransition,
  eventEnvelopeSchema,
  makeId,
  taskDeliveryRequestSchema,
  toBoardStatus,
} from "@flow-system/flow-protocol";

describe("flow protocol", () => {
  it("creates prefixed ids", () => {
    expect(makeId("task")).toMatch(/^task_[0-9a-z]+$/);
  });

  it("accepts a valid task delivery request", () => {
    const parsed = taskDeliveryRequestSchema.parse({
      request_id: makeId("req"),
      project_id: makeId("proj"),
      workflow_id: makeId("wf"),
      step_id: makeId("wf"),
      task_title: "Excel revise",
      task_type: "excel_handoff",
      sender_user_id: makeId("user"),
      target_user_id: makeId("user"),
      target_agent_id: makeId("agent"),
      priority: "high",
      deadline: "2026-03-10T18:00:00+08:00",
      summary: "Update sheet 2.",
      attachment_file_ids: [makeId("file")],
      constraints: [],
      deliverables: [],
      plan_mode: "structured",
    });

    expect(parsed.priority).toBe("high");
  });

  it("validates event envelopes", () => {
    const parsed = eventEnvelopeSchema.parse({
      request_id: makeId("req"),
      event_type: "task.received",
      task_id: makeId("task"),
      project_id: makeId("proj"),
      actor_type: "agent",
      actor_id: makeId("agent"),
      payload: {
        local_task_path: "C:/Users/me/FlowCard/tasks/task_1",
      },
      occurred_at: "2026-03-09T11:00:00+08:00",
    });

    expect(parsed.event_type).toBe("task.received");
  });

  it("accepts agent heartbeat events without task scope", () => {
    const parsed = eventEnvelopeSchema.parse({
      request_id: makeId("req"),
      event_type: "agent.heartbeat",
      actor_type: "agent",
      actor_id: makeId("agent"),
      source_agent_id: makeId("agent"),
      payload: {
        status: "online",
      },
      occurred_at: "2026-03-09T11:00:00+08:00",
    });

    expect(parsed.event_type).toBe("agent.heartbeat");
    expect(parsed.task_id).toBeUndefined();
  });

  it("enforces review transitions", () => {
    expect(() => assertTaskTransition("waiting_review", "done", "member")).toThrow();
    expect(() => assertTaskTransition("waiting_review", "done", "owner")).not.toThrow();
  });

  it("collapses accepted and in_progress to the same board column", () => {
    expect(toBoardStatus("accepted")).toBe("in_progress");
    expect(toBoardStatus("in_progress")).toBe("in_progress");
  });
});
