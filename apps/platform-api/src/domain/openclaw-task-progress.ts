import type { OpenClawTaskProgressUpsert } from "@flow-system/flow-protocol";

import { nowIso } from "../runtime.js";
import type {
  AgentRecord,
  AppState,
  OpenClawTaskProgressRecord,
  OpenClawTaskProgressStepRecord,
  TaskRecord,
} from "../types.js";

type ActorInput = {
  userId?: string;
  displayName?: string;
  source: OpenClawTaskProgressStepRecord["source"];
  happenedAt?: string;
};

type SyncTaskStatus = NonNullable<OpenClawTaskProgressUpsert["sync_task_status"]>;

function firstGlyph(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  return [...text][0];
}

function actorFromUser(state: AppState, userId: string | undefined, fallbackDisplayName: string | undefined, source: OpenClawTaskProgressStepRecord["source"], happenedAt: string | undefined): ActorInput {
  const displayName = userId ? (state.users.get(userId)?.displayName ?? fallbackDisplayName ?? userId) : fallbackDisplayName;
  return {
    ...(userId ? { userId } : {}),
    ...(displayName ? { displayName } : {}),
    source,
    ...(happenedAt ? { happenedAt } : {}),
  };
}

function stepWithActor(step: OpenClawTaskProgressStepRecord, actor: ActorInput | undefined): OpenClawTaskProgressStepRecord {
  if (!actor) {
    return step;
  }
  const avatarText = actor.displayName ? firstGlyph(actor.displayName) : undefined;
  return {
    stepIndex: step.stepIndex,
    stepLabel: step.stepLabel,
    status: step.status,
    ...(step.actorUserId ? { actorUserId: step.actorUserId } : {}),
    ...(step.actorDisplayName ? { actorDisplayName: step.actorDisplayName } : {}),
    ...(step.actorAvatarText ? { actorAvatarText: step.actorAvatarText } : {}),
    ...(step.happenedAt ? { happenedAt: step.happenedAt } : {}),
    ...(actor.userId ? { actorUserId: actor.userId } : {}),
    ...(actor.displayName ? { actorDisplayName: actor.displayName } : {}),
    ...(avatarText ? { actorAvatarText: avatarText } : {}),
    ...(actor.happenedAt ? { happenedAt: actor.happenedAt } : {}),
    source: actor.source,
  };
}

function cloneStep(step: OpenClawTaskProgressStepRecord): OpenClawTaskProgressStepRecord {
  return {
    stepIndex: step.stepIndex,
    stepLabel: step.stepLabel,
    status: step.status,
    ...(step.actorUserId ? { actorUserId: step.actorUserId } : {}),
    ...(step.actorDisplayName ? { actorDisplayName: step.actorDisplayName } : {}),
    ...(step.actorAvatarText ? { actorAvatarText: step.actorAvatarText } : {}),
    ...(step.happenedAt ? { happenedAt: step.happenedAt } : {}),
    source: step.source,
  };
}

function withStepStatus(
  step: OpenClawTaskProgressStepRecord,
  status: OpenClawTaskProgressStepRecord["status"],
): OpenClawTaskProgressStepRecord {
  return {
    ...cloneStep(step),
    status,
  };
}

function defaultSteps(): OpenClawTaskProgressStepRecord[] {
  return [
    { stepIndex: 1, stepLabel: "创建", status: "pending", source: "system" },
    { stepIndex: 2, stepLabel: "进行中", status: "pending", source: "openclaw" },
    { stepIndex: 3, stepLabel: "完成", status: "pending", source: "system" },
  ];
}

function sortSteps(steps: OpenClawTaskProgressStepRecord[]): OpenClawTaskProgressStepRecord[] {
  return [...steps].sort((left, right) => left.stepIndex - right.stepIndex);
}

function defaultSummaryForTaskStatus(task: TaskRecord): string {
  switch (task.status) {
    case "done":
    case "archived":
      return "OpenClaw 判定任务已完成并同步为完成态。";
    case "waiting_review":
      return "任务结果已回到发起方，等待确认。";
    case "received":
    case "accepted":
    case "in_progress":
      return "任务已进入执行阶段。";
    default:
      return "任务已创建并等待执行。";
  }
}

function defaultLabelForTaskStatus(task: TaskRecord): string {
  switch (task.status) {
    case "received":
    case "accepted":
    case "in_progress":
      return "进行中";
    case "waiting_review":
      return "待确认结果";
    case "done":
    case "archived":
      return "已完成";
    case "invalid":
      return "已中止";
    default:
      return "已创建";
  }
}

