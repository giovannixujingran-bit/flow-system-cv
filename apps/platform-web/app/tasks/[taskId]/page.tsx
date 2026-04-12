import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { ResourceDeleteButton } from "../../../components/resource-delete-button";
import { platformApiJson } from "../../../lib/api";
import { toChecklistStatusLabel, toEventTypeLabel, toRiskLevelLabel } from "../../../lib/labels";
import { avatarText, TaskProgressTimeline, type OpenClawTaskProgressView } from "../task-progress";

type TaskDetail = {
  task_id: string;
  task_title: string;
  summary: string;
  assignee_user_id: string;
  assignee_display_name?: string;
  assignee_agent_id: string;
  deadline: string;
  risk_level: string;
  project_owner_user_id?: string;
  status: string;
  last_event_at: string;
  openclaw_progress?: OpenClawTaskProgressView;
  checklist?: Array<{
    checklistItemId?: string;
    checklist_item_id?: string;
    itemTitle?: string;
    item_title?: string;
    status: string;
  }>;
};

type TaskEvent = {
  eventId: string;
  occurred_at: string;
  event_type: string;
  actor_id: string;
};

type CurrentUser = {
  user_id: string;
  role: "admin" | "owner" | "member";
};

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [task, events, currentUser] = await Promise.all([
    platformApiJson<TaskDetail>(`/api/v1/tasks/${taskId}`),
    platformApiJson<TaskEvent[]>(`/api/v1/tasks/${taskId}/events`),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!task || !currentUser) {
    redirect("/login");
  }

  const canDeleteTask =
    currentUser.role === "admin" ||
    currentUser.role === "owner" ||
    currentUser.user_id === task.project_owner_user_id;

  const assigneeDisplayName = task.assignee_display_name ?? task.assignee_user_id;
  const taskProgressModel = {
    status: task.status,
    last_event_at: task.last_event_at,
    ...(task.openclaw_progress ? { openclaw_progress: task.openclaw_progress } : {}),
  };

  return (
    <AppShell
      actions={(
        <ResourceDeleteButton
          canDelete={canDeleteTask}
          endpoint={`/api/platform/v1/tasks/${taskId}`}
          failureMessage="Task delete failed"
          redirectHref="/tasks"
          resourceLabel="任务"
          resourceName={task.task_title}
        />
      )}
      description={task.summary}
      eyebrow="Task Detail"
      title={task.task_title}
    >
      <div className="stack">
        <section className="panel detail-hero-card">
          <div className="detail-hero-top">
            <div>
              <p className="eyebrow">Task Overview</p>
              <h3>{task.task_title}</h3>
            </div>
            <span className="status-tag">{toRiskLevelLabel(task.risk_level)}</span>
          </div>
          <p className="detail-hero-description">{task.summary}</p>
        </section>

        <div className="detail-stats-grid">
          <div className="panel detail-stat-card">
            <div className="muted">执行人</div>
            <div className="task-user-chip">
              <span className="task-user-avatar">{avatarText(assigneeDisplayName)}</span>
              <span className="task-user-name">{assigneeDisplayName}</span>
            </div>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">代理</div>
            <strong>{task.assignee_agent_id}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">截止时间</div>
            <strong>{task.deadline}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">风险等级</div>
            <strong>{toRiskLevelLabel(task.risk_level)}</strong>
          </div>
        </div>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Progress</p>
              <h3>任务进度</h3>
            </div>
          </div>
          <TaskProgressTimeline task={taskProgressModel} taskTitle={task.task_title} />
        </section>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Checklist</p>
              <h3>执行清单</h3>
            </div>
          </div>
          <ul className="detail-checklist">
            {(task.checklist ?? []).map((item) => (
              <li className="detail-checklist-item" key={item.checklistItemId ?? item.checklist_item_id}>
                <span>{(item.itemTitle ?? item.item_title) ?? "-"}</span>
                <span className="detail-checklist-status">{toChecklistStatusLabel(item.status)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Timeline</p>
              <h3>时间线</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>事件</th>
                  <th>执行方</th>
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((event) => (
                  <tr key={event.eventId}>
                    <td>{event.occurred_at}</td>
                    <td>{toEventTypeLabel(event.event_type)}</td>
                    <td>{event.actor_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
