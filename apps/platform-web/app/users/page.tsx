import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { platformApiJson } from "../../lib/api";
import type { CurrentUser, UserListResponse } from "./types";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  const currentUser = await platformApiJson<CurrentUser>("/api/v1/auth/me");
  if (!currentUser) {
    redirect("/login");
  }

  const users = currentUser.role === "admin"
    ? await platformApiJson<UserListResponse>("/api/v1/users")
    : { users: [] };

  return (
    <AppShell eyebrow="Users" title="用户面板">
      {currentUser.role === "admin" ? (
        <UsersManager
          canCreate
          currentUserId={currentUser.user_id}
          initialUsers={users?.users ?? []}
        />
      ) : (
        <section className="user-surface glass-panel">
          <div className="user-surface-header">
            <div>
              <p className="eyebrow">Flow System Users</p>
              <h3>用户管理与权限总览</h3>
            </div>
          </div>
          <div className="project-empty-state">仅管理员可管理账号。当前账号没有用户管理权限。</div>
        </section>
      )}
    </AppShell>
  );
}