function activeStepIndexForTaskStatus(task: TaskRecord, steps: OpenClawTaskProgressStepRecord[], existing?: OpenClawTaskProgressRecord): number {
  if (steps.length <= 1) {
    return 1;
  }
  if (task.status === "done" || task.status === "archived" || task.status === "waiting_review") {
    return steps.length;
  }
  if (task.status === "received" || task.status === "accepted" || task.status === "in_progress") {
    const retained = existing?.activeStepIndex;
    if (retained && retained > 1 && retained < steps.length) {
      return retained;
    }
    return Math.min(2, steps.length);
  }
  return 1;
}

function createdActor(state: AppState, task: TaskRecord): ActorInput {
  return actorFromUser(state, task.senderUserId, undefined, "user", task.createdAt);
}

function assigneeActor(state: AppState, task: TaskRecord, occurredAt?: string): ActorInput {
  return actorFromUser(
    state,
    task.assigneeUserId,
    state.users.get(task.assigneeUserId)?.displayName ?? task.assigneeUserId,
    "openclaw",
    occurredAt ?? task.startedAt ?? task.receivedAt ?? task.lastEventAt,
  );
}

function senderActor(state: AppState, task: TaskRecord, occurredAt?: string): ActorInput {
  return actorFromUser(
    state,
    task.senderUserId,
    state.users.get(task.senderUserId)?.displayName ?? task.senderUserId,
    "system",
    occurredAt ?? task.completedAt ?? task.lastEventAt,
  );
}

function normalizeLinkedMessageIds(existing: string[], next?: string[]): string[] {
  return [...new Set([...existing, ...(next ?? [])])];
}

export function storeOpenClawTaskProgress(state: AppState, record: OpenClawTaskProgressRecord): OpenClawTaskProgressRecord {
  state.openClawTaskProgress.set(record.taskId, record);
  return record;
}

export function findOpenClawTaskProgressByLinkedMessageId(state: AppState, messageId: string): OpenClawTaskProgressRecord | undefined {
  for (const record of state.openClawTaskProgress.values()) {
    if (record.linkedMessageIds.includes(messageId)) {
      return record;
    }
  }
  return undefined;
}

export function createDefaultOpenClawTaskProgress(
  state: AppState,
  task: TaskRecord,
  options?: {
    linkedConversationId?: string;
    linkedMessageIds?: string[];
    decisionSummary?: string;
    currentStatusLabel?: string;
  },
): OpenClawTaskProgressRecord {
  const [createdStep, ...remainingSteps] = defaultSteps();
  if (!createdStep) {
    throw new Error("Default OpenClaw task steps are missing");
  }
  const firstStep = stepWithActor(withStepStatus(createdStep, "completed"), createdActor(state, task));
  const syncOptions: {
    forceCreate: true;
    steps: OpenClawTaskProgressStepRecord[];
    linkedConversationId?: string;
    linkedMessageIds?: string[];
    decisionSummary: string;
    currentStatusLabel: string;
  } = {
    forceCreate: true,
    steps: [firstStep, ...remainingSteps],
    decisionSummary: options?.decisionSummary ?? defaultSummaryForTaskStatus(task),
    currentStatusLabel: options?.currentStatusLabel ?? defaultLabelForTaskStatus(task),
  };
  if (options?.linkedConversationId) {
    syncOptions.linkedConversationId = options.linkedConversationId;
  }
  if (options?.linkedMessageIds) {
    syncOptions.linkedMessageIds = options.linkedMessageIds;
  }
  return syncOpenClawTaskProgressFromTask(state, task, syncOptions)!;
}

