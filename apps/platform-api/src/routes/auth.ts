import { z } from "zod";

import { compareSync } from "bcryptjs";

import { createSession } from "../state.js";
import type { PlatformRuntime } from "../context.js";

const SESSION_COOKIE = "flow_session";
const CSRF_COOKIE = "flow_csrf";

export function registerAuthRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).parse(request.body ?? {});
    const user = state.usersByUsername.get(body.username.trim().toLowerCase());
    if (!user || !compareSync(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    if ((user.status ?? "active") !== "active") {
      return reply.code(403).send({ error: "User is disabled" });
    }

    const session = createSession(user.userId, config.sessionTtlMs);
    state.sessions.set(session.sessionId, session);
    reply.setCookie(SESSION_COOKIE, session.sessionId, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date(session.expiresAt),
    });
    reply.setCookie(CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date(session.expiresAt),
    });

    return {
      user: {
        user_id: user.userId,
        username: user.username,
        role: user.role,
        display_name: user.displayName,
        status: user.status ?? "active",
      },
      csrf_token: session.csrfToken,
      session_ttl_hours: config.sessionTtlMs / 3600000,
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const parsed = request.unsignCookie(raw);
      if (parsed.valid) {
        state.sessions.delete(parsed.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = request.unsignCookie(raw);
    if (!parsed.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const session = state.sessions.get(parsed.value);
    if (!session || new Date(session.expiresAt) <= new Date()) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const user = state.users.get(session.userId);
    if (!user || user.deletedAt) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return {
      user_id: user.userId,
      username: user.username,
      role: user.role,
      display_name: user.displayName,
      status: user.status ?? "active",
      csrf_token: session.csrfToken,
    };
  });
}
