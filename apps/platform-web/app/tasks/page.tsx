import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { platformApiJson } from "../../lib/api";
import type { OpenClawTaskProgressView } from "./task-progress";
import { TasksBoard } from "./tasks-board";

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

type ProjectListItem = {
  projectId: string;
  projectName: string;
};

type CurrentUser = {
  user_id: string;
};

export default async function TasksPage() {
  const [tasks, projects, currentUser] = await Promise.all([
    platformApiJson<TaskListItem[]>("/api/v1/tasks"),
    platformApiJson<ProjectListItem[]>("/api/v1/projects"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!tasks || !projects || !currentUser) {
    redirect("/login");
  }

  const projectNameById = Object.fromEntries(projects.map((project) => [project.projectId, project.projectName]));

  return (
    <AppShell eyebrow="Tasks" title="任务面板">
      <TasksBoard
        currentUserId={currentUser.user_id}
        projectNameById={projectNameById}
        tasks={tasks}
      />
    </AppShell>
  );
}