export function syncOpenClawTaskProgressFromTask(
  state: AppState,
  task: TaskRecord,
  options?: {
    forceCreate?: boolean;
    steps?: OpenClawTaskProgressStepRecord[];
    linkedConversationId?: string;
    linkedMessageIds?: string[];
    decisionSummary?: string;
    currentStatusLabel?: string;
    occurredAt?: string;
  },
): OpenClawTaskProgressRecord | undefined {
  const existing = state.openClawTaskProgress.get(task.taskId);
  if (!existing && !options?.forceCreate) {
    return undefined;
  }

  const occurredAt = options?.occurredAt ?? task.lastEventAt;
  const steps = sortSteps(options?.steps ?? existing?.steps ?? defaultSteps()).map(cloneStep);
  if (steps.length === 0) {
    return undefined;
  }

  const activeStepIndex = activeStepIndexForTaskStatus(task, steps, existing);
  const startedActor = assigneeActor(state, task, occurredAt);
  const completedActor = senderActor(state, task, occurredAt);

  const nextSteps = steps.map((step, index) => {
    if (index === 0) {
      return stepWithActor(withStepStatus(step, "completed"), createdActor(state, task));
    }

    if (task.status === "done" || task.status === "archived") {
      const actor = index === steps.length - 1 ? completedActor : startedActor;
      return stepWithActor(withStepStatus(step, "completed"), actor);
    }

    if (task.status === "waiting_review") {
      if (index < steps.length - 1) {
        return stepWithActor(withStepStatus(step, "completed"), startedActor);
      }
      return stepWithActor(withStepStatus(step, "active"), completedActor);
    }

    if (task.status === "received" || task.status === "accepted" || task.status === "in_progress") {
      if (step.stepIndex < activeStepIndex) {
        return stepWithActor(withStepStatus(step, "completed"), startedActor);
      }
      if (step.stepIndex === activeStepIndex) {
        return stepWithActor(withStepStatus(step, "active"), startedActor);
      }
      return withStepStatus(step, "pending");
    }

    return withStepStatus(step, step.stepIndex === 1 ? "completed" : "pending");
  });

  const record: OpenClawTaskProgressRecord = {
    taskId: task.taskId,
    linkedMessageIds: normalizeLinkedMessageIds(existing?.linkedMessageIds ?? [], options?.linkedMessageIds),
    steps: nextSteps,
    activeStepIndex,
    currentStatusLabel: options?.currentStatusLabel ?? defaultLabelForTaskStatus(task),
    lastDecisionSummary: options?.decisionSummary ?? existing?.lastDecisionSummary ?? defaultSummaryForTaskStatus(task),
    updatedAt: occurredAt,
  };
  const linkedConversationId = options?.linkedConversationId ?? existing?.linkedConversationId;
  if (linkedConversationId) {
    record.linkedConversationId = linkedConversationId;
  }

  return storeOpenClawTaskProgress(state, record);
}

export function upsertOpenClawTaskProgressFromPayload(
  state: AppState,
  task: TaskRecord,
  payload: OpenClawTaskProgressUpsert,
): OpenClawTaskProgressRecord {
  const steps = sortSteps(
    payload.steps.map((step) => {
      const record: OpenClawTaskProgressStepRecord = {
        stepIndex: step.step_index,
        stepLabel: step.step_label,
        status: step.status,
        source: step.source,
      };
      if (step.actor_user_id) {
        record.actorUserId = step.actor_user_id;
      }
      if (step.actor_display_name) {
        record.actorDisplayName = step.actor_display_name;
      }
      if (step.actor_avatar_text) {
        record.actorAvatarText = step.actor_avatar_text;
      } else if (step.actor_display_name) {
        const avatarText = firstGlyph(step.actor_display_name);
        if (avatarText) {
          record.actorAvatarText = avatarText;
        }
      }
      if (step.happened_at) {
        record.happenedAt = step.happened_at;
      }
      return record;
    }),
  );

  const record: OpenClawTaskProgressRecord = {
    taskId: task.taskId,
    ...(payload.linked_conversation_id ? { linkedConversationId: payload.linked_conversation_id } : {}),
    linkedMessageIds: normalizeLinkedMessageIds(
      state.openClawTaskProgress.get(task.taskId)?.linkedMessageIds ?? [],
      payload.linked_message_id ? [payload.linked_message_id] : [],
    ),
    steps,
    activeStepIndex: payload.active_step_index,
    currentStatusLabel: payload.current_status_label,
    lastDecisionSummary: payload.decision_summary,
    updatedAt: nowIso(),
  };

  return storeOpenClawTaskProgress(state, record);
}

export function syncTaskStatusFromOpenClaw(task: TaskRecord, nextStatus: SyncTaskStatus, occurredAt: string): void {
  if (nextStatus === "new") {
    return;
  }

  if (nextStatus === "in_progress") {
    task.status = "in_progress";
    task.startedAt = task.startedAt ?? occurredAt;
    delete task.completedAt;
    if (task.progressPercent >= 100) {
      task.progressPercent = 75;
    }
  }

  if (nextStatus === "done") {
    task.status = "done";
    task.startedAt = task.startedAt ?? occurredAt;
    task.completedAt = occurredAt;
    task.progressPercent = 100;
  }

  task.lastEventAt = occurredAt;
  task.updatedAt = nowIso();
}

function looksLikeQuestion(text: string): boolean {
  return /[?？]|\b(need|clarify|question|whether|can you|should)\b|是否|能否|可以先|请补充|还需要|想确认|澄清/u.test(text);
}

