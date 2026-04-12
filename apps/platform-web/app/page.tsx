import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "../components/app-shell";
import { platformApiJson } from "../lib/api";
import { toAgentStatusLabel, toEventTypeLabel, toTaskStatusLabel } from "../lib/labels";

type DashboardResponse = {
  project_count: number;
  today_new_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  done_today: number;
  online_agents: number;
  recent_events: Array<{
    eventId: string;
    occurred_at: string;
    event_type: string;
    actor_id: string;
    task_id?: string;
  }>;
};

type TaskListItem = {
  task_id: string;
  project_id: string;
  task_title: string;
  status: string;
  deadline?: string;
  last_event_at: string;
};

type ProjectListItem = {
  projectId: string;
  projectName: string;
  currentStage: string;
  status: string;
  ownerDisplayName: string;
};

type AgentListItem = {
  agent_id: string;
  owner_user_id: string;
  agent_name: string;
  status: string;
  machine_name: string;
  runtime_version: string;
};

type CurrentUser = {
  user_id: string;
};

const activeStatuses = new Set(["new", "delivered", "received", "accepted", "in_progress", "waiting_review"]);
const pendingStatuses = new Set(["new", "delivered", "received", "accepted", "waiting_review"]);

function toProjectStatusText(status: string, currentStage: string): string {
  switch (status) {
    case "not_started":
      return "未启动";
    case "in_progress":
      return "进行中";
    case "paused":
      return "暂停";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return currentStage || status;
  }
}

function toProjectStatusTone(status: string): string {
  if (status === "done") {
    return "status-tag status-live";
  }
  if (status === "paused" || status === "cancelled") {
    return "status-tag status-hold";
  }
  if (status === "in_progress") {
    return "status-tag status-review";
  }
  return "status-tag";
}

function formatShortTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }

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

