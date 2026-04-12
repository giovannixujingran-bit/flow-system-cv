"use client";

import { useEffect, useState } from "react";

import {
  createOpenClawStatus,
  openClawStatusResponseSchema,
  type OpenClawStatus,
} from "@flow-system/local-openclaw-contracts";

type TopbarOpenClawStatusProps = {
  localUiPort?: number;
};

function createDisconnectedStatus(): OpenClawStatus {
  return createOpenClawStatus({
    selected_mode: null,
    selected_path: null,
    openclaw_bin: null,
    openclaw_state_dir: null,
    openclaw_config_path: null,
    status_code: "not_configured",
    last_validated_at: null,
    last_error: null,
    current_model: null,
  });
}

export function TopbarOpenClawStatus({ localUiPort }: TopbarOpenClawStatusProps) {
  const [status, setStatus] = useState<OpenClawStatus>(createDisconnectedStatus());

  useEffect(() => {
    if (!localUiPort) {
      setStatus(createDisconnectedStatus());
      return undefined;
    }

    const controller = new AbortController();
    const localAgentUrl = `http://127.0.0.1:${localUiPort}`;

    async function loadStatus(signal?: AbortSignal): Promise<void> {
      try {
        const response = await fetch(`${localAgentUrl}/api/openclaw/status`, {
          method: "GET",
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) {
          throw new Error("Local OpenClaw status request failed.");
        }

        const payload = openClawStatusResponseSchema.parse(await response.json());
        setStatus(payload.status);
      } catch {
        if (signal?.aborted) {
          return;
        }
        setStatus(createDisconnectedStatus());
      }
    }

    void loadStatus(controller.signal);
    const timer = window.setInterval(() => {
      void loadStatus(controller.signal);
    }, 15000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [localUiPort]);

  return (
    <>
      <div className="meta-pill">当前模型 {status.current_model ?? "未知"}</div>
      <div
        className={status.openclaw_connected ? "status-chip" : "status-chip status-chip-warn"}
        title={status.status_label}
      >
        <span className="status-light" aria-hidden="true" />
        <span>{status.openclaw_connected ? "OpenClaw 已连接" : "OpenClaw 未接入"}</span>
      </div>
    </>
  );
}
