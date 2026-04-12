import { platformApiJson } from "./api";

type CurrentUser = {
  user_id: string;
};

type AgentListItem = {
  owner_user_id: string;
  local_ui_port: number;
  last_heartbeat_at?: string;
};

export async function resolveLocalUiPort(): Promise<number | undefined> {
  try {
    const [currentUser, agents] = await Promise.all([
      platformApiJson<CurrentUser>("/api/v1/auth/me"),
      platformApiJson<AgentListItem[]>("/api/v1/agents"),
    ]);

    if (!currentUser || !agents) {
      return undefined;
    }

    return agents
      .filter((agent) => agent.owner_user_id === currentUser.user_id)
      .sort((left, right) => (right.last_heartbeat_at ?? "").localeCompare(left.last_heartbeat_at ?? ""))[0]
      ?.local_ui_port;
  } catch {
    return undefined;
  }
}
