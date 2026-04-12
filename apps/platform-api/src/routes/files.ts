import { z } from "zod";

import type { PlatformRuntime } from "../context.js";
import { canReadTask, requireUserRead, requireWriteContext } from "../http.js";
import { filePathFromRel, resultTargetRel, withIdempotency } from "../runtime.js";
import { createFileReadStream, fileExists, fileHashAndSize, moveFile, sanitizeFileName, streamToFile } from "../storage/files.js";
import type { FileRecord } from "../types.js";
import { makeId } from "@flow-system/flow-protocol";

const uploadInitSchema = z.object({
  request_id: z.string().min(5).max(128).optional(),
  purpose: z.enum(["attachment", "result"]),
  original_name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  size_bytes: z.number().int().nonnegative(),
  sha256_declared: z.string().length(64),
  task_id: z.string().min(5).max(128).optional(),
});

const fileCompleteSchema = z.object({
  request_id: z.string().min(5).max(128),
  file_id: z.string().min(5).max(128),
});

export function registerFileRoutes(runtime: PlatformRuntime): void {
  const { app, state, config } = runtime;

  app.post("/api/v1/files/upload-init", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const body = uploadInitSchema.parse(request.body ?? {});
    if (body.size_bytes > config.maxFileSizeBytes) {
      return reply.code(400).send({ error: `Single file limit is ${config.maxFileSizeBytes} bytes` });
    }
    if (body.purpose === "result") {
      if (!body.task_id) {
        return reply.code(400).send({ error: "task_id is required for result uploads" });
      }
      const task = state.tasks.get(body.task_id);
      if (!task) {
        return reply.code(404).send({ error: "Task not found" });
      }
      if (context.kind === "agent" && task.assigneeAgentId !== context.agent.agentId) {
        return reply.code(403).send({ error: "Result upload is not allowed for this agent" });
      }
    }

    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    const requestId = body.request_id ?? makeId("req");
    const result = await withIdempotency(state, "POST:/api/v1/files/upload-init", actorId, requestId, () => {
      const fileId = makeId("file");
      const createdAt = new Date().toISOString();
      const record: FileRecord = {
        file_id: fileId,
        task_id: body.task_id,
        purpose: body.purpose,
        original_name: body.original_name,
        content_type: body.content_type,
        size_bytes: body.size_bytes,
        sha256_declared: body.sha256_declared,
        storage_rel_path: `staged/${fileId}.bin`,
        status: "staged",
        created_at: createdAt,
        updated_at: createdAt,
        allowedUploader: context.kind === "user" ? "user" : "agent",
        createdById: actorId,
      };
      state.fileObjects.set(fileId, record);
      return {
        file_id: fileId,
        upload_url: `/api/v1/files/${fileId}/content`,
        max_size_bytes: config.maxFileSizeBytes,
      };
    });

    return result;
  });

  app.put("/api/v1/files/:fileId/content", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const params = request.params as { fileId: string };
    const file = state.fileObjects.get(params.fileId);
    if (!file) {
      return reply.code(404).send({ error: "File not found" });
    }
    const actorKind = context.kind === "user" ? "user" : "agent";
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    if (file.allowedUploader !== actorKind || file.createdById !== actorId) {
      return reply.code(403).send({ error: "Uploader mismatch" });
    }
    const uploadBody = request.body;
    const source =
      uploadBody && typeof uploadBody === "object" && "pipe" in uploadBody
        ? uploadBody as NodeJS.ReadableStream
        : request.raw;
    await streamToFile(source, filePathFromRel(config, file.storage_rel_path));
    return reply.code(204).send();
  });

  app.post("/api/v1/files/complete", async (request, reply) => {
    const context = requireWriteContext(request, reply, state);
    if (!context) {
      return;
    }
    const actorId = context.kind === "user" ? context.user.userId : context.agent.agentId;
    const body = fileCompleteSchema.parse(request.body ?? {});
    const result = await withIdempotency(state, "POST:/api/v1/files/complete", actorId, body.request_id, async () => {
      const file = state.fileObjects.get(body.file_id);
      if (!file) {
        throw new Error("File not found");
      }
      const stagedPath = filePathFromRel(config, file.storage_rel_path);
      if (!fileExists(stagedPath)) {
        throw new Error("Uploaded file content not found");
      }
      const computed = await fileHashAndSize(stagedPath);
      if (computed.sha256 !== file.sha256_declared) {
        file.status = "failed";
        file.updated_at = new Date().toISOString();
        state.fileObjects.set(file.file_id, file);
        throw new Error("SHA256 mismatch");
      }
      if (computed.sizeBytes !== file.size_bytes) {
        file.status = "failed";
        file.updated_at = new Date().toISOString();
        state.fileObjects.set(file.file_id, file);
        throw new Error("File size mismatch");
      }
      file.sha256_actual = computed.sha256;
      file.status = "ready";
      file.updated_at = new Date().toISOString();
      if (file.purpose === "result" && file.task_id) {
        const targetRel = resultTargetRel(file.task_id, file);
        moveFile(stagedPath, filePathFromRel(config, targetRel));
        file.storage_rel_path = targetRel;
      }
      state.fileObjects.set(file.file_id, file);
      return {
        accepted: true,
        file_id: file.file_id,
        status: file.status,
        sha256_actual: file.sha256_actual,
        size_bytes: file.size_bytes,
      };
    });

    return result;
  });

  app.get("/api/v1/tasks/:taskId/attachments/:fileId", async (request, reply) => {
    const params = request.params as { taskId: string; fileId: string };
    const task = state.tasks.get(params.taskId);
    const file = state.fileObjects.get(params.fileId);
    if (!task || !file || file.task_id !== task.taskId || file.purpose !== "attachment") {
      return reply.code(404).send({ error: "Attachment not found" });
    }
    if (!canReadTask(request, state, task)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    reply.header("content-type", file.content_type);
    reply.header("content-disposition", `attachment; filename="${sanitizeFileName(file.original_name)}"`);
    return reply.send(createFileReadStream(filePathFromRel(config, file.storage_rel_path)));
  });

  app.get("/api/v1/projects/:projectId/attachments/:fileId", async (request, reply) => {
    if (!requireUserRead(request, reply, state)) {
      return;
    }
    const params = request.params as { projectId: string; fileId: string };
    const project = state.projects.get(params.projectId);
    const file = state.fileObjects.get(params.fileId);
    if (!project || !file || file.project_id !== project.projectId || file.purpose !== "attachment") {
      return reply.code(404).send({ error: "Project attachment not found" });
    }
    reply.header("content-type", file.content_type);
    reply.header("content-disposition", `attachment; filename="${sanitizeFileName(file.original_name)}"`);
    return reply.send(createFileReadStream(filePathFromRel(config, file.storage_rel_path)));
  });

  app.get("/api/v1/tasks/:taskId/results/:fileId", async (request, reply) => {
    const params = request.params as { taskId: string; fileId: string };
    const task = state.tasks.get(params.taskId);
    const file = state.fileObjects.get(params.fileId);
    if (!task || !file || file.task_id !== task.taskId || file.purpose !== "result") {
      return reply.code(404).send({ error: "Result file not found" });
    }
    if (!canReadTask(request, state, task)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    reply.header("content-type", file.content_type);
    reply.header("content-disposition", `attachment; filename="${sanitizeFileName(file.original_name)}"`);
    return reply.send(createFileReadStream(filePathFromRel(config, file.storage_rel_path)));
  });
}
