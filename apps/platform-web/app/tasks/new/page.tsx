import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { platformApiJson } from "../../../lib/api";
import { TaskCreateForm } from "./task-form";

type TaskCreateOptionsResponse = {
  responsibles: Array<{
    user_id: string;
    display_name: string;
    role: string;
    preferred_agent_id: string;
    agent_status: string;
  }>;
};

type ProjectListItem = {
  projectId: string;
  projectName: string;
};

type WorkflowListItem = {
  workflowId: string;
  workflowTemplateId: string;
  currentStepId?: string;
};

type CurrentUser = {
  user_id: string;
};

export default async function TaskCreatePage() {
  const [taskCreateOptions, projects, currentUser] = await Promise.all([
    platformApiJson<TaskCreateOptionsResponse>("/api/v1/task-create-options"),
    platformApiJson<ProjectListItem[]>("/api/v1/projects"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!taskCreateOptions || !projects || !currentUser) {
    redirect("/login");
  }

  const workflowsByProject = await Promise.all(
    projects.map((project) => platformApiJson<WorkflowListItem[]>(`/api/v1/projects/${project.projectId}/workflows`)),
  );

  const defaultProject = projects.find((project) => project.projectId === "proj_demo") ?? projects[0];
  const responsibles = taskCreateOptions.responsibles.map((responsible) => ({
    agentId: responsible.preferred_agent_id,
    userId: responsible.user_id,
    label: responsible.display_name,
  }));
  const defaultResponsibleAgentId = responsibles.find((responsible) => responsible.userId === currentUser.user_id)?.agentId
    ?? responsibles[0]?.agentId;

  const projectOptions = projects.map((project, index) => {
    const workflow = workflowsByProject[index]?.[0];
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      stepId: workflow?.currentStepId ?? "step_excel_revise",
      ...(workflow?.workflowId ? { workflowId: workflow.workflowId } : {}),
      ...(workflow?.workflowTemplateId ? { workflowTemplateId: workflow.workflowTemplateId } : {}),
    };
  });

  return (
    <AppShell
      description="保留现有指派、附件和工作流逻辑，用新的 Flow System 表单视觉创建任务。"
      eyebrow="Tasks"
      title="新建任务"
    >
      <TaskCreateForm
        option={{
          senderUserId: currentUser.user_id,
          responsibles,
          ...(defaultResponsibleAgentId ? { defaultResponsibleAgentId } : {}),
          projects: projectOptions,
          ...(defaultProject ? { projectId: defaultProject.projectId } : {}),
        }}
      />
    </AppShell>
  );
}
