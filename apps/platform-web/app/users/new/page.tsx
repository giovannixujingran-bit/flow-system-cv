import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { platformApiJson } from "../../../lib/api";
import type { CurrentUser } from "../types";
import { UserCreateForm } from "../user-create-form";

export default async function UserCreatePage() {
  const currentUser = await platformApiJson<CurrentUser>("/api/v1/auth/me");
  if (!currentUser) {
    redirect("/login");
  }

  if (currentUser.role !== "admin") {
    redirect("/users");
  }

  return (
    <AppShell
      description="在统一的管理表单里创建成员账号，并继续沿用现有权限规则。"
      eyebrow="Users"
      title="新建用户"
    >
      <UserCreateForm />
    </AppShell>
  );
}
