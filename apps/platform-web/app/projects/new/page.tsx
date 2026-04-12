import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { platformApiJson } from "../../../lib/api";
import { ProjectCreateForm } from "./project-form";

type SelectOption = {
  value: string;
  label: string;
};

type UserOption = {
  user_id: string;
  display_name: string;
  role: string;
};

type ProjectCreateOptions = {
  departments: SelectOption[];
  project_types: SelectOption[];
  priorities: SelectOption[];
  statuses: SelectOption[];
  owners: UserOption[];
  participants: UserOption[];
};

type CurrentUser = {
  user_id: string;
};

export default async function ProjectCreatePage() {
  const [options, currentUser] = await Promise.all([
    platformApiJson<ProjectCreateOptions>("/api/v1/project-create-options"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!options || !currentUser) {
    redirect("/login");
  }

  const defaultOwnerUserId = options.owners.find((owner) => owner.user_id === currentUser.user_id)?.user_id ?? options.owners[0]?.user_id;

  return (
    <AppShell
      description="在统一的 Flow System 表单体系里配置项目基础信息、成员、阶段和附件。"
      eyebrow="Projects"
      title="新建项目"
    >
      <ProjectCreateForm
        option={{
          ...options,
          currentUserId: currentUser.user_id,
          ...(defaultOwnerUserId ? { defaultOwnerUserId } : {}),
        }}
      />
    </AppShell>
  );
}
