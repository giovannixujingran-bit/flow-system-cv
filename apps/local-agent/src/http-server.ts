import Fastify from "fastify";
import { overlayConversationSendSchema } from "@flow-system/local-overlay-contracts";
import { z } from "zod";

import type { LocalAgentConfig } from "./config.js";
import { LocalAgentRuntime } from "./agent.js";

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
}

function renderLocalAgentHome(): string {
  return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>本机代理</title>
    <style>
      body { font-family: Consolas, monospace; margin: 24px; background: #111318; color: #f5f7fb; }
      h1 { margin: 0 0 16px; }
      .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); padding: 16px; margin: 12px 0; border-radius: 16px; }
      button { margin-right: 8px; margin-top: 8px; }
      .meta { color: rgba(245,247,251,0.72); font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>本机代理</h1>
    <div class="card" id="update">正在加载更新状态...</div>
    <div id="tasks">正在加载任务...</div>
    <script>
      const statusLabels = {
        new: "新建",
        delivered: "已投递",
        received: "已接收",
        accepted: "已接手",
        in_progress: "进行中",
        waiting_review: "待审核",
        done: "已完成",
        archived: "已归档",
        invalid: "无效"
      };

      function statusText(value) {
        return statusLabels[value] || value || "-";
      }

      async function post(url, options) {
        await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, ...options });
        render();
        renderUpdate();
      }

      async function renderUpdate() {
        const response = await fetch("/api/update/status");
        const update = await response.json();
        const button = update.update_available ? '<button onclick="applyUpdate()">更新本机代理</button>' : "";
        const latestVersion = update.latest_version || "-";
        const message = update.apply_message || (update.update_available ? "发现新版本，可更新" : "当前已是最新版本");
        const notes = update.release && update.release.notes ? '<div class="meta">更新说明：' + update.release.notes + '</div>' : "";

        document.getElementById("update").innerHTML = [
          '<strong>代理更新</strong>',
          '<div class="meta">当前版本：' + (update.current_version || "-") + '</div>',
          '<div class="meta">最新版本：' + latestVersion + '</div>',
          '<div class="meta">状态：' + message + '</div>',
          notes,
          button
        ].join("");
      }

      async function applyUpdate() {
        await fetch("/api/update/apply", { method: "POST" });
        document.getElementById("update").innerHTML = '<strong>代理更新</strong><div class="meta">正在应用更新，请稍等...</div>';
      }

      async function render() {
        const res = await fetch("/api/tasks");
        const tasks = await res.json();
        if (!Array.isArray(tasks) || tasks.length === 0) {
          document.getElementById("tasks").innerHTML = '<div class="card">当前没有任务。</div>';
          return;
        }

        document.getElementById("tasks").innerHTML = tasks.map(task => {
          const checklist = Array.isArray(task.checklist) ? task.checklist : [];
          const checklistHtml = checklist.map(item => \`
            <li>
              <label>
                <input type="checkbox" \${item.status === "done" ? "checked" : ""} onchange="post('/api/tasks/\${task.task_id}/checklist/\${item.checklist_item_id}', { body: JSON.stringify({ status: this.checked ? 'done' : 'pending' }) })" />
                \${item.item_title}
              </label>
            </li>\`).join("");

          return \`
            <div class="card">
              <strong>\${task.task_title}</strong>
              <div class="meta">状态：\${statusText(task.status)} | 截止时间：\${task.deadline}</div>
              <div class="meta">路径：\${task.local_task_path}</div>
              <div>
                <button onclick="post('/api/tasks/\${task.task_id}/accept')">接手</button>
                <button onclick="post('/api/tasks/\${task.task_id}/start')">开始执行</button>
                <button onclick="post('/api/tasks/\${task.task_id}/actions', { body: JSON.stringify({ action_type: 'open_task_folder', confirm_start: false }) })">打开任务目录</button>
                <button onclick="post('/api/tasks/\${task.task_id}/submit')">提交结果</button>
              </div>
              <ul>\${checklistHtml}</ul>
            </div>\`;
        }).join("");
      }

      renderUpdate();
      render();
      setInterval(renderUpdate, 15000);
      setInterval(render, 10000);
    </script>
  </body>
</html>
  `;
}

export function createLocalAgentApp(runtime: LocalAgentRuntime, config: LocalAgentConfig) {
  const app = Fastify({
    logger: true,
  });
  const openClawSelectionBodySchema = z.object({
    selected_path: z.string().min(1).optional(),
  });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const accessRequestPrivateNetwork = request.headers["access-control-request-private-network"];
    const allowedOrigins = new Set(runtime.getAllowedWebOrigins());
    if (origin && allowedOrigins.has(normalizeOrigin(origin))) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "origin");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
      if (String(accessRequestPrivateNetwork).toLowerCase() === "true") {
        reply.header("access-control-allow-private-network", "true");
      }
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.get("/health", async () => ({
    ok: true,
  }));

  app.get("/api/tasks", async () => runtime.listTasks());

  app.get("/api/tasks/:taskId", async (request, reply) => {
    const params = request.params as { taskId: string };
    const task = runtime.getTask(params.taskId);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return task;
  });

  app.post("/api/tasks/:taskId/accept", async (request, reply) => {
    const params = request.params as { taskId: string };
    await runtime.acceptTask(params.taskId);
    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/start", async (request, reply) => {
    const params = request.params as { taskId: string };
    await runtime.startTask(params.taskId);
    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/checklist/:itemId", async (request, reply) => {
    const params = request.params as { taskId: string; itemId: string };
    const body = z.object({
      status: z.enum(["pending", "in_progress", "done"]),
    }).parse(request.body ?? {});
    await runtime.updateChecklist(params.taskId, params.itemId, body.status);
    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/actions", async (request, reply) => {
    const params = request.params as { taskId: string };
    const body = z.object({
      action_type: z.enum(["open_task_folder", "open_attachment", "open_output_folder"]),
      file_name: z.string().optional(),
      confirm_start: z.boolean().optional().default(false),
    }).parse(request.body ?? {});
    await runtime.triggerAction(params.taskId, body.action_type, body.file_name, body.confirm_start);
    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/submit", async (request, reply) => {
    const params = request.params as { taskId: string };
    await runtime.submitResults(params.taskId);
    return reply.code(204).send();
  });

  app.get("/api/update/status", async () => runtime.syncUpdateStatus());

  app.post("/api/update/apply", async (_request, reply) => {
    const result = await runtime.applyAvailableUpdate();
    return reply.code(202).send(result);
  });

  app.get("/api/openclaw/status", async () => runtime.getOpenClawStatus());
  app.post("/api/openclaw/select-executable", async (request) => {
    const body = openClawSelectionBodySchema.parse(request.body ?? {});
    return runtime.selectOpenClawExecutable(body.selected_path);
  });
  app.post("/api/openclaw/select-root", async (request) => {
    const body = openClawSelectionBodySchema.parse(request.body ?? {});
    return runtime.selectOpenClawRoot(body.selected_path);
  });
  app.post("/api/openclaw/revalidate", async () => runtime.revalidateOpenClaw());
  app.post("/api/openclaw/reset", async () => runtime.resetOpenClaw());

  app.get("/api/overlay/bootstrap", async () => runtime.getOverlayBootstrap());
  app.get("/api/overlay/health", async () => runtime.getOverlayHealth());
  app.get("/api/overlay/conversations", async () => runtime.getOverlayConversations());
  app.post("/api/overlay/conversations/messages", async (request, reply) => {
    const body = overlayConversationSendSchema.parse(request.body ?? {});
    const result = await runtime.sendOverlayConversationMessage(body.body);
    return reply.code(202).send(result);
  });
  app.get("/api/overlay/tasks/current", async () => ({
    tasks: await runtime.listOverlayCurrentTasks(),
  }));
  app.post("/api/overlay/tasks/:taskId/open", async (request, reply) => {
    const params = request.params as { taskId: string };
    const result = await runtime.openOverlayTask(params.taskId);
    return reply.code(202).send(result);
  });

  app.get("/", async () => renderLocalAgentHome());

  return app;
}
