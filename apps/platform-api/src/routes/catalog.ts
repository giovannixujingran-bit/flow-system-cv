import { requireUserRead } from "../http.js";
import { isAgentUpdateAvailable, serializeTask } from "../runtime.js";
import { serializeProject } from "../domain/projects.js";
import type { PlatformRuntime } from "../context.js";
import { collectPostgresReadyStatus } from "../storage/postgres-state.js";

export function registerCatalogRoutes(runtime: PlatformRuntime): void {
  const { app, state, scanRisks } = runtime;

  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async () => {
    await runtime.ready;
    if (runtime.config.storageMode === "postgres") {
      return collectPostgresReadyStatus(runtime.config);
    }
    return {
      ok: true,
      db_ok: false,
      storage_writable: true,
      release_dir_ok: true,
      schema_version: null,
      storage_mode: runtime.config.storageMode,
      key_query_ok: true,
    };
  });

  app.get("/api/v1/dashboard", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    scanRisks();
    const nowDate = new Date().toISOString().slice(0, 10);
    const tasks = [...state.tasks.values()];
    return {
      project_count: state.projects.size,
      today_new_tasks: tasks.filter((task) => task.createdAt.slice(0, 10) === nowDate).length,
      in_progress_tasks: tasks.filter((task) => ["accepted", "in_progress"].includes(task.status)).length,
      overdue_tasks: [...state.risks.values()].filter((risk) => risk.riskCode === "overdue").length,
      done_today: tasks.filter((task) => task.completedAt?.slice(0, 10) === nowDate).length,
      online_agents: [...state.agents.values()].filter((agent) => agent.status === "online").length,
      recent_events: [...state.events.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 20),
    };
  });

  app.get("/api/v1/projects", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    return [...state.projects.values()].map((project) => ({
      ...serializeProject(state, project),
      task_count: [...state.tasks.values()].filter((task) => task.projectId === project.projectId).length,
    }));
  });

  app.get("/api/v1/projects/:projectId", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    const params = request.params as { projectId: string };
    const project = state.projects.get(params.projectId);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return {
      ...serializeProject(state, project),
      tasks: [...state.tasks.values()].filter((task) => task.projectId === project.projectId).map((task) => serializeTask(state, task)),
    };
  });

  app.get("/api/v1/projects/:projectId/workflows", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    const params = request.params as { projectId: string };
    return [...state.workflows.values()].filter((workflow) => workflow.projectId === params.projectId);
  });

  app.get("/api/v1/workflows/:workflowId", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    const params = request.params as { workflowId: string };
    const workflow = state.workflows.get(params.workflowId);
    if (!workflow) {
      return reply.code(404).send({ error: "Workflow not found" });
    }
    return {
      ...workflow,
      template: state.workflowTemplates.get(workflow.workflowTemplateId),
    };
  });

  app.get("/api/v1/workflows/:workflowId/steps", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    const params = request.params as { workflowId: string };
    const workflow = state.workflows.get(params.workflowId);
    if (!workflow) {
      return reply.code(404).send({ error: "Workflow not found" });
    }
    return state.workflowTemplates.get(workflow.workflowTemplateId)?.steps ?? [];
  });

  app.get("/api/v1/agents", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    return [...state.agents.values()].map((agent) => ({
      agent_id: agent.agentId,
      agent_name: agent.agentName,
      machine_name: agent.machineName,
      owner_user_id: agent.ownerUserId,
      owner_display_name: state.users.get(agent.ownerUserId)?.displayName ?? agent.ownerUserId,
      ip_address: agent.ipAddress,
      local_ui_port: agent.localUiPort,
      status: agent.status,
      last_heartbeat_at: agent.lastHeartbeatAt,
      runtime_version: agent.runtimeVersion,
      os_type: agent.osType,
      capabilities: agent.capabilities,
      current_load: state.heartbeats.get(agent.agentId)?.currentLoad ?? 0,
      last_seen_tasks: state.heartbeats.get(agent.agentId)?.lastSeenTasks ?? 0,
      update_available: isAgentUpdateAvailable(state, agent.runtimeVersion),
      latest_release_version: state.currentAgentRelease?.version ?? null,
    }));
  });
}
