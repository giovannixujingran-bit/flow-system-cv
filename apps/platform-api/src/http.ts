import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppState, SessionRecord, TaskRecord, UserRecord, AgentRecord } from "./types.js";
import { hashToken } from "./state.js";
import { isTaskVisibleToAgent } from "./runtime.js";

const SESSION_COOKIE = "flow_session";
const CSRF_COOKIE = "flow_csrf";

export type RequestContext =
  | { kind: "user"; user: UserRecord; session: SessionRecord }
  | { kind: "agent"; agent: AgentRecord };

function getSignedCookie(request: FastifyRequest, cookieName: string): string | null {
  const raw = request.cookies[cookieName];
  if (!raw) {
    return null;
  }
  const parsed = request.unsignCookie(raw);
  return parsed.valid ? parsed.value : null;
}

function getSessionContext(request: FastifyRequest, state: AppState): RequestContext | null {
  const sessionId = getSignedCookie(request, SESSION_COOKIE);
  if (!sessionId) {
    return null;
  }
  const session = state.sessions.get(sessionId);
  if (!session || new Date(session.expiresAt) <= new Date()) {
    return null;
  }
  const user = state.users.get(session.userId);
  if (!user) {
    return null;
  }
  if (user.deletedAt) {
    return null;
  }
  if ((user.status ?? "active") !== "active") {
    return null;
  }
  return { kind: "user", user, session };
}

function getAgentContext(request: FastifyRequest, state: AppState): RequestContext | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  const tokenHash = hashToken(token);
  const agent = [...state.agents.values()].find((candidate) => candidate.tokenHash === tokenHash);
  return agent ? { kind: "agent", agent } : null;
}

export function requireUserRead(request: FastifyRequest, reply: FastifyReply, state: AppState): Extract<RequestContext, { kind: "user" }> | null {
  const context = getSessionContext(request, state);
  if (!context || context.kind !== "user") {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  return context;
}

export function requireUserWrite(request: FastifyRequest, reply: FastifyReply, state: AppState): Extract<RequestContext, { kind: "user" }> | null {
  const context = requireUserRead(request, reply, state);
  if (!context) {
    return null;
  }
  const csrfCookie = request.cookies[CSRF_COOKIE];
  const csrfHeader = request.headers["x-csrf-token"];
  if (typeof csrfHeader !== "string" || csrfCookie !== context.session.csrfToken || csrfHeader !== context.session.csrfToken) {
    reply.code(403).send({ error: "CSRF validation failed" });
    return null;
  }
  return context;
}

export function requireAgent(request: FastifyRequest, reply: FastifyReply, state: AppState): Extract<RequestContext, { kind: "agent" }> | null {
  const context = getAgentContext(request, state);
  if (!context || context.kind !== "agent") {
    reply.code(401).send({ error: "Agent bearer token required" });
    return null;
  }
  return context;
}

export function requireWriteContext(request: FastifyRequest, reply: FastifyReply, state: AppState): RequestContext | null {
  return getAgentContext(request, state) ?? requireUserWrite(request, reply, state);
}

export function canReadTask(request: FastifyRequest, state: AppState, task: TaskRecord): boolean {
  const user = getSessionContext(request, state);
  if (user?.kind === "user") {
    return true;
  }
  const agent = getAgentContext(request, state);
  return Boolean(agent && agent.kind === "agent" && isTaskVisibleToAgent(task, agent.agent));
}
