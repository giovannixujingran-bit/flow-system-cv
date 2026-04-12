import { heartbeatSchema, makeId, registerAgentRequestSchema } from "@flow-system/flow-protocol";

import type { PlatformRuntime } from "../context.js";
import { requireAgent } from "../http.js";
import { appendPlatformEvent, serializeTask, withIdempotency } from "../runtime.js";
import { createAgentToken, hashToken } from "../state.js";
import type { AgentRecord } from "../types.js";

const overlayActiveTaskStatuses = new Set(["new", "delivered", "received", "accepted", "in_progress", "waiting_review"]);

function normalizeClientIp(rawIp: string | undefined): string {
  if (!rawIp) {
    return "";
  }
  return rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
}

export function registerAgentRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.post("/api/v1/agents/register", async (request, reply) => {
    const bootstrapToken = request.headers["x-bootstrap-token"];
    const autoRegisterHeader = request.headers["x-flow-lan-auto-register"];
    const clientIp = normalizeClientIp(request.ip);
    const lanAutoRegister =
      (config.allowLanAutoRegister || autoRegisterHeader === "1")
      && typeof bootstrapToken !== "string";

    request.log.info({
      clientIp,
      hasBootstrapToken: typeof bootstrapToken === "string",
      autoRegisterHeader,
      allowLanAutoRegister: config.allowLanAutoRegister,
      lanAutoRegister,
    }, "Agent registration request");

    let tokenRecord = undefined as (typeof state.bootstrapTokens extends Map<string, infer T> ? T : never) | undefined;
    let registrationScope = "";

    if (!lanAutoRegister) {
      if (typeof bootstrapToken !== "string") {
        return reply.code(401).send({ error: "Bootstrap token required" });
      }
      tokenRecord = [...state.bootstrapTokens.values()].find(
        (token) => token.tokenHash === hashToken(bootstrapToken) && !token.consumedAt && new Date(token.expiresAt) > new Date(),
      );
      if (!tokenRecord) {
        return reply.code(401).send({ error: "Invalid bootstrap token" });
      }
      registrationScope = tokenRecord.bootstrapTokenId;
    } else {
      registrationScope = `lan-auto:${clientIp || "unknown"}`;
    }

    const body = registerAgentRequestSchema.parse(request.body ?? {});
    const result = await withIdempotency(
      state,
      "POST:/api/v1/agents/register",
      registrationScope,
      body.request_id ?? makeId("req"),
      () => {
        const token = createAgentToken();
        const agentId = makeId("agent");
        const createdAt = new Date().toISOString();
        const owner = state.users.get(body.owner_user_id);
        if (!owner || owner.deletedAt || (owner.status ?? "active") !== "active") {
          throw new Error("owner_user_id could not be resolved to an active user");
        }
        const agent: AgentRecord = {
          agentId,
          agentName: body.agent_name,
          machineName: body.machine_name,
          ownerUserId: body.owner_user_id,
          ipAddress: body.ip_address,
          localUiPort: body.local_ui_port,
          status: "online",
          runtimeVersion: body.runtime_version,
          osType: body.os_type,
          capabilities: body.capabilities,
          tokenHash: token.tokenHash,
          tokenPreview: token.tokenPreview,
          createdAt,
          updatedAt: createdAt,
        };
        state.agents.set(agent.agentId, agent);
        if (!lanAutoRegister && tokenRecord) {
          tokenRecord.consumedAt = new Date().toISOString();
          state.bootstrapTokens.set(tokenRecord.bootstrapTokenId, tokenRecord);
        }
        return {
          agent_id: agent.agentId,
          agent_token: token.token,
          poll_interval_seconds: config.pollIntervalSeconds,
        };
      },
    );

    return result;
  });

  app.post("/api/v1/agents/heartbeat", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }
    const body = heartbeatSchema.parse(request.body ?? {});
    if (body.agent_id !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    const occurredAt = body.occurred_at ?? new Date().toISOString();
    state.heartbeats.set(body.agent_id, {
      agentId: body.agent_id,
      occurredAt,
      status: body.status,
      currentLoad: body.current_load,
      lastSeenTasks: body.last_seen_tasks,
    });
    context.agent.status = body.status;
    context.agent.lastHeartbeatAt = occurredAt;
    context.agent.updatedAt = new Date().toISOString();
    state.agents.set(context.agent.agentId, context.agent);
    appendPlatformEvent(state, {
      request_id: body.request_id ?? makeId("req"),
      event_type: "agent.heartbeat",
      actor_type: "agent",
      actor_id: context.agent.agentId,
      source_agent_id: context.agent.agentId,
      source_machine: context.agent.machineName,
      payload: {
        current_load: body.current_load,
        last_seen_tasks: body.last_seen_tasks,
        status: body.status,
      },
      occurred_at: occurredAt,
    });
    return { accepted: true };
  });

  app.get("/api/v1/agents/:agentId/deliveries/pending", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    return [...state.tasks.values()]
      .filter((task) => task.assigneeAgentId === context.agent.agentId && task.status === "delivered")
      .map((task) => serializeTask(state, task));
  });

  app.get("/api/v1/agents/:agentId/tasks/current", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    return {
      tasks: [...state.tasks.values()]
        .filter((task) => task.assigneeUserId === context.agent.ownerUserId && overlayActiveTaskStatuses.has(task.status))
        .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt))
        .map((task) => serializeTask(state, task)),
    };
  });

  app.get("/api/v1/agents/:agentId/config", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    return {
      owner_user_id: context.agent.ownerUserId,
      owner_display_name: state.users.get(context.agent.ownerUserId)?.displayName ?? context.agent.ownerUserId,
      poll_interval_seconds: config.pollIntervalSeconds,
      active_hours_start: config.activeHoursStart,
      active_hours_end: config.activeHoursEnd,
      active_weekdays: config.activeWeekdays,
      local_ui_port: context.agent.localUiPort,
      platform_web_origin: config.appOrigin,
      max_file_size_bytes: config.maxFileSizeBytes,
    };
  });

  app.get("/api/v1/agents/:agentId/workflow-templates", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    return [...state.workflowTemplates.values()].filter((template) => template.is_active);
  });
}
