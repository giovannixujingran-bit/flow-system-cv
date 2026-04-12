import { z } from "zod";

import { createFileReadStream, fileExists, fileHashAndSize } from "../storage/files.js";
import { currentAgentReleasePath, resolveAgentReleasePackagePath, saveCurrentAgentRelease } from "../storage/releases.js";
import type { PlatformRuntime } from "../context.js";
import { requireAgent, requireUserRead, requireUserWrite } from "../http.js";
import { filePathFromRel, isAgentUpdateAvailable } from "../runtime.js";

const publishAgentReleaseSchema = z.object({
  version: z.string().min(1).max(50),
  notes: z.string().max(4000).default(""),
  package_rel_path: z.string().min(1).max(500),
  package_sha256: z.string().length(64),
  package_size_bytes: z.number().int().positive(),
  minimum_runtime_version: z.string().min(1).max(50).optional(),
});

function serializeRelease(release: NonNullable<PlatformRuntime["state"]["currentAgentRelease"]>) {
  return {
    version: release.version,
    notes: release.notes,
    package_rel_path: release.packageRelPath,
    package_sha256: release.packageSha256,
    package_size_bytes: release.packageSizeBytes,
    minimum_runtime_version: release.minimumRuntimeVersion,
    published_by_user_id: release.publishedByUserId,
    published_at: release.publishedAt,
  };
}

export function registerReleaseRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.get("/api/v1/releases/agents/current", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }

    if (!state.currentAgentRelease) {
      return reply.code(404).send({ error: "No agent release has been published" });
    }

    return serializeRelease(state.currentAgentRelease);
  });

  app.post("/api/v1/releases/agents/current", async (request, reply) => {
    const context = requireUserWrite(request, reply, state);
    if (!context) {
      return;
    }
    if (!["admin", "owner"].includes(context.user.role)) {
      return reply.code(403).send({ error: "Only owner or admin can publish agent releases" });
    }

    const body = publishAgentReleaseSchema.parse(request.body ?? {});
    const packagePath = resolveAgentReleasePackagePath(config, body.package_rel_path);
    if (!fileExists(packagePath)) {
      return reply.code(400).send({ error: "Release package file does not exist" });
    }

    const actual = await fileHashAndSize(packagePath);
    if (actual.sha256 !== body.package_sha256) {
      return reply.code(400).send({ error: "Release package SHA256 mismatch" });
    }
    if (actual.sizeBytes !== body.package_size_bytes) {
      return reply.code(400).send({ error: "Release package size mismatch" });
    }

    const release = {
      version: body.version,
      notes: body.notes,
      packageRelPath: body.package_rel_path,
      packageSha256: body.package_sha256,
      packageSizeBytes: body.package_size_bytes,
      ...(body.minimum_runtime_version ? { minimumRuntimeVersion: body.minimum_runtime_version } : {}),
      publishedByUserId: context.user.userId,
      publishedAt: new Date().toISOString(),
    };

    state.currentAgentRelease = release;
    state.agentReleases.set(release.version, release);
    saveCurrentAgentRelease(config, release);

    return {
      accepted: true,
      manifest_path: currentAgentReleasePath(config),
      release: serializeRelease(release),
    };
  });

  app.get("/api/v1/agents/:agentId/releases/current", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }

    return {
      current_version: context.agent.runtimeVersion,
      update_available: isAgentUpdateAvailable(state, context.agent.runtimeVersion),
      release: state.currentAgentRelease ? {
        ...serializeRelease(state.currentAgentRelease),
        package_url: `/api/v1/agents/${context.agent.agentId}/releases/current/package`,
      } : null,
    };
  });

  app.get("/api/v1/agents/:agentId/releases/current/package", async (request, reply) => {
    const context = requireAgent(request, reply, state);
    if (!context) {
      return;
    }

    const params = request.params as { agentId: string };
    if (params.agentId !== context.agent.agentId) {
      return reply.code(403).send({ error: "Agent mismatch" });
    }
    if (!state.currentAgentRelease) {
      return reply.code(404).send({ error: "No agent release has been published" });
    }

    const packagePath = filePathFromRel(config, state.currentAgentRelease.packageRelPath);
    if (!fileExists(packagePath)) {
      return reply.code(404).send({ error: "Release package file is missing" });
    }

    reply.header("content-type", "application/gzip");
    reply.header("content-disposition", `attachment; filename=\"flow-system-agent-${state.currentAgentRelease.version}.tar.gz\"`);
    return reply.send(createFileReadStream(packagePath));
  });
}
