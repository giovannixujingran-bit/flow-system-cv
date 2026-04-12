import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { platformApiJson } from "../../lib/api";
import { toAgentStatusLabel } from "../../lib/labels";
import { LocalUpdatePanel } from "./local-update-panel";
import { OpenClawConnectionPanel } from "./openclaw-connection-panel";

type CurrentUser = {
  user_id: string;
  username: string;
  role: string;
  display_name: string;
};

type AgentListItem = {
  agent_id: string;
  agent_name: string;
  machine_name: string;
  owner_display_name: string;
  owner_user_id: string;
  status: string;
  last_heartbeat_at?: string;
  current_load: number;
  runtime_version: string;
  update_available: boolean;
  latest_release_version: string | null;
  local_ui_port: number;
};

export default async function AgentsPage() {
  const [agents, currentUser] = await Promise.all([
    platformApiJson<AgentListItem[]>("/api/v1/agents"),
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
  ]);

  if (!agents || !currentUser) {
    redirect("/login");
  }

  const localAgent = agents
    .filter((agent) => agent.owner_user_id === currentUser.user_id)
    .sort((left, right) => (right.last_heartbeat_at ?? "").localeCompare(left.last_heartbeat_at ?? ""))[0];

  return (
    <AppShell eyebrow="Agents" title="代理面板">
      <section className="agent-surface glass-panel">
        <div className="agent-surface-header">
          <div>
            <p className="eyebrow">OpenClaw Runtime</p>
            <h3>连接状态与本机代理更新</h3>
          </div>
          <div className="agent-header-badges">
            <span className="table-pill info">代理总数 {agents.length}</span>
            <span className={localAgent ? "table-pill success" : "table-pill warn"}>
              {localAgent ? `本机 ${toAgentStatusLabel(localAgent.status)}` : "本机未接入"}
            </span>
          </div>
        </div>

        <div className="agent-layout">
          <OpenClawConnectionPanel localUiPort={localAgent?.local_ui_port} />
          <LocalUpdatePanel localUiPort={localAgent?.local_ui_port} />
        </div>

        <section className="agent-table-card">
          <div className="agent-card-head">
            <div>
              <p className="eyebrow">Agent Network</p>
              <h4>代理列表</h4>
            </div>
            <span className="agent-table-note">展示当前平台已注册的全部代理实例。</span>
          </div>

          <div className="agent-table-wrap">
            <table className="agent-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>机器</th>
                  <th>所属用户</th>
                  <th>状态</th>
                  <th>版本</th>
                  <th>更新</th>
                  <th>最近心跳</th>
                  <th>负载</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agent_id}>
                    <td>{agent.agent_name}</td>
                    <td>{agent.machine_name}</td>
                    <td>{agent.owner_display_name}</td>
                    <td>
                      <span className={agent.status === "online" ? "table-pill success" : "table-pill warn"}>
                        {toAgentStatusLabel(agent.status)}
                      </span>
                    </td>
                    <td>{agent.runtime_version}</td>
                    <td>{agent.update_available ? `可更新到 ${agent.latest_release_version}` : "已是最新"}</td>
                    <td>{agent.last_heartbeat_at ?? "-"}</td>
                    <td>{agent.current_load}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
