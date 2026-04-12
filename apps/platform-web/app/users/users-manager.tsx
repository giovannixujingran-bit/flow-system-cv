"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { toUiErrorMessage } from "../../lib/labels";
import { getUserStatusLabel } from "./status";
import type { UserListItem } from "./types";

type UsersManagerProps = {
  canCreate: boolean;
  currentUserId: string;
  initialUsers: UserListItem[];
};

type DeleteUserResponse = {
  deleted_user_id: string;
};

type UserEditorDraft = {
  displayName: string;
  password: string;
  role: UserListItem["role"];
  status: UserListItem["status"];
};

function getCsrf(): string {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("flow_csrf="));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

function formatTime(value: string): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function roleLabel(role: UserListItem["role"]): string {
  if (role === "admin") {
    return "管理员";
  }
  if (role === "owner") {
    return "项目负责人";
  }
  return "执行成员";
}

function avatarText(value: string): string {
  const text = value.trim();
  return text ? [...text].slice(0, 2).join("").toUpperCase() : "U";
}

function createUserEditorDraft(user: UserListItem): UserEditorDraft {
  return {
    displayName: user.display_name,
    password: "",
    role: user.role,
    status: user.status,
  };
}

function statusPillClass(status: UserListItem["status"]): string {
  return status === "active" ? "table-pill success" : "table-pill warn";
}

