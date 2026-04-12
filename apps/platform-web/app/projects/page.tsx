import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { platformApiJson } from "../../lib/api";
import { ProjectsBoard } from "./projects-board";

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

type CurrentUser = {
  user_id: string;
  display_name: string;
};

export default async function ProjectsPage() {
  const [projects, tasks, currentUser] = await Promise.all([
    platformApiJson<ProjectListItem[]>("/api/v1/projects"),
    platformApiJson<TaskListItem[]>("/api/v1/tasks"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!projects || !tasks || !currentUser) {
    redirect("/login");
  }

  return (
    <AppShell eyebrow="Projects" title="项目面板">
      <ProjectsBoard
        currentUserDisplayName={currentUser.display_name}
        currentUserId={currentUser.user_id}
        projects={projects}
        tasks={tasks}
      />
    </AppShell>
  );
}
