"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { toUiErrorMessage } from "../lib/labels";
import { ConfirmDialog } from "./confirm-dialog";

type ResourceDeleteButtonProps = {
  resourceLabel: string;
  resourceName: string;
  endpoint: string;
  redirectHref: string;
  failureMessage: string;
  canDelete: boolean;
};

function getCsrf(): string {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("flow_csrf="));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

export function ResourceDeleteButton({
  resourceLabel,
  resourceName,
  endpoint,
  redirectHref,
  failureMessage,
  canDelete,
}: ResourceDeleteButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  function requestDelete(): void {
    setError(null);
    if (!canDelete) {
      setError("无权限");
      return;
    }
    setIsConfirmOpen(true);
  }

  function closeConfirm(): void {
    if (!pending) {
      setIsConfirmOpen(false);
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);

    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        "x-csrf-token": getCsrf(),
      },
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: failureMessage }));
      setError(toUiErrorMessage(payload.error ?? failureMessage));
      setIsConfirmOpen(false);
      return;
    }

    setIsConfirmOpen(false);
    router.push(redirectHref);
    router.refresh();
  }

  return (
    <div className="resource-delete-action">
      <button
        className="button button-inline button-danger-subtle"
        disabled={pending}
        onClick={requestDelete}
        type="button"
      >
        {pending ? "处理中..." : `删除${resourceLabel}`}
      </button>
      {error ? <div className="resource-delete-feedback">{error}</div> : null}
      {isConfirmOpen ? (
        <ConfirmDialog
          confirmLabel={`确认删除${resourceLabel}`}
          confirmTone="danger"
          description={`删除后将无法恢复。确认要删除“${resourceName}”吗？`}
          onCancel={closeConfirm}
          onConfirm={remove}
          pending={pending}
          title={`确认删除${resourceLabel}`}
        />
      ) : null}
    </div>
  );
}
