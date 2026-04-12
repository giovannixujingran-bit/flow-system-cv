"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { toTaskStatusLabel } from "../../lib/labels";
import { avatarText, TaskProgressTimeline, type OpenClawTaskProgressView } from "./task-progress";

type TaskListItem = {
  task_id: string;
  project_id: string;
  task_title: string;
  sender_user_id: string;
  assignee_user_id: string;
  assignee_display_name?: string;
  status: string;
  last_event_at: string;
  openclaw_progress?: OpenClawTaskProgressView;
};

type TasksBoardProps = {
  currentUserId: string;
  projectNameById: Record<string, string>;
  tasks: TaskListItem[];
};

type TaskViewMode = "current" | "involved";

const activeTaskStatuses = new Set(["new", "delivered", "received", "accepted", "in_progress", "waiting_review"]);

function statusTagClass(status: string): string {
  if (status === "done" || status === "archived") {
    return "status-tag status-live";
  }
  if (status === "waiting_review") {
    return "status-tag status-review";
  }
  return "status-tag status-hold";
}

function accentClass(index: number): string {
  return ["card-emerald", "card-amber", "card-sky"][index % 3] ?? "card-emerald";
}

export function TasksBoard({ currentUserId, projectNameById, tasks }: TasksBoardProps) {
  const [viewMode, setViewMode] = useState<TaskViewMode>("current");

  const visibleTasks = useMemo(() => {
    const relatedTasks = tasks.filter(
      (task) => task.assignee_user_id === currentUserId || task.sender_user_id === currentUserId,
    );
    const nextTasks = viewMode === "current"
      ? relatedTasks.filter((task) => activeTaskStatuses.has(task.status))
      : relatedTasks;

    return [...nextTasks].sort((left, right) => right.last_event_at.localeCompare(left.last_event_at));
  }, [currentUserId, tasks, viewMode]);

  return (
    <section className="task-surface glass-panel">
      <div className="task-surface-header">
        <div>
          <p className="eyebrow">Flow System Tasks</p>
          <h3>任务面板</h3>
        </div>

        <div className="task-board-summary">
          <div className="tasks-view-switch" role="tablist" aria-label="任务视图切换">
            <button
              className={viewMode === "current" ? "tasks-view-button tasks-view-button-active" : "tasks-view-button"}
              onClick={() => setViewMode("current")}
              type="button"
            >
              当前任务
            </button>
            <button
              className={viewMode === "involved" ? "tasks-view-button tasks-view-button-active" : "tasks-view-button"}
              onClick={() => setViewMode("involved")}
              type="button"
            >
              我参与的任务
            </button>
          </div>

          <Link className="primary-btn" href="/tasks/new">
            新建任务
          </Link>
        </div>
      </div>

      {visibleTasks.length > 0 ? (
        <div className="task-grid">
          {visibleTasks.map((task, index) => {
            const displayName = task.assignee_display_name ?? task.assignee_user_id;
            const projectName = projectNameById[task.project_id] ?? task.project_id;

            return (
              <article className={`task-card ${accentClass(index)}`} key={task.task_id}>
                <div className="task-card-top">
                  <p className="task-project">项目：{projectName}</p>
                  <h4>{task.task_title}</h4>

                  <div className="task-owner">
                    <span className="owner-avatar">{avatarText(displayName)}</span>
                    <div className="owner-copy">
                      <span className="owner-label">当前执行人</span>
                      <strong>{displayName}</strong>
                    </div>
                  </div>
                </div>

                <div className="task-status-block">
                  <div className="task-status-head">
                    <span>任务状态</span>
                    <span className={statusTagClass(task.status)}>
                      {task.openclaw_progress?.current_status_label ?? toTaskStatusLabel(task.status)}
                    </span>
                  </div>

                  <TaskProgressTimeline
                    task={task}
                    taskTitle={task.task_title}
                  />
                </div>

                <Link className="detail-btn" href={`/tasks/${task.task_id}`}>
                  查看详情
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="project-empty-state">当前没有匹配的任务。</div>
      )}
    </section>
  );
}
