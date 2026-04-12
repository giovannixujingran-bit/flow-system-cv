"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { toUiErrorMessage } from "../../lib/labels";

type LoginFormProps = {
  className?: string | undefined;
};

export function LoginForm({ className }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Login failed" }));
      setError(toUiErrorMessage(payload.error ?? "Login failed"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form
      autoComplete="off"
      className={["panel", "stack", className].filter(Boolean).join(" ")}
      onSubmit={onSubmit}
    >
      <div className="form-heading">
        <p className="eyebrow">Account Access</p>
        <h3>登录工作台</h3>
      </div>
      <label className="field">
        <span className="field-label">用户名</span>
        <input
          autoCapitalize="none"
          autoComplete="username"
          name="username"
          required
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="field-label">密码</span>
        <input
          autoComplete="current-password"
          name="password"
          required
          type="password"
        />
      </label>
      <button className="button button-primary" disabled={pending} type="submit">
        {pending ? "登录中..." : "登录"}
      </button>
      {error ? (
        <div aria-live="polite" className="form-feedback form-feedback-error">
          {error}
        </div>
      ) : null}
    </form>
  );
}