function looksLikePartialProgress(text: string): boolean {
  return /\b(wip|partial|draft|preliminary|still|ongoing)\b|部分|初稿|还在|正在|稍后|一部分|先给你/u.test(text);
}

function looksLikeCompletedReply(text: string): boolean {
  return /\b(done|completed|delivered|finished|attached|result)\b|已完成|完成了|已交付|交付如下|结果如下|请查收|已经整理好|报告如下/u.test(text);
}

export function classifyOpenClawReplyCompletion(task: TaskRecord, replyBody: string): { completed: boolean; confidence: number; decisionSummary: string } {
  const normalized = replyBody.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      completed: false,
      confidence: 0,
      decisionSummary: `OpenClaw 返回了空结果，未将任务“${task.taskTitle}”标记为完成。`,
    };
  }

  if (looksLikeQuestion(normalized) || looksLikePartialProgress(normalized)) {
    return {
      completed: false,
      confidence: 0.25,
      decisionSummary: `OpenClaw 已回复，但内容更像澄清或阶段性进展，任务“${task.taskTitle}”继续保持处理中。`,
    };
  }

  if (looksLikeCompletedReply(normalized) || normalized.length >= 80) {
    return {
      completed: true,
      confidence: normalized.length >= 80 ? 0.85 : 0.92,
      decisionSummary: `OpenClaw 已交付“${task.taskTitle}”的结果，任务自动同步为完成。`,
    };
  }

  return {
    completed: false,
    confidence: 0.5,
    decisionSummary: `OpenClaw 已回复“${task.taskTitle}”，但尚不足以判定为最终交付。`,
  };
}

export function markOpenClawConversationProgress(
  state: AppState,
  task: TaskRecord,
  input: {
    stage: "received" | "processing" | "failed" | "replied" | "completed";
    occurredAt: string;
    agent?: AgentRecord;
    linkedMessageId?: string;
    currentStatusLabel: string;
    decisionSummary: string;
  },
): OpenClawTaskProgressRecord {
  const existing = state.openClawTaskProgress.get(task.taskId) ?? createDefaultOpenClawTaskProgress(state, task);
  const steps = sortSteps(existing.steps).map(cloneStep);
  const assigneeDisplayName = input.agent ? (state.users.get(input.agent.ownerUserId)?.displayName ?? input.agent.ownerUserId) : undefined;
  const assignee = input.agent
    ? actorFromUser(state, input.agent.ownerUserId, assigneeDisplayName, "openclaw", input.occurredAt)
    : assigneeActor(state, task, input.occurredAt);

  if (steps.length === 1) {
    const onlyStep = steps[0];
    if (!onlyStep) {
      throw new Error("OpenClaw task progress step is missing");
    }
    steps[0] = stepWithActor(withStepStatus(onlyStep, input.stage === "completed" ? "completed" : "active"), assignee);
  } else if (input.stage === "completed") {
    for (let index = 0; index < steps.length; index += 1) {
      const currentStep = steps[index];
      if (!currentStep) {
        continue;
      }
      const actor = index === steps.length - 1 ? senderActor(state, task, input.occurredAt) : assignee;
      steps[index] = stepWithActor(withStepStatus(currentStep, "completed"), actor);
    }
    syncTaskStatusFromOpenClaw(task, "done", input.occurredAt);
  } else {
    const firstStep = steps[0];
    if (!firstStep) {
      throw new Error("OpenClaw task progress step is missing");
    }
    steps[0] = stepWithActor(withStepStatus(firstStep, "completed"), createdActor(state, task));
    for (let index = 1; index < steps.length; index += 1) {
      const currentStep = steps[index];
      if (!currentStep) {
        continue;
      }
      steps[index] = withStepStatus(currentStep, index === 1 ? "active" : "pending");
    }
    const activeStep = steps[1];
    if (activeStep) {
      steps[1] = stepWithActor(activeStep, assignee);
    }
    syncTaskStatusFromOpenClaw(task, "in_progress", input.occurredAt);
  }

  const record: OpenClawTaskProgressRecord = {
    ...existing,
    linkedMessageIds: normalizeLinkedMessageIds(existing.linkedMessageIds, input.linkedMessageId ? [input.linkedMessageId] : []),
    steps,
    activeStepIndex: input.stage === "completed" ? steps.length : Math.min(2, steps.length),
    currentStatusLabel: input.currentStatusLabel,
    lastDecisionSummary: input.decisionSummary,
    updatedAt: input.occurredAt,
  };

  return storeOpenClawTaskProgress(state, record);
}
