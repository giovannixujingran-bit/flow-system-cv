import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { ResourceDeleteButton } from "../../../components/resource-delete-button";
import { platformApiJson } from "../../../lib/api";
import { toRiskLevelLabel, toTaskStatusLabel } from "../../../lib/labels";

type AttachmentManifestItem = {
  file_id: string;
  file_name: string;
  size_bytes: number;
};

type ProjectDetail = {
  projectId: string;
  projectCode: string;
  projectName: string;
  description: string;
  departmentLabel: string;
  projectTypeLabel: string;
  ownerUserId: string;
  ownerDisplayName: string;
  participantDisplayNames: string[];
  priorityLabel: string;
  statusLabel: string;
  currentStage: string;
  startDate?: string;
  dueDate?: string;
  attachment_manifest: AttachmentManifestItem[];
  tasks: Array<{
    task_id: string;
    task_title: string;
    status: string;
    assignee_agent_id: string;
    risk_level: string;
  }>;
};

type CurrentUser = {
  user_id: string;
  role: "admin" | "owner" | "member";
};

function formatDate(value: string | undefined): string {
  return value ? value.slice(0, 10) : "未填写";
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, currentUser] = await Promise.all([
    platformApiJson<ProjectDetail>(`/api/v1/projects/${projectId}`),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!project || !currentUser) {
    redirect("/login");
  }

  const canDeleteProject =
    currentUser.role === "admin" ||
    currentUser.role === "owner" ||
    currentUser.user_id === project.ownerUserId;

  return (
    <AppShell
      actions={(
        <ResourceDeleteButton
          canDelete={canDeleteProject}
          endpoint={`/api/platform/v1/projects/${project.projectId}`}
          failureMessage="Project delete failed"
          redirectHref="/projects"
          resourceLabel="项目"
          resourceName={project.projectName}
        />
      )}
      description={project.description}
      eyebrow="Project Detail"
      title={project.projectName}
    >
      <div className="stack">
        <section className="panel detail-hero-card">
          <div className="detail-hero-top">
            <div>
              <p className="eyebrow">Project Overview</p>
              <h3>{project.projectName}</h3>
            </div>
            <span className="status-tag">{project.statusLabel}</span>
          </div>
          <p className="detail-hero-description">{project.description}</p>
        </section>

        <div className="detail-stats-grid">
          <div className="panel detail-stat-card">
            <div className="muted">项目编码</div>
            <strong>{project.projectCode}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">部门</div>
            <strong>{project.departmentLabel}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">项目类型</div>
            <strong>{project.projectTypeLabel}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">项目负责人</div>
            <strong>{project.ownerDisplayName}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">优先级</div>
            <strong>{project.priorityLabel}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">当前阶段</div>
            <strong>{project.currentStage}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">开始时间</div>
            <strong>{formatDate(project.startDate)}</strong>
          </div>
          <div className="panel detail-stat-card">
            <div className="muted">预计截止日期</div>
            <strong>{formatDate(project.dueDate)}</strong>
          </div>
        </div>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Participants</p>
              <h3>参与者</h3>
            </div>
          </div>
          <div className="member-chip-list">
            {project.participantDisplayNames.length > 0 ? (
              project.participantDisplayNames.map((displayName) => (
                <span className="task-user-chip" key={displayName}>
                  <span className="task-user-avatar">{displayName.slice(0, 1)}</span>
                  <span className="task-user-name">{displayName}</span>
                </span>
              ))
            ) : (
              <div className="muted">当前没有参与者。</div>
            )}
          </div>
        </section>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Attachments</p>
              <h3>项目附件</h3>
            </div>
          </div>
          <div className="attachment-grid">
            {project.attachment_manifest.length > 0 ? (
              project.attachment_manifest.map((file) => (
                <Link
                  className="attachment-card"
                  href={`/api/platform/v1/projects/${project.projectId}/attachments/${file.file_id}`}
                  key={file.file_id}
                >
                  <strong>{file.file_name}</strong>
                  <span className="muted">{file.size_bytes.toLocaleString()} B</span>
                </Link>
              ))
            ) : (
              <div className="muted">当前没有项目附件。</div>
            )}
          </div>
        </section>

        <section className="panel detail-section">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Tasks</p>
              <h3>任务列表</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>代理</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                {(project.tasks ?? []).map((task) => (
                  <tr key={task.task_id}>
                    <td>
                      <Link href={`/tasks/${task.task_id}`}>{task.task_title}</Link>
                    </td>
                    <td>{toTaskStatusLabel(task.status)}</td>
                    <td>{task.assignee_agent_id}</td>
                    <td>{toRiskLevelLabel(task.risk_level)}</td>
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
