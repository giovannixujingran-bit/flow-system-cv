import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlatformApiRuntime } from "../apps/platform-api/src/app.js";
import { LocalAgentRuntime } from "../apps/local-agent/src/agent.js";
import type { LocalAgentConfig } from "../apps/local-agent/src/config.js";
import { AgentDatabase } from "../apps/local-agent/src/db.js";
import { createLocalAgentApp } from "../apps/local-agent/src/http-server.js";
import { AgentLogger } from "../apps/local-agent/src/logger.js";

type SessionContext = {
  cookieHeader: string;
  csrfToken: string;
};

type MockOpenClawRuntime = {
  binPath: string;
  userProfileRoot: string;
};

function createMockOpenClawRuntime(root: string): MockOpenClawRuntime {
  const userProfileRoot = path.join(root, "user-profile");
  const stateDir = path.join(userProfileRoot, ".openclaw");
  const authDir = path.join(stateDir, "agents", "main", "agent");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "openclaw.json"), JSON.stringify({ ok: true }, null, 2), "utf8");
  fs.writeFileSync(path.join(authDir, "auth-profiles.json"), JSON.stringify({ profiles: [] }, null, 2), "utf8");

  const binPath = path.join(root, "mock-openclaw.cmd");
  fs.writeFileSync(
    binPath,
    [
      "@echo off",
      "setlocal",
      "if /I \"%~1\"==\"--version\" (",
      "  echo OpenClaw 2026.3.8",
      "  exit /b 0",
      ")",
      "if /I \"%~1\"==\"gateway\" if /I \"%~2\"==\"status\" (",
      "  echo RPC probe: ok",
      "  exit /b 0",
      ")",
      "if /I \"%~1\"==\"agent\" (",
      "  echo {\"status\":\"ok\",\"result\":{\"payloads\":[{\"text\":\"mock-openclaw-probe\"}]}}",
      "  exit /b 0",
      ")",
      "echo unsupported command>&2",
      "exit /b 1",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return {
    binPath,
    userProfileRoot,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractCookieHeader(setCookieHeader: string | string[] | undefined): string {
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function login(
  app: ReturnType<typeof createPlatformApiRuntime>["app"],
  username: string,
  password: string,
): Promise<SessionContext> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      username,
      password,
    },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json() as { csrf_token: string };
  return {
    cookieHeader: extractCookieHeader(response.headers["set-cookie"]),
    csrfToken: body.csrf_token,
  };
}

async function createReadyAttachment(
  app: ReturnType<typeof createPlatformApiRuntime>["app"],
  owner: SessionContext,
  content: string,
): Promise<string> {
  const uploadInit = await app.inject({
    method: "POST",
    url: "/api/v1/files/upload-init",
    headers: {
      cookie: owner.cookieHeader,
      "x-csrf-token": owner.csrfToken,
    },
    payload: {
      request_id: "req_agent_upload_init",
      purpose: "attachment",
      original_name: "report.xlsx",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size_bytes: Buffer.byteLength(content),
      sha256_declared: sha256(content),
    },
  });
  expect(uploadInit.statusCode).toBe(200);
  const { file_id: fileId } = uploadInit.json() as { file_id: string };

  const uploadContent = await app.inject({
    method: "PUT",
    url: `/api/v1/files/${fileId}/content`,
    headers: {
      cookie: owner.cookieHeader,
      "x-csrf-token": owner.csrfToken,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    payload: Buffer.from(content),
  });
  expect(uploadContent.statusCode).toBe(204);

  const complete = await app.inject({
    method: "POST",
    url: "/api/v1/files/complete",
    headers: {
      cookie: owner.cookieHeader,
      "x-csrf-token": owner.csrfToken,
    },
    payload: {
      request_id: "req_agent_upload_complete",
      file_id: fileId,
    },
  });
  expect(complete.statusCode).toBe(200);
  return fileId;
}

function createAgentConfig(
  address: string,
  root: string,
  openClawBin: string,
  overrides: Partial<LocalAgentConfig> = {},
): LocalAgentConfig {
  return {
    platformApiBaseUrl: address,
    platformWebOrigin: "http://127.0.0.1:3000",
    bootstrapToken: "flow-bootstrap-local",
    agentId: undefined,
    agentToken: undefined,
    agentName: "B-PC",
    ownerUserId: "user_member",
    runtimeVersion: "0.1.0",
    appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
    uiHost: "127.0.0.1",
    uiPort: 38500,
    pollIntervalSeconds: 60,
    updateCheckIntervalSeconds: 60,
    flowRoot: root,
    conversationsRoot: path.join(root, "conversations"),
    tasksRoot: path.join(root, "tasks"),
    tmpRoot: path.join(root, "tmp"),
    updatesRoot: path.join(root, "updates"),
    recoveryRoot: path.join(root, "recovery"),
    overlayDataRoot: path.join(root, "overlay-data"),
    dataRoot: path.join(root, "agent-data"),
    logsRoot: path.join(root, "agent-data", "logs"),
    backupsRoot: path.join(root, "agent-data", "backups"),
    databasePath: path.join(root, "agent-data", "agent.sqlite"),
    logFilePath: path.join(root, "agent-data", "logs", "agent.log"),
    openClawConnectionPath: path.join(root, "agent-data", "openclaw-connection.json"),
    openClawBin,
    openClawTimeoutSeconds: 90,
    openClawAutoReplyEnabled: false,
    nodeExecutablePath: process.execPath,
    npmCliPath: undefined,
    restartCommand: "true",
    maxOutboxWarning: 1000,
    maxOutboxHardLimit: 5000,
    recoveryRetentionDays: 7,
    ...overrides,
  };
}

describe("local agent", () => {
  let storageRoot: string;
  let flowRoot: string;
  let mockOpenClaw: MockOpenClawRuntime;
  const originalUserProfile = process.env.USERPROFILE;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flow-system-storage-"));
    flowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flow-system-agent-"));
    mockOpenClaw = createMockOpenClawRuntime(flowRoot);
    process.env.STORAGE_ROOT = storageRoot;
    process.env.FLOW_SEED_MODE = "demo";
    process.env.USERPROFILE = mockOpenClaw.userProfileRoot;
    process.env.HOME = mockOpenClaw.userProfileRoot;
  });

  afterEach(() => {
    delete process.env.STORAGE_ROOT;
    delete process.env.FLOW_SEED_MODE;
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(flowRoot, { recursive: true, force: true });
  });

  it("registers, pulls delivered tasks, downloads attachments, and reports received", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config: LocalAgentConfig = {
      platformApiBaseUrl: address,
      platformWebOrigin: "http://127.0.0.1:3000",
      bootstrapToken: "flow-bootstrap-local",
      agentId: undefined,
      agentToken: undefined,
      agentName: "B-PC",
      ownerUserId: "user_member",
      runtimeVersion: "0.1.0",
      appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
      uiHost: "127.0.0.1",
      uiPort: 38500,
      pollIntervalSeconds: 60,
      updateCheckIntervalSeconds: 60,
      flowRoot,
      conversationsRoot: path.join(flowRoot, "conversations"),
      tasksRoot: path.join(flowRoot, "tasks"),
      tmpRoot: path.join(flowRoot, "tmp"),
      updatesRoot: path.join(flowRoot, "updates"),
      recoveryRoot: path.join(flowRoot, "recovery"),
      overlayDataRoot: path.join(flowRoot, "overlay-data"),
      dataRoot: path.join(flowRoot, "agent-data"),
      logsRoot: path.join(flowRoot, "agent-data", "logs"),
      backupsRoot: path.join(flowRoot, "agent-data", "backups"),
      databasePath: path.join(flowRoot, "agent-data", "agent.sqlite"),
      logFilePath: path.join(flowRoot, "agent-data", "logs", "agent.log"),
      openClawConnectionPath: path.join(flowRoot, "agent-data", "openclaw-connection.json"),
      openClawBin: mockOpenClaw.binPath,
      openClawTimeoutSeconds: 90,
      openClawAutoReplyEnabled: false,
      nodeExecutablePath: process.execPath,
      npmCliPath: undefined,
      restartCommand: "true",
      maxOutboxWarning: 1000,
      maxOutboxHardLimit: 5000,
      recoveryRetentionDays: 7,
    };

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const agentInternals = agentRuntime as unknown as {
      runIntakeCycle(): Promise<void>;
      flushOutbox(): Promise<void>;
      stop(): void;
    };

    try {
      await agentRuntime.start();
      const agent = [...platformRuntime.state.agents.values()][0];
      expect(agent?.agentId).toBeTruthy();

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const fileId = await createReadyAttachment(platformRuntime.app, owner, "hello");

      const delivery = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/task-deliveries",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_agent_delivery",
          project_id: "proj_demo",
          workflow_id: "wf_demo",
          workflow_template_id: "wf_tmpl_demo_v1",
          template_version: 1,
          step_id: "step_excel_revise",
          task_title: "Agent intake demo",
          task_type: "excel_handoff",
          sender_user_id: "user_owner",
          target_user_id: "user_member",
          target_agent_id: agent?.agentId,
          priority: "high",
          deadline: "2026-03-10T18:00:00+08:00",
          summary: "Verify intake flow",
          constraints: [],
          deliverables: ["Update sheet 2"],
          attachment_file_ids: [fileId],
          plan_mode: "structured",
        },
      });
      expect(delivery.statusCode).toBe(200);
      const { task_id: taskId } = delivery.json() as { task_id: string };

      await agentInternals.runIntakeCycle();
      await agentInternals.flushOutbox();

      const localTask = db.connection.prepare("select * from local_tasks where task_id = ?").get(taskId) as {
        status: string;
        local_task_path: string;
        output_path: string;
      } | undefined;
      expect(localTask).toBeTruthy();
      expect(localTask?.status).toBe("received");

      const downloadedFile = path.join(localTask!.local_task_path, "input");
      const entries = fs.readdirSync(downloadedFile);
      expect(entries.length).toBe(1);
      expect(entries[0]).toContain(fileId);

      const remoteTask = platformRuntime.state.tasks.get(taskId);
      expect(remoteTask?.status).toBe("received");

      const outboxPending = db.connection
        .prepare("select count(*) as count from sync_outbox where status = 'pending'")
        .get() as { count: number };
      expect(outboxPending.count).toBe(0);
    } finally {
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("serves overlay bootstrap, current tasks, and self conversation send through local routes", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config: LocalAgentConfig = {
      platformApiBaseUrl: address,
      platformWebOrigin: "http://127.0.0.1:3000",
      bootstrapToken: "flow-bootstrap-local",
      agentId: undefined,
      agentToken: undefined,
      agentName: "OVERLAY-PC",
      ownerUserId: "user_member",
      runtimeVersion: "0.1.0",
      appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
      uiHost: "127.0.0.1",
      uiPort: 38500,
      pollIntervalSeconds: 60,
      updateCheckIntervalSeconds: 60,
      flowRoot,
      conversationsRoot: path.join(flowRoot, "conversations"),
      tasksRoot: path.join(flowRoot, "tasks"),
      tmpRoot: path.join(flowRoot, "tmp"),
      updatesRoot: path.join(flowRoot, "updates"),
      recoveryRoot: path.join(flowRoot, "recovery"),
      overlayDataRoot: path.join(flowRoot, "overlay-data"),
      dataRoot: path.join(flowRoot, "agent-data"),
      logsRoot: path.join(flowRoot, "agent-data", "logs"),
      backupsRoot: path.join(flowRoot, "agent-data", "backups"),
      databasePath: path.join(flowRoot, "agent-data", "agent.sqlite"),
      logFilePath: path.join(flowRoot, "agent-data", "logs", "agent.log"),
      openClawConnectionPath: path.join(flowRoot, "agent-data", "openclaw-connection.json"),
      openClawBin: mockOpenClaw.binPath,
      openClawTimeoutSeconds: 90,
      openClawAutoReplyEnabled: false,
      nodeExecutablePath: process.execPath,
      npmCliPath: undefined,
      restartCommand: "true",
      maxOutboxWarning: 1000,
      maxOutboxHardLimit: 5000,
      recoveryRetentionDays: 7,
    };

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const agentInternals = agentRuntime as unknown as {
      runIntakeCycle(): Promise<void>;
      stop(): void;
    };
    const localApp = createLocalAgentApp(agentRuntime, config);

    try {
      await agentRuntime.start();
      const agent = [...platformRuntime.state.agents.values()][0];
      expect(agent?.agentId).toBeTruthy();

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const fileId = await createReadyAttachment(platformRuntime.app, owner, "overlay");

      const delivery = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/task-deliveries",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_overlay_delivery",
          project_id: "proj_demo",
          workflow_id: "wf_demo",
          workflow_template_id: "wf_tmpl_demo_v1",
          template_version: 1,
          step_id: "step_excel_revise",
          task_title: "Overlay task demo",
          task_type: "excel_handoff",
          sender_user_id: "user_owner",
          target_user_id: "user_member",
          target_agent_id: agent?.agentId,
          priority: "high",
          deadline: "2026-03-10T18:00:00+08:00",
          summary: "Overlay should show this task",
          constraints: [],
          deliverables: ["Overlay deliverable"],
          attachment_file_ids: [fileId],
          plan_mode: "structured",
        },
      });
      expect(delivery.statusCode).toBe(200);
      const { task_id: taskId } = delivery.json() as { task_id: string };

      await agentInternals.runIntakeCycle();

      const bootstrap = await localApp.inject({
        method: "GET",
        url: "/api/overlay/bootstrap",
      });
      expect(bootstrap.statusCode).toBe(200);
      const bootstrapBody = bootstrap.json() as {
        owner_user_id: string;
        openclaw_connected: boolean;
        current_task_count: number;
      };
      expect(bootstrapBody).toMatchObject({
        owner_user_id: "user_member",
        openclaw_connected: true,
      });

      const tasks = await localApp.inject({
        method: "GET",
        url: "/api/overlay/tasks/current",
      });
      expect(tasks.statusCode).toBe(200);
      const taskBody = tasks.json() as {
        tasks: Array<Record<string, unknown>>;
      };
      expect(taskBody.tasks.some((task) =>
        task.task_id === taskId &&
        task.project_name === "流程协作示例项目1" &&
        task.task_title === "Overlay task demo")).toBe(true);
      expect(bootstrapBody.current_task_count).toBe(taskBody.tasks.length);

      const sendConversation = await localApp.inject({
        method: "POST",
        url: "/api/overlay/conversations/messages",
        payload: {
          body: "这是来自悬浮球的测试消息",
        },
      });
      expect(sendConversation.statusCode).toBe(202);

      const platformPending = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_member" && message.messageType === "user_message" && message.syncStatus === "pending");
      expect(platformPending?.body).toBe("这是来自悬浮球的测试消息");

      const conversations = await localApp.inject({
        method: "GET",
        url: "/api/overlay/conversations",
      });
      expect(conversations.statusCode).toBe(200);
      const conversationsBody = conversations.json() as {
        messages: Array<{ body: string; author_kind: string }>;
        message_views: Array<{ body: string; author_label: string; align: string }>;
      };
      expect(conversationsBody.messages.some((message) => message.body === "这是来自悬浮球的测试消息" && message.author_kind === "user")).toBe(true);
      expect(conversationsBody.message_views.some((message) => message.body === "这是来自悬浮球的测试消息" && message.author_label === "执行成员" && message.align === "right")).toBe(true);

      db.connection.prepare(`
        insert into local_settings (key, value) values (?, ?)
        on conflict(key) do update set value = excluded.value
      `).run("platform_web_origin", "http://127.0.0.1:59999");

      const openLocal = await localApp.inject({
        method: "POST",
        url: `/api/overlay/tasks/${taskId}/open`,
      });
      expect(openLocal.statusCode).toBe(202);
      expect(openLocal.json()).toMatchObject({
        task_id: taskId,
        opened_target: "local",
        platform_reachable: false,
      });
    } finally {
      await localApp.close();
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("shows account-scoped overlay tasks even when they are assigned to another agent", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const mockOpenClaw = createMockOpenClawRuntime(flowRoot);
    const config: LocalAgentConfig = {
      platformApiBaseUrl: address,
      platformWebOrigin: "http://127.0.0.1:3000",
      bootstrapToken: "flow-bootstrap-local",
      agentId: undefined,
      agentToken: undefined,
      agentName: "B-PC",
      ownerUserId: "user_member",
      runtimeVersion: "0.1.0",
      appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
      uiHost: "127.0.0.1",
      uiPort: 38500,
      pollIntervalSeconds: 60,
      updateCheckIntervalSeconds: 60,
      flowRoot,
      conversationsRoot: path.join(flowRoot, "conversations"),
      tasksRoot: path.join(flowRoot, "tasks"),
      tmpRoot: path.join(flowRoot, "tmp"),
      updatesRoot: path.join(flowRoot, "updates"),
      recoveryRoot: path.join(flowRoot, "recovery"),
      overlayDataRoot: path.join(flowRoot, "overlay-data"),
      dataRoot: path.join(flowRoot, "agent-data"),
      logsRoot: path.join(flowRoot, "agent-data", "logs"),
      backupsRoot: path.join(flowRoot, "agent-data", "backups"),
      databasePath: path.join(flowRoot, "agent-data", "agent.sqlite"),
      logFilePath: path.join(flowRoot, "agent-data", "logs", "agent.log"),
      openClawConnectionPath: path.join(flowRoot, "agent-data", "openclaw-connection.json"),
      openClawBin: mockOpenClaw.binPath,
      openClawTimeoutSeconds: 120,
      heartbeatIntervalSeconds: 60,
      maxTaskBytes: 50 * 1024 * 1024,
      maxOutboxSoftLimit: 20,
      maxOutboxHardLimit: 100,
      backupRetentionDays: 3,
      localMode: false,
    };
    process.env.USERPROFILE = mockOpenClaw.userProfileRoot;
    process.env.OPENCLAW_HOME = path.join(mockOpenClaw.userProfileRoot, ".openclaw");
    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const localApp = createLocalAgentApp(agentRuntime, config);

    try {
      await agentRuntime.start();

      const secondAgent = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/agents/register",
        headers: {
          "x-bootstrap-token": "flow-bootstrap-local",
        },
        payload: {
          request_id: "req_overlay_second_member_agent",
          agent_name: "B-PC-2",
          machine_name: "B-PC-2",
          owner_user_id: "user_member",
          ip_address: "127.0.0.2",
          runtime_version: "0.1.0",
          local_ui_port: 38501,
          os_type: "windows",
          capabilities: ["task.run", "openclaw.chat"],
        },
      });
      expect(secondAgent.statusCode).toBe(200);
      const secondAgentId = (secondAgent.json() as { agent_id: string }).agent_id;

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const fileId = await createReadyAttachment(platformRuntime.app, owner, "overlay-account-scope");

      const delivery = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/task-deliveries",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_overlay_account_scoped_delivery",
          project_id: "proj_demo",
          workflow_id: "wf_demo",
          workflow_template_id: "wf_tmpl_demo_v1",
          template_version: 1,
          step_id: "step_excel_revise",
          task_title: "Overlay account task",
          task_type: "excel_handoff",
          sender_user_id: "user_owner",
          target_user_id: "user_member",
          target_agent_id: secondAgentId,
          priority: "high",
          deadline: "2026-03-10T18:00:00+08:00",
          summary: "Overlay should follow account scope",
          constraints: [],
          deliverables: ["Overlay deliverable"],
          attachment_file_ids: [fileId],
          plan_mode: "structured",
        },
      });
      expect(delivery.statusCode).toBe(200);
      const { task_id: taskId } = delivery.json() as { task_id: string };

      const bootstrap = await localApp.inject({
        method: "GET",
        url: "/api/overlay/bootstrap",
      });
      expect(bootstrap.statusCode).toBe(200);
      const bootstrapBody = bootstrap.json() as {
        owner_user_id: string;
        openclaw_connected: boolean;
        current_task_count: number;
      };
      expect(bootstrapBody).toMatchObject({
        owner_user_id: "user_member",
        openclaw_connected: true,
      });

      const tasks = await localApp.inject({
        method: "GET",
        url: "/api/overlay/tasks/current",
      });
      expect(tasks.statusCode).toBe(200);
      const taskBody = tasks.json() as {
        tasks: Array<Record<string, unknown>>;
      };
      expect(taskBody.tasks.some((task) =>
        task.task_id === taskId &&
        task.task_title === "Overlay account task" &&
        task.local_task_path === "")).toBe(true);
      expect(bootstrapBody.current_task_count).toBe(taskBody.tasks.length);
    } finally {
      await localApp.close();
      agentRuntime.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("syncs conversation messages into local storage and acknowledges delivery", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config: LocalAgentConfig = {
      platformApiBaseUrl: address,
      platformWebOrigin: "http://127.0.0.1:3000",
      bootstrapToken: "flow-bootstrap-local",
      agentId: undefined,
      agentToken: undefined,
      agentName: "B-PC",
      ownerUserId: "user_member",
      runtimeVersion: "0.1.0",
      appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
      uiHost: "127.0.0.1",
      uiPort: 38500,
      pollIntervalSeconds: 60,
      updateCheckIntervalSeconds: 60,
      flowRoot,
      conversationsRoot: path.join(flowRoot, "conversations"),
      tasksRoot: path.join(flowRoot, "tasks"),
      tmpRoot: path.join(flowRoot, "tmp"),
      updatesRoot: path.join(flowRoot, "updates"),
      recoveryRoot: path.join(flowRoot, "recovery"),
      overlayDataRoot: path.join(flowRoot, "overlay-data"),
      dataRoot: path.join(flowRoot, "agent-data"),
      logsRoot: path.join(flowRoot, "agent-data", "logs"),
      backupsRoot: path.join(flowRoot, "agent-data", "backups"),
      databasePath: path.join(flowRoot, "agent-data", "agent.sqlite"),
      logFilePath: path.join(flowRoot, "agent-data", "logs", "agent.log"),
      openClawConnectionPath: path.join(flowRoot, "agent-data", "openclaw-connection.json"),
      openClawBin: mockOpenClaw.binPath,
      openClawTimeoutSeconds: 90,
      openClawAutoReplyEnabled: false,
      nodeExecutablePath: process.execPath,
      npmCliPath: undefined,
      restartCommand: "true",
      maxOutboxWarning: 1000,
      maxOutboxHardLimit: 5000,
      recoveryRetentionDays: 7,
    };

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const agentInternals = agentRuntime as unknown as {
      runConversationSync(): Promise<void>;
      flushOutbox(): Promise<void>;
      stop(): void;
    };

    try {
      await agentRuntime.start();
      const agent = [...platformRuntime.state.agents.values()][0];
      expect(agent?.agentId).toBeTruthy();

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_agent_conversation_delivery",
          target_agent_id: agent?.agentId,
          body: "请先接收这条测试会话。",
        },
      });
      expect(send.statusCode).toBe(200);

      await agentInternals.runConversationSync();
      await agentInternals.flushOutbox();

      const storedMessage = db.connection.prepare(`
        select * from local_conversation_messages
        where message_type = 'incoming_delivery'
        limit 1
      `).get() as { message_id: string; conversation_id: string } | undefined;
      expect(storedMessage).toBeTruthy();

      const messageFile = path.join(config.conversationsRoot, storedMessage!.conversation_id, `${storedMessage!.message_id}.json`);
      expect(fs.existsSync(messageFile)).toBe(true);

      const syncedRemoteMessage = [...platformRuntime.state.conversationMessages.values()].find((message) => message.messageId === storedMessage?.message_id);
      expect(syncedRemoteMessage?.syncStatus).toBe("synced");
    } finally {
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("reconciles the local conversation thread to match the platform thread", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config = createAgentConfig(address, flowRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38500,
      openClawAutoReplyEnabled: false,
    });

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const agentInternals = agentRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
    };

    try {
      await agentRuntime.start();
      const agent = [...platformRuntime.state.agents.values()].find((entry) => entry.ownerUserId === "user_member");
      expect(agent?.agentId).toBeTruthy();

      const staleConversationDir = path.join(config.conversationsRoot, "conv_user_member");
      fs.mkdirSync(staleConversationDir, { recursive: true });
      db.connection.prepare(`
        insert into local_conversations (conversation_id, owner_user_id, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(conversation_id) do update set
          owner_user_id = excluded.owner_user_id,
          updated_at = excluded.updated_at
      `).run("conv_user_member", "user_member", "2026-03-11T09:00:00.000Z", "2026-03-11T09:00:00.000Z");
      db.connection.prepare(`
        insert into local_conversation_messages (
          message_id, conversation_id, message_type, author_kind, body,
          source_user_id, source_display_name, target_user_id, target_agent_id,
          sync_status, sync_detail, delivered_to_agent_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "msg_stale_local_only",
        "conv_user_member",
        "openclaw_reply",
        "openclaw",
        "????::????",
        null,
        null,
        null,
        null,
        "none",
        null,
        null,
        "2026-03-11T09:00:00.000Z",
        "2026-03-11T09:00:00.000Z",
      );
      fs.writeFileSync(path.join(staleConversationDir, "msg_stale_local_only.json"), JSON.stringify({ stale: true }), "utf8");

      const member = await login(platformRuntime.app, "member", "member123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: member.cookieHeader,
          "x-csrf-token": member.csrfToken,
        },
        payload: {
          request_id: "req_reconcile_thread_self_message",
          body: "你好，我是最新的会话消息",
        },
      });
      expect(send.statusCode).toBe(200);

      await agentInternals.runConversationSync();

      const localMessages = db.connection.prepare(`
        select message_id, body
        from local_conversation_messages
        where conversation_id = ?
        order by created_at asc
      `).all("conv_user_member") as Array<{ message_id: string; body: string }>;

      expect(localMessages.map((row) => row.body)).toContain("你好，我是最新的会话消息");
      expect(localMessages.map((row) => row.message_id)).not.toContain("msg_stale_local_only");
      expect(fs.existsSync(path.join(staleConversationDir, "msg_stale_local_only.json"))).toBe(false);
    } finally {
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("serves overlay conversations from the platform thread and only falls back locally on failure", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config = createAgentConfig(address, flowRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38500,
      openClawAutoReplyEnabled: false,
    });

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const localApp = createLocalAgentApp(agentRuntime, config);
    const agentInternals = agentRuntime as unknown as {
      stop(): void;
    };

    try {
      await agentRuntime.start();

      const staleConversationDir = path.join(config.conversationsRoot, "conv_user_member");
      fs.mkdirSync(staleConversationDir, { recursive: true });
      db.connection.prepare(`
        insert into local_conversations (conversation_id, owner_user_id, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(conversation_id) do update set
          owner_user_id = excluded.owner_user_id,
          updated_at = excluded.updated_at
      `).run("conv_user_member", "user_member", "2026-03-11T09:00:00.000Z", "2026-03-11T09:00:00.000Z");
      db.connection.prepare(`
        insert into local_conversation_messages (
          message_id, conversation_id, message_type, author_kind, body,
          source_user_id, source_display_name, target_user_id, target_agent_id,
          sync_status, sync_detail, delivered_to_agent_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "msg_local_overlay_only",
        "conv_user_member",
        "openclaw_reply",
        "openclaw",
        "local-only-stale-message",
        null,
        null,
        null,
        null,
        "none",
        null,
        null,
        "2026-03-11T09:00:00.000Z",
        "2026-03-11T09:00:00.000Z",
      );
      fs.writeFileSync(path.join(staleConversationDir, "msg_local_overlay_only.json"), JSON.stringify({ stale: true }), "utf8");

      const member = await login(platformRuntime.app, "member", "member123");
      const canonicalBody = "overlay-platform-thread-canonical";
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: member.cookieHeader,
          "x-csrf-token": member.csrfToken,
        },
        payload: {
          request_id: "req_overlay_thread_platform_truth",
          body: canonicalBody,
        },
      });
      expect(send.statusCode).toBe(200);

      const overlayResponse = await localApp.inject({
        method: "GET",
        url: "/api/overlay/conversations",
      });
      expect(overlayResponse.statusCode).toBe(200);

      const overlayBody = overlayResponse.json() as {
        messages: Array<{ body: string }>;
        message_views: Array<{ body: string; time_label: string }>;
      };
      expect(overlayBody.messages.map((message) => message.body)).toContain(canonicalBody);
      expect(overlayBody.messages.map((message) => message.body)).not.toContain("local-only-stale-message");
      expect(overlayBody.message_views.map((message) => message.body)).toContain(canonicalBody);
      expect(overlayBody.message_views.every((message) => typeof message.time_label === "string")).toBe(true);

      const platformThread = await platformRuntime.app.inject({
        method: "GET",
        url: "/api/v1/conversations/thread",
        headers: {
          cookie: member.cookieHeader,
          "x-csrf-token": member.csrfToken,
        },
      });
      expect(platformThread.statusCode).toBe(200);
      expect(overlayResponse.json()).toMatchObject({
        messages: (platformThread.json() as { messages: Array<Record<string, unknown>> }).messages,
      });
    } finally {
      await localApp.close();
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("routes OpenClaw structured forward actions into another member's OpenClaw and creates a task brief", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner");
    const memberRoot = path.join(flowRoot, "member");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38500,
      openClawAutoReplyEnabled: true,
    });
    const memberConfig = createAgentConfig(address, memberRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38501,
      openClawAutoReplyEnabled: false,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const memberDb = new AgentDatabase(memberConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const memberLogger = new AgentLogger(memberConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const memberRuntime = new LocalAgentRuntime(memberConfig, memberDb, memberLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };
    const memberInternals = memberRuntime as unknown as {
      runConversationSync(): Promise<void>;
      flushOutbox(): Promise<void>;
      stop(): void;
    };

    try {
      await ownerRuntime.start();
      await memberRuntime.start();

      const ownerAgent = [...platformRuntime.state.agents.values()].find((agent) => agent.ownerUserId === "user_owner");
      const memberAgent = [...platformRuntime.state.agents.values()].find((agent) => agent.ownerUserId === "user_member");
      expect(ownerAgent?.agentId).toBeTruthy();
      expect(memberAgent?.agentId).toBeTruthy();

      ownerInternals.invokeOpenClawReply = async () => `\`\`\`flow-system-action
{"action":"forward_message","target_name":"member","forward_body":"请今天 18:00 前确认鞋面表","task_brief_title":"确认鞋面表","task_brief_summary":"请今天 18:00 前确认鞋面表"}
\`\`\``;

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_router_skill_forward",
          body: "转发给执行成员：请今天 18:00 前确认鞋面表",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toContain("已转发给");
      expect(ownerReply?.body).toContain("确认鞋面表");

      const forwardedMessage = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_member" && message.messageType === "incoming_delivery" && message.body === "请今天 18:00 前确认鞋面表");
      expect(forwardedMessage).toBeTruthy();
      expect(forwardedMessage?.targetAgentId).toBe(memberAgent?.agentId);

      const taskBrief = [...platformRuntime.state.tasks.values()].find((task) =>
        task.projectId === "proj_openclaw_conversation_router" && task.assigneeAgentId === memberAgent?.agentId);
      expect(taskBrief).toBeTruthy();
      expect(taskBrief).toMatchObject({
        taskTitle: "确认鞋面表",
        status: "delivered",
      });

      await memberInternals.runConversationSync();
      await memberInternals.flushOutbox();

      const localIncoming = memberDb.connection.prepare(`
        select *
        from local_conversation_messages
        where message_type = 'incoming_delivery' and body = ?
        limit 1
      `).get("请今天 18:00 前确认鞋面表") as { message_id: string } | undefined;
      expect(localIncoming).toBeTruthy();

      const syncedRemoteMessage = platformRuntime.state.conversationMessages.get(forwardedMessage!.messageId);
      expect(syncedRemoteMessage?.syncStatus).toBe("synced");
    } finally {
      ownerInternals.stop();
      memberInternals.stop();
      ownerDb.connection.close();
      memberDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("routes natural-language forwarding requests into another member's OpenClaw", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner-natural-forward");
    const memberRoot = path.join(flowRoot, "member-natural-forward");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38502,
      openClawAutoReplyEnabled: true,
    });
    const memberConfig = createAgentConfig(address, memberRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38503,
      openClawAutoReplyEnabled: false,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const memberDb = new AgentDatabase(memberConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const memberLogger = new AgentLogger(memberConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const memberRuntime = new LocalAgentRuntime(memberConfig, memberDb, memberLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };
    const memberInternals = memberRuntime as unknown as {
      stop(): void;
    };

    try {
      await ownerRuntime.start();
      await memberRuntime.start();

      const memberAgent = [...platformRuntime.state.agents.values()].find((agent) => agent.ownerUserId === "user_member");
      expect(memberAgent?.agentId).toBeTruthy();

      ownerInternals.invokeOpenClawReply = async () => `\`\`\`flow-system-action
{"action":"forward_message","target_name":"member","forward_body":"请转告 member：来找我。","task_brief_title":"转告 member 来找我","task_brief_summary":"用户希望通过 member 的 OpenClaw 转告 member：来找我。"}
\`\`\``;

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_router_natural_forward",
          body: "让member来我这",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toContain("已转发给");
      expect(ownerReply?.body).toContain("转告 member 来找我");

      const forwardedMessage = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_member" && message.messageType === "incoming_delivery" && message.body === "请转告 member：来找我。");
      expect(forwardedMessage).toBeTruthy();
      expect(forwardedMessage?.targetAgentId).toBe(memberAgent?.agentId);

      const taskBrief = [...platformRuntime.state.tasks.values()].find((task) =>
        task.projectId === "proj_openclaw_conversation_router" && task.assigneeAgentId === memberAgent?.agentId && task.taskTitle === "转告 member 来找我");
      expect(taskBrief).toBeTruthy();
    } finally {
      ownerInternals.stop();
      memberInternals.stop();
      ownerDb.connection.close();
      memberDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("asks for the target directly when a forwarding request omits the recipient", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner-missing-target");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38504,
      openClawAutoReplyEnabled: true,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };

    let invokeCount = 0;

    try {
      await ownerRuntime.start();
      ownerInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return `\`\`\`flow-system-action
{"action":"reply_only","reply_text":"unexpected"}
\`\`\``;
      };

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_router_missing_target",
          body: "让他来我这",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toBe("你想让我转给谁？");
      expect(invokeCount).toBe(0);
    } finally {
      ownerInternals.stop();
      ownerDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("answers known member identity questions locally without using the forwarding router", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner-identity-question");
    const memberRoot = path.join(flowRoot, "member-identity-question");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38508,
      openClawAutoReplyEnabled: true,
    });
    const memberConfig = createAgentConfig(address, memberRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38509,
      openClawAutoReplyEnabled: false,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const memberDb = new AgentDatabase(memberConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const memberLogger = new AgentLogger(memberConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const memberRuntime = new LocalAgentRuntime(memberConfig, memberDb, memberLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };
    const memberInternals = memberRuntime as unknown as {
      stop(): void;
    };

    let invokeCount = 0;

    try {
      await ownerRuntime.start();
      await memberRuntime.start();

      ownerInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return "unexpected";
      };

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_member_identity",
          body: "你知道member是谁吗",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toContain("member");
      expect(ownerReply?.body).toContain("可联系成员");
      expect(ownerReply?.body).toContain("如果你想让我联系他");
      expect(invokeCount).toBe(0);
    } finally {
      ownerInternals.stop();
      memberInternals.stop();
      ownerDb.connection.close();
      memberDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("repairs protocol-collection replies for natural forwarding requests", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner-repair-forward");
    const memberRoot = path.join(flowRoot, "member-repair-forward");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38505,
      openClawAutoReplyEnabled: true,
    });
    const memberConfig = createAgentConfig(address, memberRoot, mockOpenClaw.binPath, {
      agentName: "MEMBER-PC",
      ownerUserId: "user_member",
      uiPort: 38506,
      openClawAutoReplyEnabled: false,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const memberDb = new AgentDatabase(memberConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const memberLogger = new AgentLogger(memberConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const memberRuntime = new LocalAgentRuntime(memberConfig, memberDb, memberLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };
    const memberInternals = memberRuntime as unknown as {
      stop(): void;
    };

    let invokeCount = 0;

    try {
      await ownerRuntime.start();
      await memberRuntime.start();

      ownerInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return "收到。请把‘会话转发协议’正文和要处理的‘用户消息原文’发我，我会严格按协议执行并返回可直接转发的结果。";
        }
        return `\`\`\`flow-system-action
{"action":"forward_message","target_name":"member","forward_body":"请转告 member：来找我。","task_brief_title":"转告 member 来找我","task_brief_summary":"用户希望通过 member 的 OpenClaw 转告 member：来找我。"}
\`\`\``;
      };

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_router_repair_forward",
          body: "让member来我这",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toContain("已转发给");
      expect(ownerReply?.body).not.toContain("协议");
      expect(invokeCount).toBe(2);

      const forwardedMessage = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_member" && message.messageType === "incoming_delivery" && message.body === "请转告 member：来找我。");
      expect(forwardedMessage).toBeTruthy();
    } finally {
      ownerInternals.stop();
      memberInternals.stop();
      ownerDb.connection.close();
      memberDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("keeps ordinary conversation requests as direct OpenClaw replies", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const ownerRoot = path.join(flowRoot, "owner-reply-only");
    const ownerConfig = createAgentConfig(address, ownerRoot, mockOpenClaw.binPath, {
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      uiPort: 38507,
      openClawAutoReplyEnabled: true,
    });

    const ownerDb = new AgentDatabase(ownerConfig);
    const ownerLogger = new AgentLogger(ownerConfig.logFilePath);
    const ownerRuntime = new LocalAgentRuntime(ownerConfig, ownerDb, ownerLogger);
    const ownerInternals = ownerRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
    };

    let invokeCount = 0;

    try {
      await ownerRuntime.start();
      ownerInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return "可以，你把要总结的内容发我。";
      };

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_conversation_router_reply_only",
          body: "帮我总结一下这句话",
        },
      });
      expect(send.statusCode).toBe(200);

      await ownerInternals.runConversationSync();

      const ownerReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_owner" && message.messageType === "openclaw_reply");
      expect(ownerReply?.body).toBe("可以，你把要总结的内容发我。");
      expect(invokeCount).toBe(1);
    } finally {
      ownerInternals.stop();
      ownerDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("routes flow system task requests through the operator execution chain", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const adminRoot = path.join(flowRoot, "admin-flow-system-operator");
    const adminConfig = createAgentConfig(address, adminRoot, mockOpenClaw.binPath, {
      agentName: "ADMIN-PC",
      ownerUserId: "user_admin",
      uiPort: 38510,
      openClawAutoReplyEnabled: true,
    });

    const adminDb = new AgentDatabase(adminConfig);
    const adminLogger = new AgentLogger(adminConfig.logFilePath);
    const adminRuntime = new LocalAgentRuntime(adminConfig, adminDb, adminLogger);
    const adminInternals = adminRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
      loadFlowSystemOperatorCredentials(): { username: string; password: string } | null;
      runFlowSystemOperatorScript(action: Record<string, unknown>, credentials: { username: string; password: string }): Promise<Record<string, unknown>>;
    };

    let invokeCount = 0;
    let operatorCount = 0;

    try {
      await adminRuntime.start();

      adminInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return `\`\`\`flow-system-operator-action
{"action":"create_task","original_request":"帮我新建一个任务，项目是新项目，让泽阳做一份 SS26 裙子趋势报告，并在 2026-03-18T15:00:00+08:00 前给我","project_name":"新项目","assignee_name":"泽阳","task_title":"SS26 裙子趋势报告","task_summary":"让泽阳做一份 SS26 裙子趋势报告，并在今天下午 3 点前给我","task_deadline":"2026-03-18T15:00:00+08:00","task_deliverables":["SS26 裙子趋势报告"]}
\`\`\``;
      };
      adminInternals.loadFlowSystemOperatorCredentials = () => ({
        username: "admin",
        password: "admin123",
      });
      adminInternals.runFlowSystemOperatorScript = async (action, credentials) => {
        operatorCount += 1;
        expect(action.action).toBe("create_task");
        expect(credentials.username).toBe("admin");
        expect(credentials.password).toBe("admin123");
        return {
          ok: true,
          action: "create_task",
          executed: true,
          message: "已创建任务 SS26 裙子趋势报告。",
          requires_confirmation: false,
          requires_clarification: false,
          confirmation_text: null,
          candidates: [],
          data: {
            task_id: "task_flow_123",
            task_title: "SS26 裙子趋势报告",
            project_name: "新项目",
            assignee_display_name: "泽阳",
            deadline: "2026-03-18T15:00:00+08:00",
          },
          links: {
            task: "http://127.0.0.1:3000/tasks/task_flow_123",
            project: "http://127.0.0.1:3000/projects/proj_flow_123",
          },
        };
      };

      const admin = await login(platformRuntime.app, "admin", "admin123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: admin.cookieHeader,
          "x-csrf-token": admin.csrfToken,
        },
        payload: {
          request_id: "req_conversation_flow_system_operator",
          body: "帮我新建一个任务，项目是新项目，让泽阳做一份 SS26 裙子趋势报告，并在今天下午 3 点前给我",
        },
      });
      expect(send.statusCode).toBe(200);

      await adminInternals.runConversationSync();

      const adminReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_admin" && message.messageType === "openclaw_reply");
      expect(adminReply?.body).toContain("已创建任务 SS26 裙子趋势报告");
      expect(adminReply?.body).toContain("task_flow_123");
      expect(adminReply?.body).toContain("新项目");
      expect(invokeCount).toBe(1);
      expect(operatorCount).toBe(1);
    } finally {
      adminInternals.stop();
      adminDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("falls back to heuristic flow system task parsing when OpenClaw skips the structured action block", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const adminRoot = path.join(flowRoot, "admin-flow-system-operator-heuristic");
    const adminConfig = createAgentConfig(address, adminRoot, mockOpenClaw.binPath, {
      agentName: "ADMIN-PC",
      ownerUserId: "user_admin",
      uiPort: 38511,
      openClawAutoReplyEnabled: true,
    });

    const adminDb = new AgentDatabase(adminConfig);
    const adminLogger = new AgentLogger(adminConfig.logFilePath);
    const adminRuntime = new LocalAgentRuntime(adminConfig, adminDb, adminLogger);
    const adminInternals = adminRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
      loadFlowSystemOperatorCredentials(): { username: string; password: string } | null;
      runFlowSystemOperatorScript(action: Record<string, unknown>, credentials: { username: string; password: string }): Promise<Record<string, unknown>>;
    };

    let invokeCount = 0;
    let operatorCount = 0;

    try {
      await adminRuntime.start();

      adminInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return "我来帮你处理这个 Flow System 任务。";
      };
      adminInternals.loadFlowSystemOperatorCredentials = () => ({
        username: "admin",
        password: "admin123",
      });
      adminInternals.runFlowSystemOperatorScript = async (action, credentials) => {
        operatorCount += 1;
        expect(action.action).toBe("create_task");
        expect(action.project_name).toBe("新项目");
        expect(action.assignee_name).toBe("泽阳");
        expect(action.task_title).toBe("SS26 裙子趋势报告");
        expect(action.task_deadline).toBe("2026-03-18T15:00:00+08:00");
        expect(credentials.username).toBe("admin");
        expect(credentials.password).toBe("admin123");
        return {
          ok: true,
          action: "create_task",
          executed: false,
          message: "泽阳当前还没有可用的本机 Agent，暂时不能把任务指派给他。",
          requires_confirmation: false,
          requires_clarification: true,
          confirmation_text: null,
          candidates: ["景然 (user_admin)", "普通成员 (user_member01)"],
          data: {},
          links: {},
        };
      };

      const admin = await login(platformRuntime.app, "admin", "admin123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: admin.cookieHeader,
          "x-csrf-token": admin.csrfToken,
        },
        payload: {
          request_id: "req_conversation_flow_system_operator_heuristic",
          body: "帮我新建一个任务，项目是【新项目】让泽阳做一份 SS26 裙子趋势报告，并在 2026-03-18T15:00:00+08:00 前给我",
        },
      });
      expect(send.statusCode).toBe(200);

      await adminInternals.runConversationSync();

      const adminReply = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.ownerUserId === "user_admin" && message.messageType === "openclaw_reply");
      expect(adminReply?.body).toContain("泽阳当前还没有可用的本机 Agent");
      expect(adminReply?.body).toContain("景然 (user_admin)");
      expect(invokeCount).toBe(1);
      expect(operatorCount).toBe(1);
    } finally {
      adminInternals.stop();
      adminDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("continues flow system clarification follow-ups across messages", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const adminRoot = path.join(flowRoot, "admin-flow-system-operator-followup");
    const adminConfig = createAgentConfig(address, adminRoot, mockOpenClaw.binPath, {
      agentName: "ADMIN-PC",
      ownerUserId: "user_admin",
      uiPort: 38512,
      openClawAutoReplyEnabled: true,
    });

    const adminDb = new AgentDatabase(adminConfig);
    const adminLogger = new AgentLogger(adminConfig.logFilePath);
    const adminRuntime = new LocalAgentRuntime(adminConfig, adminDb, adminLogger);
    const adminInternals = adminRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }, targets?: unknown[], promptOverride?: string): Promise<string>;
      loadFlowSystemOperatorCredentials(): { username: string; password: string } | null;
      runFlowSystemOperatorScript(action: Record<string, unknown>, credentials: { username: string; password: string }): Promise<Record<string, unknown>>;
    };

    let invokeCount = 0;
    let operatorCount = 0;

    try {
      await adminRuntime.start();

      adminInternals.invokeOpenClawReply = async () => {
        invokeCount += 1;
        return `\`\`\`flow-system-operator-action
{"action":"create_task","original_request":"在新项目里新建一个任务 下午3点前做一个人员分配表格 执行人我自己","project_name":"新项目","assignee_name":"景然","task_title":"人员分配表格","task_summary":"下午3点前做一个人员分配表格","task_deadline":"2026-03-18T15:00:00+08:00","task_deliverables":["人员分配表格"]}
\`\`\``;
      };
      adminInternals.loadFlowSystemOperatorCredentials = () => ({
        username: "admin",
        password: "admin123",
      });
      adminInternals.runFlowSystemOperatorScript = async (action) => {
        operatorCount += 1;
        if (operatorCount === 1) {
          expect(action.task_title).toBe("人员分配表格");
          expect(action.project_name).toBe("新项目");
          return {
            ok: true,
            action: "create_task",
            executed: false,
            message: "项目名称不够明确，请再说得更具体一些。",
            requires_confirmation: false,
            requires_clarification: true,
            confirmation_text: null,
            candidates: ["新项目 (proj_01)", "流程协作示例项目1 (proj_demo)"],
            data: {},
            links: {},
          };
        }

        expect(action.project_name).toBe("流程协作示例项目1");
        expect(action.assignee_name).toBe("景然");
        expect(action.task_title).toBe("人员分配表格");
        return {
          ok: true,
          action: "create_task",
          executed: true,
          message: "已创建任务 人员分配表格。",
          requires_confirmation: false,
          requires_clarification: false,
          confirmation_text: null,
          candidates: [],
          data: {
            task_id: "task_flow_followup_123",
            task_title: "人员分配表格",
            project_name: "流程协作示例项目1",
            assignee_display_name: "景然",
            deadline: "2026-03-18T15:00:00+08:00",
          },
          links: {
            task: "http://127.0.0.1:3000/tasks/task_flow_followup_123",
          },
        };
      };

      const admin = await login(platformRuntime.app, "admin", "admin123");
      const firstSend = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: admin.cookieHeader,
          "x-csrf-token": admin.csrfToken,
        },
        payload: {
          request_id: "req_conversation_flow_system_operator_followup_1",
          body: "在新项目里新建一个任务 下午3点前做一个人员分配表格 执行人我自己",
        },
      });
      expect(firstSend.statusCode).toBe(200);
      await adminInternals.runConversationSync();

      const secondSend = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: admin.cookieHeader,
          "x-csrf-token": admin.csrfToken,
        },
        payload: {
          request_id: "req_conversation_flow_system_operator_followup_2",
          body: "流程协作示例项目1",
        },
      });
      expect(secondSend.statusCode).toBe(200);
      await adminInternals.runConversationSync();

      const replies = [...platformRuntime.state.conversationMessages.values()]
        .filter((message) => message.ownerUserId === "user_admin" && message.messageType === "openclaw_reply")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const latestReply = replies.at(-1);
      expect(latestReply?.body).toContain("已创建任务 人员分配表格");
      expect(latestReply?.body).toContain("流程协作示例项目1");
      expect(invokeCount).toBe(1);
      expect(operatorCount).toBe(2);
    } finally {
      adminInternals.stop();
      adminDb.connection.close();
      await platformRuntime.app.close();
    }
  });

  it("surfaces self-conversation failures and marks successful replies as returned", async () => {
    const platformRuntime = createPlatformApiRuntime();
    const address = await platformRuntime.app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const config: LocalAgentConfig = {
      platformApiBaseUrl: address,
      platformWebOrigin: "http://127.0.0.1:3000",
      bootstrapToken: "flow-bootstrap-local",
      agentId: undefined,
      agentToken: undefined,
      agentName: "OWNER-PC",
      ownerUserId: "user_owner",
      runtimeVersion: "0.1.0",
      appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
      uiHost: "127.0.0.1",
      uiPort: 38500,
      pollIntervalSeconds: 60,
      updateCheckIntervalSeconds: 60,
      flowRoot,
      conversationsRoot: path.join(flowRoot, "conversations"),
      tasksRoot: path.join(flowRoot, "tasks"),
      tmpRoot: path.join(flowRoot, "tmp"),
      updatesRoot: path.join(flowRoot, "updates"),
      recoveryRoot: path.join(flowRoot, "recovery"),
      overlayDataRoot: path.join(flowRoot, "overlay-data"),
      dataRoot: path.join(flowRoot, "agent-data"),
      logsRoot: path.join(flowRoot, "agent-data", "logs"),
      backupsRoot: path.join(flowRoot, "agent-data", "backups"),
      databasePath: path.join(flowRoot, "agent-data", "agent.sqlite"),
      logFilePath: path.join(flowRoot, "agent-data", "logs", "agent.log"),
      openClawBin: "openclaw",
      openClawTimeoutSeconds: 90,
      openClawAutoReplyEnabled: true,
      nodeExecutablePath: process.execPath,
      npmCliPath: undefined,
      restartCommand: "true",
      maxOutboxWarning: 1000,
      maxOutboxHardLimit: 5000,
      recoveryRetentionDays: 7,
    };

    const db = new AgentDatabase(config);
    const logger = new AgentLogger(config.logFilePath);
    const agentRuntime = new LocalAgentRuntime(config, db, logger);
    const agentInternals = agentRuntime as unknown as {
      runConversationSync(): Promise<void>;
      stop(): void;
      invokeOpenClawReply(message: { body: string }): Promise<string>;
    };

    try {
      await agentRuntime.start();
      const agent = [...platformRuntime.state.agents.values()].find((entry) => entry.ownerUserId === "user_owner");
      expect(agent?.agentId).toBeTruthy();

      const owner = await login(platformRuntime.app, "owner", "owner123");
      const send = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_self_conversation_delivery",
          target_agent_id: agent?.agentId,
          body: "请只回复：收到",
        },
      });
      expect(send.statusCode).toBe(200);
      const sentMessageId = (send.json() as { message: { message_id: string } }).message.message_id;

      agentInternals.invokeOpenClawReply = async () => {
        throw new Error("OpenClaw temporarily unavailable");
      };
      await agentInternals.runConversationSync();

      const failedAfterProcessing = platformRuntime.state.conversationMessages.get(sentMessageId);
      expect(failedAfterProcessing?.syncStatus).toBe("failed");
      expect(failedAfterProcessing?.syncDetail).toContain("OpenClaw temporarily unavailable");

      const successfulSend = await platformRuntime.app.inject({
        method: "POST",
        url: "/api/v1/conversations/messages",
        headers: {
          cookie: owner.cookieHeader,
          "x-csrf-token": owner.csrfToken,
        },
        payload: {
          request_id: "req_self_conversation_delivery_success",
          target_agent_id: agent?.agentId,
          body: "Please reply with success",
        },
      });
      expect(successfulSend.statusCode).toBe(200);
      const successfulMessageId = (successfulSend.json() as { message: { message_id: string } }).message.message_id;

      agentInternals.invokeOpenClawReply = async () => "收到";
      await agentInternals.runConversationSync();

      const repliedAfterSuccess = platformRuntime.state.conversationMessages.get(successfulMessageId);
      expect(repliedAfterSuccess?.syncStatus).toBe("replied");

      const replyMessage = [...platformRuntime.state.conversationMessages.values()].find((message) =>
        message.conversationId === `conv_${config.ownerUserId}` && message.messageType === "openclaw_reply");
      expect(replyMessage?.body).toBe("收到");
    } finally {
      agentInternals.stop();
      db.connection.close();
      await platformRuntime.app.close();
    }
  });
});
