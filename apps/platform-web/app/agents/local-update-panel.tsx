"use client";

import { useEffect, useState } from "react";

type UpdateStatus = {
  current_version: string;
  update_available: boolean;
  latest_version: string | null;
  release: {
    version: string;
    notes: string;
  } | null;
  apply_status: string;
  apply_message: string | null;
  restart_configured: boolean;
};

type LocalUpdatePanelProps = {
  localUiPort: number | undefined;
};

export function LocalUpdatePanel({ localUiPort }: LocalUpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const localAgentUrl = localUiPort ? `http://127.0.0.1:${localUiPort}` : null;

  async function loadStatus(): Promise<void> {
    if (!localAgentUrl) {
      setStatus(null);
      setError("当前账号还没有接入本机代理。");
      return;
    }

    try {
      const response = await fetch(`${localAgentUrl}/api/update/status`, {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error("无法读取本机代理更新状态。");
      }
      const payload = await response.json() as UpdateStatus;
      setStatus(payload);
      setError(null);
    } catch {
      setError("未连接到本机代理。");
    }
  }

  async function applyUpdate(): Promise<void> {
    if (!localAgentUrl) {
      setError("当前账号还没有接入本机代理。");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`${localAgentUrl}/api/update/apply`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("更新请求失败。");
      }
      await loadStatus();
    } catch {
      setError("本机代理更新失败。");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [localAgentUrl]);

  const ringText = status ? (status.update_available ? "UP" : "OK") : "--";

  return (
    <section className="agent-card">
      <div className="agent-card-head">
        <div>
          <p className="eyebrow">Local Runtime</p>
          <h4>本机代理更新</h4>
        </div>
        <span className={status?.update_available ? "table-pill warn" : "table-pill success"}>
          {status?.update_available ? "发现更新" : "最新版本"}
        </span>
      </div>

      <div className="agent-health-block">
        <div className="agent-health-ring">
          <span>{ringText}</span>
        </div>
        <div className="agent-health-copy">
          <strong>本机运行时</strong>
          <span>{status?.apply_message ?? (status?.update_available ? "检测到新版本，可立即更新。" : "当前已经是最新版本。")}</span>
        </div>
      </div>

      <div className="agent-info-list">
        <div className="agent-info-row">
          <span className="agent-info-label">当前版本</span>
          <span className="agent-info-value">{status?.current_version ?? "-"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">最新版本</span>
          <span className="agent-info-value">{status?.latest_version ?? "无"}</span>
        </div>
        <div className="agent-info-row">
          <span className="agent-info-label">自动重启</span>
          <span className="agent-info-value">{status?.restart_configured ? "已配置" : "未配置"}</span>
        </div>
      </div>

      {status?.release?.notes ? <div className="agent-table-note">{status.release.notes}</div> : null}
      {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
      {!status?.restart_configured && status ? (
        <div className="form-feedback form-feedback-error">当前启动方式未配置自动重启，暂时不能一键更新。</div>
      ) : null}

      <div className="agent-action-row">
        <button className="secondary-btn" onClick={() => void loadStatus()} type="button">
          刷新状态
        </button>
        {status?.update_available ? (
          <button
            className="primary-btn"
            disabled={pending || !status.restart_configured}
            onClick={() => void applyUpdate()}
            type="button"
          >
            {pending ? "更新中..." : "更新本机代理"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
