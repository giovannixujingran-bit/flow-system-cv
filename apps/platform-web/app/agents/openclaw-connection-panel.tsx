"use client";

import { useEffect, useState } from "react";

import {
  createOpenClawStatus,
  type OpenClawSelectionResult,
  type OpenClawStatus,
  type OpenClawStatusResponse,
} from "@flow-system/local-openclaw-contracts";

type OpenClawConnectionPanelProps = {
  localUiPort: number | undefined;
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

function readableMode(value: OpenClawStatus["selected_mode"]): string {
  if (value === "executable") {
    return "启动脚本";
  }
  if (value === "root") {
    return "根目录";
  }
  return "-";
}

export function OpenClawConnectionPanel({ localUiPort }: OpenClawConnectionPanelProps) {
  const [status, setStatus] = useState<OpenClawStatus>(createDisconnectedStatus());
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastActionHint, setLastActionHint] = useState<string | null>(null);

  const localAgentUrl = localUiPort ? `http://127.0.0.1:${localUiPort}` : null;

  async function loadStatus(): Promise<void> {
    if (!localAgentUrl) {
      setStatus(createDisconnectedStatus());
      setError("当前账号还没有接入本机代理。");
      setLastActionHint(null);
      return;
    }

    try {
      const response = await fetch(`${localAgentUrl}/api/openclaw/status`, {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error("无法读取本机 OpenClaw 接入状态。");
      }
      const payload = (await response.json()) as OpenClawStatusResponse;
      setStatus(payload.status);
      setError(null);
      if (!pendingAction) {
        setLastActionHint(`状态已更新：${payload.status.status_label}`);
      }
    } catch {
      setStatus(createDisconnectedStatus());
      setError("未连接到本机代理。");
      setLastActionHint(null);
    }
  }

  async function runAction(
    endpoint: "/api/openclaw/select-executable" | "/api/openclaw/select-root" | "/api/openclaw/revalidate" | "/api/openclaw/reset",
    actionKey: string,
  ): Promise<void> {
    if (!localAgentUrl) {
      setError("当前账号还没有接入本机代理。");
      return;
    }

    setPendingAction(actionKey);
    setLastActionHint(
      actionKey === "select-executable"
        ? "正在打开 OpenClaw 启动脚本选择器..."
        : actionKey === "select-root"
          ? "正在打开 OpenClaw 根目录选择器..."
          : actionKey === "revalidate"
            ? "正在执行连接校验..."
            : "正在清理本地接入配置...",
    );

    try {
      const response = await fetch(`${localAgentUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error("本机 OpenClaw 接入操作失败。");
      }

      const payload = (await response.json()) as OpenClawStatusResponse | OpenClawSelectionResult;
      if ("accepted" in payload) {
        setStatus(payload.status);
        setError(payload.status.last_error);
        setLastActionHint(
          payload.cancelled
            ? "操作已取消。"
            : payload.persisted
              ? "选择已保存。"
              : "选择未覆盖现有可用配置。",
        );
      } else {
        setStatus(payload.status);
        setError(payload.status.last_error);
        setLastActionHint(`操作完成：${payload.status.status_label}`);
      }
    } catch {
      setError("本机 OpenClaw 接入操作失败。");
      setLastActionHint("操作失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  }

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [localAgentUrl]);

  return (
    <section className="agent-card">
      <div className="agent-card-head">
        <div>
          <p className="eyebrow">Connection Summary</p>
          <h4>本机连接</h4>
        </div>
        <span className={status.openclaw_connected ? "table-pill success" : "table-pill warn"}>
          {status.status_label}
        </span>
      </div>

      <div className="agent-info-list">
        <div className="agent-info-row">
          <span className="agent-info-label">当前模型</span>
          <span className="agent-info-value">{status.current_model ?? "未知"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">接入模式</span>
          <span className="agent-info-value">{readableMode(status.selected_mode)}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">可执行文件</span>
          <span className="agent-info-value">{status.openclaw_bin ?? "-"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">状态目录</span>
          <span className="agent-info-value">{status.openclaw_state_dir ?? "-"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">配置文件</span>
          <span className="agent-info-value">{status.openclaw_config_path ?? "-"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">上次校验</span>
          <span className="agent-info-value">{status.last_validated_at ?? "-"}</span>
        </div>
      </div>

      {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
      {!error && status.last_error ? <div className="form-feedback form-feedback-error">{status.last_error}</div> : null}
      <div className="agent-table-note">{pendingAction ? lastActionHint : (lastActionHint ?? "就绪，可以继续操作。")}</div>

      <div className="agent-action-row">
        <button className="secondary-btn" disabled={pendingAction !== null} onClick={() => void runAction("/api/openclaw/select-executable", "select-executable")} type="button">
          {pendingAction === "select-executable" ? "选择中..." : "选择启动脚本"}
        </button>
        <button className="secondary-btn" disabled={pendingAction !== null} onClick={() => void runAction("/api/openclaw/select-root", "select-root")} type="button">
          {pendingAction === "select-root" ? "选择中..." : "选择根目录"}
        </button>
        <button className="secondary-btn" disabled={pendingAction !== null} onClick={() => void runAction("/api/openclaw/revalidate", "revalidate")} type="button">
          {pendingAction === "revalidate" ? "校验中..." : "重新校验"}
        </button>
        <button className="danger-btn" disabled={pendingAction !== null} onClick={() => void runAction("/api/openclaw/reset", "reset")} type="button">
          {pendingAction === "reset" ? "清理中..." : "清除配置"}
        </button>
      </div>
    </section>
  );
}
