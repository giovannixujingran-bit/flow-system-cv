"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { toTaskStatusLabel } from "../../lib/labels";

type ProjectListItem = {
  projectId: string;
  projectCode: string;
  projectName: string;
  currentStage: string;
  status: string;
  ownerDisplayName: string;
  task_count: number;
};

type TaskListItem = {
  task_id: string;
  project_id: string;
  task_title: string;
  summary: string;
  status: string;
  deadline?: string;
  assignee_user_id: string;
  assignee_display_name?: string;
};

type ProjectsBoardProps = {
  currentUserId: string;
  currentUserDisplayName: string;
  projects: ProjectListItem[];
  tasks: TaskListItem[];
};

function toProjectStageLabel(status: string, fallback: string): string {
  if (status === "not_started") {
    return "未启动";
  }
  if (status === "in_progress") {
    return "进行中";
  }
  if (status === "paused") {
    return "暂停";
  }
  if (status === "done") {
    return "已完成";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  return fallback || status;
}

function avatarText(value: string): string {
  const text = value.trim();
  return text ? [...text][0] ?? "人" : "人";
}

function formatDeadline(value?: string): string {
  if (!value) {
    return "未设置";
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

function accentClass(index: number): string {
  return ["project-column-emerald", "project-column-amber", "project-column-sky"][index % 3] ?? "project-column-emerald";
}

function matchesScope(
  project: ProjectListItem,
  projectTasks: TaskListItem[],
  currentUserId: string,
  currentUserDisplayName: string,
  scope: string,
): boolean {
  if (scope === "all") {
    return true;
  }

  if (project.ownerDisplayName === currentUserDisplayName) {
    return true;
  }

  return projectTasks.some((task) => task.assignee_user_id === currentUserId);
}

export function ProjectsBoard({
  currentUserId,
  currentUserDisplayName,
  projects,
  tasks,
}: ProjectsBoardProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");

  const groupedProjects = useMemo(
    () =>
      projects
        .map((project) => ({
          project,
          tasks: tasks.filter((task) => task.project_id === project.projectId),
        }))
        .filter(({ project, tasks: projectTasks }) => {
          const normalized = query.trim().toLowerCase();
          const matchesQuery = !normalized
            || project.projectName.toLowerCase().includes(normalized)
            || project.currentStage.toLowerCase().includes(normalized)
            || project.ownerDisplayName.toLowerCase().includes(normalized)
            || projectTasks.some((task) => (
              task.task_title.toLowerCase().includes(normalized)
              || task.summary.toLowerCase().includes(normalized)
            ));

          return matchesQuery && matchesScope(project, projectTasks, currentUserId, currentUserDisplayName, scope);
        }),
    [currentUserDisplayName, currentUserId, projects, query, scope, tasks],
  );

  return (
    <section className="project-surface glass-panel">
      <div className="project-surface-header">
        <div>
          <p className="eyebrow">Flow System Projects</p>
          <h3>项目面板</h3>
        </div>

        <div className="project-board-summary">
          <label className="project-filter-shell">
            <select className="project-scope-select" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">全部项目</option>
              <option value="mine">与我相关</option>
            </select>
          </label>

          <label className="project-search-shell">
            <input
              className="project-search-input"
              placeholder="搜索项目、阶段或任务..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <Link className="primary-btn" href="/projects/new">
            新建项目
          </Link>
        </div>
      </div>

      <div className="project-rail-note">
        <span className="rail-dot" aria-hidden="true" />
        <span>按项目维度横向展开，滚动查看每个项目的阶段、负责人和核心任务。</span>
      </div>

      {groupedProjects.length > 0 ? (
        <div className="project-rail">
          {groupedProjects.map(({ project, tasks: projectTasks }, index) => (
            <section className={`project-column ${accentClass(index)}`} key={project.projectId}>
              <div className="project-column-head">
                <div>
                  <p className="project-phase">{project.projectCode}</p>
                  <h4>{project.projectName}</h4>
                </div>
                <span className="status-tag">{toProjectStageLabel(project.status, project.currentStage)}</span>
              </div>

              <div className="project-meta-list">
                <div className="project-meta-item">
                  <span>当前阶段</span>
                  <strong>{project.currentStage}</strong>
                </div>
                <div className="project-meta-item">
                  <span>负责人</span>
                  <strong>{project.ownerDisplayName}</strong>
                </div>
                <div className="project-meta-item">
                  <span>任务数量</span>
                  <strong>{projectTasks.length}</strong>
                </div>
              </div>

              <div className="mini-task-stack">
                <p className="mini-task-heading">核心任务</p>
                {projectTasks.length > 0 ? (
                  projectTasks.slice(0, 5).map((task) => {
                    const displayName = task.assignee_display_name ?? task.assignee_user_id;

                    return (
                      <Link className="mini-task-card" href={`/tasks/${task.task_id}`} key={task.task_id}>
                        <div className="mini-task-name">{task.task_title}</div>
                        <div className="mini-task-row">
                          <span className="mini-owner">
                            <span className="owner-avatar small">{avatarText(displayName)}</span>
                            <span>{displayName}</span>
                          </span>
                          <span className="table-pill info">{toTaskStatusLabel(task.status)}</span>
                        </div>
                        <div className="mini-task-row">
                          <span className="muted">{task.summary || "暂无摘要"}</span>
                          <span className="muted">{formatDeadline(task.deadline)}</span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="project-empty-state">当前项目还没有任务。</div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="project-empty-state">没有匹配的项目。请调整筛选条件后重试。</div>
      )}
    </section>
  );
}
