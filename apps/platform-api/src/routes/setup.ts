import { z } from "zod";

import type { PlatformRuntime } from "../context.js";
import { createUserRecord, storeUser } from "../state.js";

const initializeSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/),
  display_name: z.string().min(1).max(120),
  password: z.string().min(6).max(200),
});

function isInitialized(state: PlatformRuntime["state"]): boolean {
  return state.users.size > 0;
}

function selfInitializeAllowed(runtime: PlatformRuntime): boolean {
  return runtime.config.seedMode === "empty";
}

export function registerSetupRoutes(runtime: PlatformRuntime): void {
  const { app, state } = runtime;

  app.get("/api/v1/setup/status", async () => ({
    initialized: isInitialized(state),
    user_count: state.users.size,
    self_initialize_allowed: selfInitializeAllowed(runtime),
  }));

  app.post("/api/v1/setup/initialize", async (request, reply) => {
    if (!selfInitializeAllowed(runtime)) {
      return reply.code(403).send({ error: "Self initialization is disabled" });
    }
    if (isInitialized(state)) {
      return reply.code(409).send({ error: "Platform is already initialized" });
    }

    const body = initializeSchema.parse(request.body ?? {});
    const normalizedUsername = body.username.trim().toLowerCase();
    const user = createUserRecord({
      userId: "user_admin",
      username: normalizedUsername,
      displayName: body.display_name,
      role: "admin",
      password: body.password,
    });

    storeUser(state, user);

    return reply.code(201).send({
      accepted: true,
      user: {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        status: user.status ?? "active",
        created_at: user.createdAt,
        updated_at: user.updatedAt ?? user.createdAt,
      },
    });
  });
}
