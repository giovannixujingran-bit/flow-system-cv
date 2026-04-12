import { toTaskStatusLabel } from "../../lib/labels";

export type OpenClawTaskProgressStepView = {
  step_index: number;
  step_label: string;
  status: "completed" | "active" | "pending";
  actor_user_id?: string;
  actor_display_name?: string;
  actor_avatar_text?: string;
  happened_at?: string;
  source: "openclaw" | "user" | "system";
};

export type OpenClawTaskProgressView = {
  linked_conversation_id?: string;
  active_step_index: number;
  current_status_label: string;
  updated_at: string;
  steps: OpenClawTaskProgressStepView[];
};

export type TaskProgressTaskLike = {
  status: string;
  last_event_at: string;
  openclaw_progress?: OpenClawTaskProgressView;
};

type ProgressStep = {
  key: string;
  marker: string;
  title: string;
  tone: "done" | "active" | "pending";
  statusLabel: string;
  metaLabel?: string | undefined;
  actorDisplayName?: string | undefined;
  actorAvatarText?: string | undefined;
};

const placeholderBlueprint = [
  { key: "created", title: "创建" },
  { key: "delivered", title: "派发" },
  { key: "received", title: "接收" },
  { key: "in_progress", title: "执行" },
  { key: "waiting_review", title: "审核" },
] as const;

const activeStepIndexByStatus: Record<string, number> = {
  new: 0,
  delivered: 1,
  received: 2,
  accepted: 2,
  in_progress: 3,
  waiting_review: 4,
};

export function avatarText(value: string, fallback = "人"): string {
  const text = value.trim();
  return text ? [...text][0] ?? fallback : fallback;
}

export function formatTaskEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildPlaceholderSteps(task: TaskProgressTaskLike): ProgressStep[] {
  const activeIndex = task.status === "done" || task.status === "archived"
    ? placeholderBlueprint.length
    : activeStepIndexByStatus[task.status] ?? 0;

  return placeholderBlueprint.map((step, index) => {
    let tone: ProgressStep["tone"] = "pending";
    if (task.status === "done" || task.status === "archived") {
      tone = "done";
    } else if (index < activeIndex) {
      tone = "done";
    } else if (index === activeIndex) {
      tone = "active";
    }

    return {
      key: step.key,
      marker: tone === "done" ? "✓" : String(index + 1),
      title: step.title,
      tone,
      statusLabel:
        tone === "active"
          ? toTaskStatusLabel(task.status)
          : tone === "done"
            ? "已完成"
            : "待开始",
      metaLabel: tone === "active" ? formatTaskEventTime(task.last_event_at) : undefined,
    };
  });
}

function buildOpenClawSteps(progress: OpenClawTaskProgressView): ProgressStep[] {
  return [...progress.steps]
    .sort((left, right) => left.step_index - right.step_index)
    .map((step, index) => ({
      key: `openclaw-step-${step.step_index}`,
      marker: step.status === "completed" ? "✓" : String(step.step_index || index + 1),
      title: step.step_label,
      tone: step.status === "completed" ? "done" : step.status,
      statusLabel:
        step.status === "active"
          ? progress.current_status_label
          : step.status === "completed"
            ? "已完成"
            : "待开始",
      metaLabel: step.happened_at ? formatTaskEventTime(step.happened_at) : undefined,
      actorDisplayName: step.actor_display_name,
      actorAvatarText: step.actor_avatar_text ?? (step.actor_display_name ? avatarText(step.actor_display_name) : undefined),
    }));
}

export function buildTaskProgressSteps(task: TaskProgressTaskLike): ProgressStep[] {
  if (task.openclaw_progress?.steps.length) {
    return buildOpenClawSteps(task.openclaw_progress);
  }
  return buildPlaceholderSteps(task);
}

function stepToneClass(tone: ProgressStep["tone"]): string {
  if (tone === "done") {
    return "task-step done";
  }
  if (tone === "active") {
    return "task-step active";
  }
  return "task-step";
}

function stepPillClass(tone: ProgressStep["tone"]): string {
  if (tone === "done") {
    return "step-pill done";
  }
  if (tone === "active") {
    return "step-pill active";
  }
  return "step-pill";
}

export function TaskProgressTimeline({
  taskTitle,
  task,
}: {
  taskTitle: string;
  task: TaskProgressTaskLike;
}) {
  const steps = buildTaskProgressSteps(task);

  return (
    <div className="task-status-list" aria-label={`${taskTitle} 任务时间轴`}>
      {steps.map((step) => (
        <div className={stepToneClass(step.tone)} key={step.key}>
          <div className="task-step-marker">
            <span>{step.marker}</span>
          </div>
          <div className="task-step-copy">
            <p className="task-step-title">{step.title}</p>
            <div className="task-step-meta">
              <span className={stepPillClass(step.tone)}>{step.statusLabel}</span>
              {step.actorDisplayName ? (
                <>
                  <span className="owner-avatar small">{step.actorAvatarText ?? avatarText(step.actorDisplayName)}</span>
                  <span>{step.actorDisplayName}</span>
                </>
              ) : null}
              {step.metaLabel ? <span>{step.metaLabel}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
