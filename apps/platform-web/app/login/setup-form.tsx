"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { toUiErrorMessage } from "../../lib/labels";

type SetupFormProps = {
  className?: string | undefined;
};

export function SetupForm({ className }: SetupFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const displayName = String(form.get("display_name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirm_password") ?? "");

    if (password !== confirmPassword) {
      setPending(false);
      setError("两次输入的密码不一致");
      return;
    }

    const initializeResponse = await fetch("/api/setup/initialize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username,
        display_name: displayName,
        password,
      }),
    });

    if (!initializeResponse.ok) {
      const payload = await initializeResponse.json().catch(() => ({ error: "Setup initialization failed" }));
      setPending(false);
      setError(toUiErrorMessage(payload.error ?? "Setup initialization failed"));
      return;
    }

    const loginResponse = await fetch("/api/session/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    setPending(false);
    if (!loginResponse.ok) {
      const payload = await loginResponse.json().catch(() => ({ error: "Login failed" }));
      setError(toUiErrorMessage(payload.error ?? "Login failed"));
      router.refresh();
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form className={["panel", "stack", className].filter(Boolean).join(" ")} onSubmit={onSubmit}>
      <div className="form-heading">
        <p className="eyebrow">Platform Setup</p>
        <h3>创建第一个管理员</h3>
      </div>
      <label className="field">
        <span className="field-label">管理员用户名</span>
        <input autoComplete="username" name="username" required />
      </label>
      <label className="field">
        <span className="field-label">显示名称</span>
        <input autoComplete="name" name="display_name" required />
      </label>
      <label className="field">
        <span className="field-label">密码</span>
        <input autoComplete="new-password" name="password" required type="password" />
      </label>
      <label className="field">
        <span className="field-label">确认密码</span>
        <input autoComplete="new-password" name="confirm_password" required type="password" />
      </label>
      <button className="button button-primary" disabled={pending} type="submit">
        {pending ? "初始化中..." : "创建第一个管理员"}
      </button>
      {error ? (
        <div aria-live="polite" className="form-feedback form-feedback-error">
          {error}
        </div>
      ) : null}
    </form>
  );
}
