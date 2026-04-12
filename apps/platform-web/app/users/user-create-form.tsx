"use client";

import { useState } from "react";

import { toUiErrorMessage } from "../../lib/labels";
import type { UserListItem } from "./types";

function getCsrf(): string {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("flow_csrf="));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

export function UserCreateForm() {
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    role: "member" as UserListItem["role"],
    password: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createUser(): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/platform/v1/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": getCsrf(),
      },
      body: JSON.stringify(form),
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "User creation failed" }));
      setError(toUiErrorMessage(payload.error ?? "User creation failed"));
      return;
    }

    setForm({
      username: "",
      display_name: "",
      role: "member",
      password: "",
    });
    setMessage("用户已创建");
  }

  return (
    <div className="panel form-shell">
      <div className="form-heading">
        <p className="eyebrow">User Management</p>
        <h3>创建成员账号</h3>
      </div>

      <div className="form-grid form-grid-two">
        <label className="field">
          <span className="field-label">用户名</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
            placeholder="例如 zhangsan"
            value={form.username}
          />
        </label>

        <label className="field">
          <span className="field-label">显示名称</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
            placeholder="例如 张三"
            value={form.display_name}
          />
        </label>

        <label className="field">
          <span className="field-label">角色</span>
          <select
            onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserListItem["role"] }))}
            value={form.role}
          >
            <option value="admin">管理员</option>
            <option value="owner">项目负责人</option>
            <option value="member">执行成员</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">初始密码</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="至少 6 位"
            type="password"
            value={form.password}
          />
        </label>
      </div>

      <div className="form-submit-row">
        <button
          className="button button-primary"
          disabled={pending || !form.username.trim() || !form.display_name.trim() || form.password.trim().length < 6}
          onClick={() => void createUser()}
          type="button"
        >
          {pending ? "创建中..." : "创建用户"}
        </button>
        {message ? <span className="form-feedback form-feedback-success">{message}</span> : null}
      </div>

      {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
    </div>
  );
}