function UserItem({
  currentUserId,
  onDeleted,
  onToggle,
  onUpdated,
  open,
  user,
}: {
  currentUserId: string;
  onDeleted: (userId: string) => void;
  onToggle: () => void;
  onUpdated: (nextUser: UserListItem) => void;
  open: boolean;
  user: UserListItem;
}) {
  const [draft, setDraft] = useState<UserEditorDraft>(() => createUserEditorDraft(user));
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(createUserEditorDraft(user));
    }
  }, [isEditing, user]);

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/platform/v1/users/${user.user_id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": getCsrf(),
      },
      body: JSON.stringify({
        display_name: draft.displayName.trim(),
        role: draft.role,
        status: draft.status,
        password: draft.password.trim() || undefined,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "User update failed" }));
      setError(toUiErrorMessage(payload.error ?? "User update failed"));
      return;
    }

    const payload = await response.json() as { user: UserListItem };
    setDraft(createUserEditorDraft(payload.user));
    setIsEditing(false);
    setMessage("已保存");
    onUpdated(payload.user);
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/platform/v1/users/${user.user_id}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": getCsrf(),
      },
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "User delete failed" }));
      setError(toUiErrorMessage(payload.error ?? "User delete failed"));
      setIsDeleteDialogOpen(false);
      return;
    }

    const payload = await response.json() as DeleteUserResponse;
    setIsDeleteDialogOpen(false);
    onDeleted(payload.deleted_user_id);
  }

  return (
    <article className={open ? "user-item is-open" : "user-item"}>
      <button
        aria-expanded={open}
        className="user-row"
        onClick={onToggle}
        type="button"
      >
        <div className="user-main">
          <div className="avatar user-avatar">{avatarText(user.display_name)}</div>
          <div>
            <strong>{user.display_name}</strong>
            <div className="user-subline">
              @{user.username}
              {user.user_id === currentUserId ? " · 当前登录账号" : ""}
            </div>
          </div>
        </div>

        <div className="user-columns">
          <span className="user-role">{roleLabel(user.role)}</span>
          <span className={statusPillClass(draft.status)}>{getUserStatusLabel(draft.status)}</span>
          <span className="user-meta">更新于 {formatTime(user.updated_at)}</span>
        </div>
      </button>

      {open ? (
        <div className="user-detail">
          <div className="user-detail-grid">
            <div className="user-field">
              <span className="user-field-label">用户 ID</span>
              <code>{user.user_id}</code>
            </div>
            <div className="user-field">
              <span className="user-field-label">用户名</span>
              <strong>{user.username}</strong>
            </div>
            <div className="user-field">
              <span className="user-field-label">创建时间</span>
              <strong>{formatTime(user.created_at)}</strong>
            </div>
          </div>

          <fieldset className="users-editor-fields" disabled={!isEditing || pending}>
            <div className="user-detail-grid">
              <label className="user-field">
                <span className="user-field-label">显示名称</span>
                <input
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                />
              </label>

              <label className="user-field">
                <span className="user-field-label">角色</span>
                <select
                  value={draft.role}
                  onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as UserListItem["role"] }))}
                >
                  <option value="admin">管理员</option>
                  <option value="owner">项目负责人</option>
                  <option value="member">执行成员</option>
                </select>
              </label>

              <label className="user-field">
                <span className="user-field-label">状态</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as UserListItem["status"] }))}
                >
                  <option value="active">启用中</option>
                  <option value="disabled">已停用</option>
                </select>
              </label>
            </div>

            <label className="user-field">
              <span className="user-field-label">重置密码</span>
              <input
                placeholder="留空表示不修改"
                type="password"
                value={draft.password}
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
          </fieldset>

          <div className="user-action-row">
            <button
              className="secondary-btn"
              disabled={pending}
              onClick={isEditing ? () => void save() : () => setIsEditing(true)}
              type="button"
            >
              {pending ? "保存中..." : isEditing ? "保存" : "编辑"}
            </button>
            <button
              className="danger-btn"
              disabled={pending}
              onClick={() => setIsDeleteDialogOpen(true)}
              type="button"
            >
              删除
            </button>
            {message ? <span className="form-feedback form-feedback-success">{message}</span> : null}
          </div>

          {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}

          {isDeleteDialogOpen ? (
            <ConfirmDialog
              confirmLabel="确认删除"
              confirmTone="danger"
              description={`删除后将无法恢复。确认要删除用户“${user.username}”吗？`}
              onCancel={() => setIsDeleteDialogOpen(false)}
              onConfirm={remove}
              pending={pending}
              title="确认删除用户"
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function UsersManager({ canCreate, currentUserId, initialUsers }: UsersManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [openUserId, setOpenUserId] = useState<string | null>(initialUsers[0]?.user_id ?? null);

  const summary = useMemo(() => {
    const adminCount = users.filter((user) => user.role === "admin").length;
    const activeCount = users.filter((user) => user.status === "active").length;
    return {
      total: users.length,
      admins: adminCount,
      active: activeCount,
    };
  }, [users]);

  function deleteUser(userId: string): void {
    setUsers((current) => current.filter((user) => user.user_id !== userId));
    setOpenUserId((current) => (current === userId ? null : current));
  }

  function updateUser(nextUser: UserListItem): void {
    setUsers((current) => current.map((user) => (user.user_id === nextUser.user_id ? nextUser : user)));
  }

  return (
    <section className="user-surface glass-panel">
      <div className="user-surface-header">
        <div>
          <p className="eyebrow">Flow System Users</p>
          <h3>用户管理与权限总览</h3>
        </div>
        {canCreate ? (
          <div className="user-header-actions">
            <Link className="user-create-btn" href="/users/new">
              新建用户
            </Link>
          </div>
        ) : null}
      </div>

      <div className="user-summary-grid">
        <article className="user-summary-card">
          <p className="user-summary-label">总用户数</p>
          <strong>{String(summary.total).padStart(2, "0")}</strong>
          <p className="user-summary-meta">当前平台已注册的全部账号。</p>
        </article>
        <article className="user-summary-card">
          <p className="user-summary-label">管理员</p>
          <strong>{String(summary.admins).padStart(2, "0")}</strong>
          <p className="user-summary-meta">拥有系统配置和用户管理权限的账号。</p>
        </article>
        <article className="user-summary-card">
          <p className="user-summary-label">启用中</p>
          <strong>{String(summary.active).padStart(2, "0")}</strong>
          <p className="user-summary-meta">当前可正常登录和参与协作的账号。</p>
        </article>
      </div>

      <div className="user-list">
        {users.map((user) => (
          <UserItem
            currentUserId={currentUserId}
            key={user.user_id}
            onDeleted={deleteUser}
            onToggle={() => setOpenUserId((current) => (current === user.user_id ? null : user.user_id))}
            onUpdated={updateUser}
            open={openUserId === user.user_id}
            user={user}
          />
        ))}
      </div>
    </section>
  );
}
