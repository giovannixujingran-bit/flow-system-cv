import { hashSync } from "bcryptjs";
import { z } from "zod";

import { makeId } from "@flow-system/flow-protocol";

import type { PlatformRuntime } from "../context.js";
import { requireUserRead, requireUserWrite } from "../http.js";
import { createUserRecord, storeUser } from "../state.js";
import { removeManagedUserDefinition, upsertManagedUserDefinition } from "../storage/managed-users.js";

const createUserSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/),
  display_name: z.string().min(1).max(120),
  role: z.enum(["admin", "owner", "member"]),
  password: z.string().min(6).max(200),
});

const updateUserSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
  role: z.enum(["admin", "owner", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  password: z.string().min(6).max(200).optional(),
});

function listUsers(state: PlatformRuntime["state"]) {
  return [...state.users.values()]
    .filter((user) => !user.deletedAt)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((user) => ({
      user_id: user.userId,
      username: user.username,
      display_name: user.displayName,
      role: user.role,
      status: user.status ?? "active",
      created_at: user.createdAt,
      updated_at: user.updatedAt ?? user.createdAt,
    }));
}

function countActiveAdmins(state: PlatformRuntime["state"]): number {
  return [...state.users.values()].filter((user) =>
    !user.deletedAt && user.role === "admin" && (user.status ?? "active") === "active").length;
}

function requireAdminRead(runtime: PlatformRuntime, request: Parameters<typeof requireUserRead>[0], reply: Parameters<typeof requireUserRead>[1]) {
  const context = requireUserRead(request, reply, runtime.state);
  if (!context) {
    return null;
  }
  if (context.user.role !== "admin") {
    reply.code(403).send({ error: "Admin access required" });
    return null;
  }
  return context;
}

function requireAdminWrite(runtime: PlatformRuntime, request: Parameters<typeof requireUserWrite>[0], reply: Parameters<typeof requireUserWrite>[1]) {
  const context = requireUserWrite(request, reply, runtime.state);
  if (!context) {
    return null;
  }
  if (context.user.role !== "admin") {
    reply.code(403).send({ error: "Admin access required" });
    return null;
  }
  return context;
}

export function registerUserRoutes(runtime: PlatformRuntime): void {
  const { app, state } = runtime;

  app.get("/api/v1/users", async (request, reply) => {
    const context = requireAdminRead(runtime, request, reply);
    if (!context) {
      return;
    }
    return {
      users: listUsers(state),
    };
  });

  app.post("/api/v1/users", async (request, reply) => {
    const context = requireAdminWrite(runtime, request, reply);
    if (!context) {
      return;
    }

    const body = createUserSchema.parse(request.body ?? {});
    const normalizedUsername = body.username.trim().toLowerCase();
    if (state.usersByUsername.has(normalizedUsername)) {
      return reply.code(400).send({ error: "Username already exists" });
    }

    const user = createUserRecord({
      userId: makeId("user"),
      username: normalizedUsername,
      displayName: body.display_name,
      role: body.role,
      password: body.password,
    });

    storeUser(state, user);
    if (runtime.config.seedMode === "managed") {
      upsertManagedUserDefinition(runtime.config, {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        status: user.status ?? "active",
        ...(body.password ? { password: body.password } : {}),
      });
    }

    return reply.code(201).send({
      accepted: true,
      user: {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        status: user.status,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  });

  app.patch("/api/v1/users/:userId", async (request, reply) => {
    const context = requireAdminWrite(runtime, request, reply);
    if (!context) {
      return;
    }

    const params = request.params as { userId: string };
    const body = updateUserSchema.parse(request.body ?? {});
    const user = state.users.get(params.userId);
    if (!user || user.deletedAt) {
      return reply.code(404).send({ error: "User not found" });
    }

    const nextRole = body.role ?? user.role;
    const nextStatus = body.status ?? (user.status ?? "active");
    const isLastActiveAdmin = user.role === "admin" && (user.status ?? "active") === "active" && countActiveAdmins(state) <= 1;

    if (user.userId === context.user.userId && nextStatus !== "active") {
      return reply.code(400).send({ error: "You cannot disable your own account" });
    }
    if (user.userId === context.user.userId && nextRole !== "admin") {
      return reply.code(400).send({ error: "You cannot remove your own admin role" });
    }
    if (isLastActiveAdmin && (nextRole !== "admin" || nextStatus !== "active")) {
      return reply.code(400).send({ error: "At least one active admin must remain" });
    }

    user.displayName = body.display_name?.trim() ?? user.displayName;
    user.role = nextRole;
    user.status = nextStatus;
    if (body.password) {
      user.passwordHash = hashSync(body.password, 10);
    }
    user.updatedAt = new Date().toISOString();
    state.users.set(user.userId, user);
    state.usersByUsername.set(user.username, user);
    if (runtime.config.seedMode === "managed") {
      upsertManagedUserDefinition(runtime.config, {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        status: user.status ?? "active",
        ...(body.password ? { password: body.password } : {}),
      });
    }

    if (nextStatus !== "active") {
      for (const session of [...state.sessions.values()]) {
        if (session.userId === user.userId) {
          state.sessions.delete(session.sessionId);
        }
      }
    }

    return {
      accepted: true,
      user: {
        user_id: user.userId,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        status: user.status,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    };
  });

  app.delete("/api/v1/users/:userId", async (request, reply) => {
    const context = requireAdminWrite(runtime, request, reply);
    if (!context) {
      return;
    }

    const params = request.params as { userId: string };
    const user = state.users.get(params.userId);
    if (!user || user.deletedAt) {
      return reply.code(404).send({ error: "User not found" });
    }

    const isLastActiveAdmin =
      user.role === "admin" &&
      (user.status ?? "active") === "active" &&
      countActiveAdmins(state) <= 1;

    if (user.userId === context.user.userId) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }
    if (isLastActiveAdmin) {
      return reply.code(400).send({ error: "At least one active admin must remain" });
    }

    for (const session of [...state.sessions.values()]) {
      if (session.userId === user.userId) {
        state.sessions.delete(session.sessionId);
      }
    }

    if (runtime.config.storageMode === "postgres") {
      user.status = "disabled";
      user.deletedAt = new Date().toISOString();
      user.updatedAt = user.deletedAt;
      state.users.set(user.userId, user);
      state.usersByUsername.set(user.username, user);

      if (runtime.config.seedMode === "managed") {
        upsertManagedUserDefinition(runtime.config, {
          user_id: user.userId,
          username: user.username,
          display_name: user.displayName,
          role: user.role,
          status: "disabled",
        });
      }
    } else {
      state.users.delete(user.userId);
      state.usersByUsername.delete(user.username);
      if (runtime.config.seedMode === "managed") {
        removeManagedUserDefinition(runtime.config, user.userId);
      }
    }

    return {
      accepted: true,
      deleted_user_id: user.userId,
    };
  });
}