export default async function DashboardPage() {
  const [dashboard, tasks, projects, agents, currentUser] = await Promise.all([
    platformApiJson<DashboardResponse>("/api/v1/dashboard"),
    platformApiJson<TaskListItem[]>("/api/v1/tasks"),
    platformApiJson<ProjectListItem[]>("/api/v1/projects"),
    platformApiJson<AgentListItem[]>("/api/v1/agents"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!dashboard || !tasks || !projects || !agents || !currentUser) {
    redirect("/login");
  }

  const projectNameById = Object.fromEntries(projects.map((project) => [project.projectId, project.projectName]));
  const focusTasks = [...tasks]
    .filter((task) => activeStatuses.has(task.status))
    .sort((left, right) => {
      const leftTime = left.deadline ?? left.last_event_at;
      const rightTime = right.deadline ?? right.last_event_at;
      return leftTime.localeCompare(rightTime);
    })
    .slice(0, 5);
  const focusProjects = projects.slice(0, 3);
  const localAgent = agents
    .filter((agent) => agent.owner_user_id === currentUser.user_id)
    .sort((left, right) => right.agent_name.localeCompare(left.agent_name))[0];
  const todayPendingCount = tasks.filter((task) => pendingStatuses.has(task.status)).length;

  return (
    <AppShell eyebrow="Dashboard" title="工作看板">
      <section className="dashboard-surface glass-panel">
        <div className="dashboard-surface-header">
          <div>
            <p className="eyebrow">Personal Workspace</p>
            <h3>今天我该做什么</h3>
          </div>
          <div className="dashboard-header-badges">
            <div className="board-badge">数据密集总览</div>
          </div>
        </div>

        <div className="dashboard-kpi-grid">
          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-label">今日待办</p>
            <div className="dashboard-kpi-main">
              <strong>{String(todayPendingCount).padStart(2, "0")}</strong>
              <span className="dashboard-kpi-chip">{dashboard.overdue_tasks} 项临近截止</span>
            </div>
            <p className="dashboard-kpi-meta">优先处理今天截止和等待确认的任务。</p>
          </article>

          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-label">进行中任务</p>
            <div className="dashboard-kpi-main">
              <strong>{String(dashboard.in_progress_tasks).padStart(2, "0")}</strong>
              <span className="dashboard-kpi-chip">{dashboard.done_today} 项今日完成</span>
            </div>
            <p className="dashboard-kpi-meta">当前推进重点集中在进行中的设计、执行和协作任务。</p>
          </article>

          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-label">代理状态</p>
            <div className="dashboard-kpi-main">
              <strong>{localAgent ? toAgentStatusLabel(localAgent.status) : "未接入"}</strong>
              <span className="dashboard-kpi-chip">
                {localAgent ? localAgent.machine_name : `${dashboard.online_agents} 台在线代理`}
              </span>
            </div>
            <p className="dashboard-kpi-meta">
              {localAgent ? `当前本机代理运行版本 ${localAgent.runtime_version}` : "当前账号还没有绑定本机代理。"}
            </p>
          </article>
        </div>

        <div className="dashboard-main-grid">
          <section className="dashboard-panel dashboard-action-panel">
            <div className="dashboard-panel-head">
              <div>
                <p className="eyebrow">Task List</p>
                <h4>任务列表</h4>
              </div>
              <span className="dashboard-panel-note">按截止时间排序</span>
            </div>

            <div className="dashboard-action-table-wrap">
              <table className="dashboard-action-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>项目</th>
                    <th>当前状态</th>
                    <th>截止时间</th>
                    <th>快速跳转</th>
                  </tr>
                </thead>
                <tbody>
                  {focusTasks.length > 0 ? (
                    focusTasks.map((task) => (
                      <tr key={task.task_id}>
                        <td>
                          <strong>{task.task_title}</strong>
                        </td>
                        <td>{projectNameById[task.project_id] ?? task.project_id}</td>
                        <td>
                          <span className="table-pill info">{toTaskStatusLabel(task.status)}</span>
                        </td>
                        <td>{formatShortTime(task.deadline ?? task.last_event_at)}</td>
                        <td>
                          <Link className="dashboard-link-btn" href={`/tasks/${task.task_id}`}>
                            进入任务
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="muted">
                        当前没有需要优先处理的活跃任务。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="dashboard-side-stack">
            <section className="dashboard-panel dashboard-focus-panel">
              <div className="dashboard-panel-head">
                <div>
                  <p className="eyebrow">Project Focus</p>
                  <h4>我的项目焦点</h4>
                </div>
              </div>

              <div className="dashboard-project-list">
                {focusProjects.length > 0 ? (
                  focusProjects.map((project) => (
                    <Link className="dashboard-project-item" href={`/projects/${project.projectId}`} key={project.projectId}>
                      <div className="dashboard-project-top">
                        <strong>{project.projectName}</strong>
                        <span className={toProjectStatusTone(project.status)}>
                          {toProjectStatusText(project.status, project.currentStage)}
                        </span>
                      </div>
                      <div className="dashboard-project-meta">
                        <span>当前阶段 {project.currentStage}</span>
                        <span>负责人 {project.ownerDisplayName}</span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="empty-state">当前没有项目焦点数据。</div>
                )}
              </div>
            </section>

            <section className="dashboard-panel dashboard-agent-panel">
              <div className="dashboard-panel-head">
                <div>
                  <p className="eyebrow">Agent Snapshot</p>
                  <h4>OpenClaw 代理快照</h4>
                </div>
              </div>

              <div className="dashboard-agent-list">
                <div className="dashboard-agent-row">
                  <span>当前状态</span>
                  <strong>{localAgent ? toAgentStatusLabel(localAgent.status) : "未接入"}</strong>
                </div>
                <div className="dashboard-agent-row">
                  <span>代理名称</span>
                  <strong>{localAgent?.agent_name ?? "-"}</strong>
                </div>
                <div className="dashboard-agent-row">
                  <span>机器名称</span>
                  <strong>{localAgent?.machine_name ?? "-"}</strong>
                </div>
                <div className="dashboard-agent-row">
                  <span>运行版本</span>
                  <strong>{localAgent?.runtime_version ?? "-"}</strong>
                </div>
              </div>

              <div className="dashboard-agent-actions">
                <Link className="dashboard-link-btn" href="/agents">
                  进入代理页
                </Link>
              </div>
            </section>
          </div>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-feed-panel">
            <div className="dashboard-panel-head">
              <div>
                <p className="eyebrow">Recent Activity</p>
                <h4>最近动态</h4>
              </div>
              <span className="dashboard-panel-note">最近 5 条</span>
            </div>

            <div className="dashboard-feed-wrap">
              <table className="dashboard-feed-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>执行方</th>
                    <th>任务</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recent_events.slice(0, 5).map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatShortTime(event.occurred_at)}</td>
                      <td>{toEventTypeLabel(event.event_type)}</td>
                      <td>{event.actor_id}</td>
                      <td>{event.task_id ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
