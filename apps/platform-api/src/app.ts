import { ZodError } from "zod";

import cookie from "@fastify/cookie";
import Fastify from "fastify";

import type { PlatformRuntime } from "./context.js";
import { readPlatformApiConfig } from "./config.js";
import { ensureStorageRoots, runRiskScan } from "./runtime.js";
import { createAppState, storeUser } from "./state.js";
import { currentSchemaVersion } from "./db/constants.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerReleaseRoutes } from "./routes/releases.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerUserRoutes } from "./routes/users.js";
import { applyPlatformStateSnapshot, loadPlatformStateSnapshot, savePlatformStateSnapshot } from "./storage/app-state.js";
import { loadManagedUsers, syncManagedUserArtifacts } from "./storage/managed-users.js";
import {
  isPostgresStateEmpty,
  loadPlatformStateFromPostgres,
  savePlatformStateToPostgres,
  writeSystemMetaValues,
} from "./storage/postgres-state.js";
import { loadCurrentAgentRelease } from "./storage/releases.js";

function shouldPersistPlatformState(
  method: string,
  url: string,
  statusCode: number,
  storageMode: "memory" | "postgres",
): boolean {
  if (statusCode >= 400) {
    return false;
  }

  const normalizedMethod = method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    return false;
  }

  if (storageMode === "postgres") {
    return true;
  }

  const pathname = url.split("?", 2)[0] ?? url;
  return pathname !== "/api/v1/auth/login"
    && pathname !== "/api/v1/auth/logout"
    && pathname !== "/api/v1/agents/heartbeat";
}

function loadManagedUsersIntoState(runtime: Pick<PlatformRuntime, "config" | "state">): void {
  const managedUsers = loadManagedUsers(runtime.config);
  for (const user of managedUsers) {
    storeUser(runtime.state, user);
  }
  syncManagedUserArtifacts(runtime.config);
}

async function initializeRuntimeState(runtime: PlatformRuntime): Promise<void> {
  const { config, state } = runtime;

  ensureStorageRoots(config);

  if (config.storageMode === "memory") {
    const currentAgentRelease = loadCurrentAgentRelease(config);
    if (currentAgentRelease) {
      state.currentAgentRelease = currentAgentRelease;
      state.agentReleases.set(currentAgentRelease.version, currentAgentRelease);
    }

    if (config.seedMode === "managed") {
      loadManagedUsersIntoState(runtime);
    }

    if (config.seedMode !== "demo") {
      const snapshot = loadPlatformStateSnapshot(config);
      if (snapshot) {
        applyPlatformStateSnapshot(state, snapshot, {
          includeUsers: config.seedMode !== "managed",
        });
      }
    }
    return;
  }

  const isEmpty = await isPostgresStateEmpty(config);
  if (isEmpty) {
    if (config.failIfDbEmptyAndNoImport && !config.importCurrentState && config.seedMode !== "demo") {
      throw new Error(
        "PostgreSQL storage is empty. Run the import step first or start with FAIL_IF_DB_EMPTY_AND_NO_IMPORT=false.",
      );
    }

    if (config.seedMode === "managed") {
      loadManagedUsersIntoState(runtime);
    }

    await savePlatformStateToPostgres(config, state);
  } else {
    await loadPlatformStateFromPostgres(config, state);
  }

  await writeSystemMetaValues(config, {
    schema_version: currentSchemaVersion,
    storage_mode: config.storageMode,
  });
}

export function createPlatformApiRuntime(): PlatformRuntime {
  const config = readPlatformApiConfig();
  const state = createAppState({ seedMode: config.seedMode === "demo" ? "demo" : "empty" });

  const app = Fastify({
    logger: true,
    bodyLimit: config.maxFileSizeBytes,
  });

  app.addContentTypeParser("*", (request, payload, done) => {
    done(null, payload);
  });

  app.register(cookie, {
    secret: config.cookieSecret,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: error.issues,
      });
    }
    if (error instanceof Error) {
      return reply.code(400).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal server error" });
  });

  let persistChain = Promise.resolve();
  const runtime: PlatformRuntime = {
    app,
    state,
    config,
    scanRisks: () => runRiskScan(state, config),
    ready: Promise.resolve(),
    persistState: async () => {
      persistChain = persistChain
        .catch(() => undefined)
        .then(async () => {
          if (config.seedMode === "demo") {
            return;
          }
          if (config.storageMode === "postgres") {
            await savePlatformStateToPostgres(config, state);
            return;
          }
          savePlatformStateSnapshot(config, state);
        });
      await persistChain;
    },
  };

  runtime.ready = initializeRuntimeState(runtime);

  app.addHook("onRequest", async () => {
    await runtime.ready;
  });

  app.addHook("onResponse", async (request, reply) => {
    if (shouldPersistPlatformState(request.method, request.url, reply.statusCode, config.storageMode)) {
      await runtime.persistState();
    }
  });

  registerAuthRoutes(runtime);
  registerSetupRoutes(runtime);
  registerCatalogRoutes(runtime);
  registerAgentRoutes(runtime);
  registerConversationRoutes(runtime);
  registerFileRoutes(runtime);
  registerProjectRoutes(runtime);
  registerReleaseRoutes(runtime);
  registerTaskRoutes(runtime);
  registerUserRoutes(runtime);

  return runtime;
}
