import { redirect } from "next/navigation";

import { createOpenClawStatus } from "@flow-system/local-openclaw-contracts";

import { AppShell } from "../../components/app-shell";
import { platformApiJson } from "../../lib/api";
import { ConversationPanel } from "./conversation-panel";

type CurrentUser = {
  user_id: string;
  display_name: string;
};

type ConversationMessage = {
  message_id: string;
  conversation_id: string;
  owner_user_id: string;
  message_type: string;
  author_kind: "user" | "openclaw";
  body: string;
  source_user_id?: string;
  source_display_name?: string;
  target_user_id?: string;
  target_agent_id?: string;
  sync_status: "none" | "pending" | "synced" | "processing" | "replied" | "failed";
  sync_detail?: string | null;
  delivered_to_agent_at?: string;
  created_at: string;
  updated_at: string;
};

type ConversationThread = {
  conversation_id: string;
  owner_user_id: string;
  current_agent_id: string | null;
  openclaw_connected: boolean;
  messages: ConversationMessage[];
};

type AgentListItem = {
  agent_id: string;
  owner_user_id: string;
  local_ui_port: number;
  last_heartbeat_at?: string;
};

export default async function ConversationsPage() {
  const [currentUser, thread, agents] = await Promise.all([
    platformApiJson<CurrentUser>("/api/v1/auth/me"),
    platformApiJson<ConversationThread>("/api/v1/conversations/thread"),
    platformApiJson<AgentListItem[]>("/api/v1/agents"),
  ]);

  if (!currentUser || !thread || !agents) {
    redirect("/login");
  }

  const localAgent = agents
    .filter((agent) => agent.owner_user_id === currentUser.user_id)
    .sort((left, right) => (right.last_heartbeat_at ?? "").localeCompare(left.last_heartbeat_at ?? ""))[0];

  return (
    <AppShell eyebrow="Conversations" title="会话控制台" viewportLock>
      <ConversationPanel
        currentAgentId={thread.current_agent_id}
        currentUserDisplayName={currentUser.display_name}
        initialMessages={thread.messages}
        initialOpenClawStatus={createOpenClawStatus({
          selected_mode: null,
          selected_path: null,
          openclaw_bin: null,
          openclaw_state_dir: null,
          openclaw_config_path: null,
          status_code: thread.openclaw_connected ? "ready" : "not_configured",
          last_validated_at: null,
          last_error: null,
          current_model: null,
        })}
        localUiPort={localAgent?.local_ui_port}
      />
    </AppShell>
  );
}
