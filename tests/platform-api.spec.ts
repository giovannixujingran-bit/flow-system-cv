import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlatformApiRuntime } from "../apps/platform-api/src/app.js";

type SessionContext = {
  cookieHeader: string;
  csrfToken: string;
};

type ManagedAccountSeed = {
  user_id: string;
  username: string;
  display_name: string;
  role: "admin" | "owner" | "member";
  password: string;
  status?: "active" | "disabled";
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractCookieHeader(setCookieHeader: string | string[] | undefined): string {
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

function writeManagedAccounts(root: string, accounts: ManagedAccountSeed[]): { usersFile: string; summaryFile: string } {
  const accountRoot = path.join(root, "account-management");
  const usersFile = path.join(accountRoot, "managed-users.json");
  const summaryFile = path.join(accountRoot, "accounts-summary.txt");

  fs.mkdirSync(accountRoot, { recursive: true });
  fs.writeFileSync(
    usersFile,
    `${JSON.stringify({
      version: 1,
      accounts,
    }, null, 2)}\n`,
    "utf8",
  );

  process.env.MANAGED_USERS_FILE = usersFile;
  process.env.MANAGED_USERS_SUMMARY_FILE = summaryFile;

  return { usersFile, summaryFile };
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

async function registerAgent(
  app: ReturnType<typeof createPlatformApiRuntime>["app"],
  options?: {
    requestId?: string;
    agentName?: string;
    machineName?: string;
    ownerUserId?: string;
    localUiPort?: number;
  },
): Promise<{ agentId: string; agentToken: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agents/register",
    headers: {
      "x-bootstrap-token": "flow-bootstrap-local",
    },
    payload: {
      request_id: options?.requestId ?? "req_register_agent_test",
      agent_name: options?.agentName ?? "B-PC",
      machine_name: options?.machineName ?? "B-PC",
      owner_user_id: options?.ownerUserId ?? "user_member",
      ip_address: "127.0.0.1",
      runtime_version: "0.1.0",
      local_ui_port: options?.localUiPort ?? 38500,
      os_type: "windows",
      capabilities: ["local_storage", "task_cards", "notifications", "action_runner"],
    },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json() as { agent_id: string; agent_token: string };
  return {
    agentId: body.agent_id,
    agentToken: body.agent_token,
  };
}

describe("platform api", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flow-system-api-"));
    process.env.STORAGE_ROOT = storageRoot;
    process.env.FLOW_SEED_MODE = "demo";
  });

  afterEach(() => {
    delete process.env.STORAGE_ROOT;
    delete process.env.FLOW_SEED_MODE;
    delete process.env.MANAGED_USERS_FILE;
    delete process.env.MANAGED_USERS_SUMMARY_FILE;
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it("uses managed accounts by default and disables self initialization", async () => {
    delete process.env.FLOW_SEED_MODE;
    const accountFiles = writeManagedAccounts(storageRoot, [
      {
        user_id: "user_admin",
        username: "admin",
        display_name: "管理员",
        role: "admin",
        password: "admin123",
        status: "active",
      },
    ]);

    const runtime = createPlatformApiRuntime();
    const { app } = runtime;

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/setup/status",
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      initialized: true,
      user_count: 1,
      self_initialize_allowed: false,
    });

    const initialize = await app.inject({
      method: "POST",
      url: "/api/v1/setup/initialize",
      payload: {
        username: "otheradmin",
        display_name: "其他管理员",
        password: "admin456",
      },
    });
    expect(initialize.statusCode).toBe(403);
    expect(initialize.json()).toMatchObject({
      error: "Self initialization is disabled",
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "admin",
        password: "admin123",
      },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(fs.existsSync(accountFiles.summaryFile)).toBe(true);

    await app.close();
  });

  it("starts empty by default and allows one-time admin initialization", async () => {
    process.env.FLOW_SEED_MODE = "empty";
    const runtime = createPlatformApiRuntime();
    const { app, state } = runtime;

    const statusBefore = await app.inject({
      method: "GET",
      url: "/api/v1/setup/status",
    });
    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.json()).toMatchObject({
      initialized: false,
      user_count: 0,
    });
    expect(state.projects.size).toBe(0);
    expect(state.tasks.size).toBe(0);

    const initialize = await app.inject({
      method: "POST",
      url: "/api/v1/setup/initialize",
      payload: {
        username: "admin",
        display_name: "管理员",
        password: "admin123",
      },
    });
    expect(initialize.statusCode).toBe(201);
    expect(initialize.json()).toMatchObject({
      accepted: true,
      user: {
        user_id: "user_admin",
        username: "admin",
        role: "admin",
      },
    });

    const statusAfter = await app.inject({
      method: "GET",
      url: "/api/v1/setup/status",
    });
    expect(statusAfter.json()).toMatchObject({
      initialized: true,
      user_count: 1,
    });

    const secondInitialize = await app.inject({
      method: "POST",
      url: "/api/v1/setup/initialize",
      payload: {
        username: "owner",
        display_name: "项目负责人",
        password: "owner123",
      },
    });
    expect(secondInitialize.statusCode).toBe(409);
    expect(secondInitialize.json()).toMatchObject({
      error: "Platform is already initialized",
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "admin",
        password: "admin123",
      },
    });
    expect(loginResponse.statusCode).toBe(200);

    await app.close();
  });

  it("rejects task deliveries that reference non-ready files", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const owner = await login(app, "owner", "owner123");
    const agent = await registerAgent(app);

    const uploadInit = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-init",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_upload_init_unready",
        purpose: "attachment",
        original_name: "report.xlsx",
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes: 5,
        sha256_declared: sha256("hello"),
      },
    });
    expect(uploadInit.statusCode).toBe(200);
    const { file_id: fileId } = uploadInit.json() as { file_id: string };

    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_task_delivery_unready",
        project_id: "proj_demo",
        workflow_id: "wf_demo",
        workflow_template_id: "wf_tmpl_demo_v1",
        template_version: 1,
        step_id: "step_excel_revise",
        task_title: "Spring sheet revise",
        task_type: "excel_handoff",
        sender_user_id: "user_owner",
        target_user_id: "user_member",
        target_agent_id: agent.agentId,
        priority: "high",
        deadline: "2026-03-10T18:00:00+08:00",
        summary: "Update sheet 2",
        constraints: [],
        deliverables: ["Update sheet 2"],
        attachment_file_ids: [fileId],
        plan_mode: "structured",
      },
    });

    expect(delivery.statusCode).toBe(400);
    expect(delivery.json()).toMatchObject({
      error: `File ${fileId} is not ready`,
    });

    await app.close();
  });

  it("creates delivered tasks only after file completion and enforces review permissions", async () => {
    const runtime = createPlatformApiRuntime();
    const { app, state } = runtime;
    const owner = await login(app, "owner", "owner123");
    const member = await login(app, "member", "member123");
    const agent = await registerAgent(app);
    const content = "hello";

    const uploadInit = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-init",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_upload_init_ready",
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
        request_id: "req_upload_complete_ready",
        file_id: fileId,
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({
      accepted: true,
      file_id: fileId,
      status: "ready",
    });

    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_task_delivery_ready",
        project_id: "proj_demo",
        workflow_id: "wf_demo",
        workflow_template_id: "wf_tmpl_demo_v1",
        template_version: 1,
        step_id: "step_excel_revise",
        task_title: "Spring sheet revise",
        task_type: "excel_handoff",
        sender_user_id: "user_owner",
        target_user_id: "user_member",
        target_agent_id: agent.agentId,
        priority: "high",
        deadline: "2026-03-10T18:00:00+08:00",
        summary: "Update sheet 2",
        constraints: [],
        deliverables: ["Update sheet 2"],
        attachment_file_ids: [fileId],
        plan_mode: "structured",
      },
    });
    expect(delivery.statusCode).toBe(200);
    const deliveryBody = delivery.json() as { task_id: string; delivery_status: string };
    expect(deliveryBody.delivery_status).toBe("delivered");

    const task = state.tasks.get(deliveryBody.task_id);
    expect(task?.status).toBe("delivered");
    expect(task?.workflowTemplateId).toBe("wf_tmpl_demo_v1");
    expect(task?.templateVersion).toBe(1);

    if (!task) {
      throw new Error("Task was not created");
    }
    task.status = "waiting_review";

    const memberDone = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${task.taskId}/status`,
      headers: {
        cookie: member.cookieHeader,
        "x-csrf-token": member.csrfToken,
      },
      payload: {
        request_id: "req_member_done_attempt",
        task_id: task.taskId,
        status: "done",
        actor_role: "assignee",
        occurred_at: "2026-03-09T12:00:00+08:00",
      },
    });
    expect(memberDone.statusCode).toBe(400);
    expect(memberDone.json()).toMatchObject({
      error: "Illegal task transition: waiting_review -> done for role assignee",
    });

    const ownerDone = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${task.taskId}/status`,
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_owner_done",
        task_id: task.taskId,
        status: "done",
        actor_role: "owner",
        occurred_at: "2026-03-09T12:05:00+08:00",
      },
    });
    expect(ownerDone.statusCode).toBe(200);
    expect(ownerDone.json()).toMatchObject({
      task_id: task.taskId,
      status: "done",
    });

    await app.close();
  });

  it("persists managed users to the account file when admins create them", async () => {
    delete process.env.FLOW_SEED_MODE;
    const accountFiles = writeManagedAccounts(storageRoot, [
      {
        user_id: "user_admin",
        username: "admin",
        display_name: "管理员",
        role: "admin",
        password: "admin123",
        status: "active",
      },
    ]);

    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");

    const createUser = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        username: "member01",
        display_name: "普通成员",
        role: "member",
        password: "member123",
      },
    });

    expect(createUser.statusCode).toBe(201);
    const managedUsers = JSON.parse(fs.readFileSync(accountFiles.usersFile, "utf8")) as { accounts: ManagedAccountSeed[] };
    expect(managedUsers.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "admin",
        }),
        expect.objectContaining({
          username: "member01",
          display_name: "普通成员",
          role: "member",
          password: "member123",
        }),
      ]),
    );
    expect(fs.readFileSync(accountFiles.summaryFile, "utf8")).toContain("member01");

    await app.close();
  });

  it("persists managed projects, tasks, agents, and task create options across restarts", async () => {
    delete process.env.FLOW_SEED_MODE;
    writeManagedAccounts(storageRoot, [
      {
        user_id: "user_admin",
        username: "admin",
        display_name: "管理员",
        role: "admin",
        password: "admin123",
        status: "active",
      },
      {
        user_id: "user_member01",
        username: "member01",
        display_name: "普通成员",
        role: "member",
        password: "member123",
        status: "active",
      },
    ]);

    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");
    const agent = await registerAgent(app, {
      requestId: "req_register_admin_persisted_agent",
      agentName: "ADMIN-PC",
      machineName: "ADMIN-PC",
      ownerUserId: "user_admin",
      localUiPort: 38500,
    });

    const createProject = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_persisted_project",
        project_name: "持久化项目",
        description: "验证 managed 模式下项目状态持久化",
        department: "operations",
        participant_user_ids: ["user_admin", "user_member01"],
        owner_user_id: "user_admin",
        project_type: "operations",
        priority: "P1",
        status: "in_progress",
        attachment_file_ids: [],
      },
    });
    expect(createProject.statusCode).toBe(201);
    const projectBody = createProject.json() as { project_id: string };

    const createTask = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_persisted_task",
        project_id: projectBody.project_id,
        workflow_id: "wf_persisted_task",
        workflow_template_id: "wf_tmpl_persisted_task",
        template_version: 1,
        step_id: "step_persisted_task",
        task_title: "持久化任务",
        task_type: "excel_handoff",
        sender_user_id: "user_admin",
        target_user_id: "user_admin",
        target_agent_id: agent.agentId,
        priority: "medium",
        deadline: "2026-03-18T18:00:00+08:00",
        summary: "验证 managed 模式下任务状态持久化",
        constraints: [],
        deliverables: ["验证任务持久化"],
        attachment_file_ids: [],
        plan_mode: "structured",
      },
    });
    expect(createTask.statusCode).toBe(200);
    const taskBody = createTask.json() as { task_id: string };

    await app.close();

    const restartedRuntime = createPlatformApiRuntime();
    const restartedApp = restartedRuntime.app;
    const restartedAdmin = await login(restartedApp, "admin", "admin123");

    const [projectsResponse, tasksResponse, agentsResponse, taskOptionsResponse] = await Promise.all([
      restartedApp.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: {
          cookie: restartedAdmin.cookieHeader,
        },
      }),
      restartedApp.inject({
        method: "GET",
        url: "/api/v1/tasks",
        headers: {
          cookie: restartedAdmin.cookieHeader,
        },
      }),
      restartedApp.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: {
          cookie: restartedAdmin.cookieHeader,
        },
      }),
      restartedApp.inject({
        method: "GET",
        url: "/api/v1/task-create-options",
        headers: {
          cookie: restartedAdmin.cookieHeader,
        },
      }),
    ]);

    expect(projectsResponse.statusCode).toBe(200);
    expect(tasksResponse.statusCode).toBe(200);
    expect(agentsResponse.statusCode).toBe(200);
    expect(taskOptionsResponse.statusCode).toBe(200);

    expect(projectsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: projectBody.project_id,
          projectName: "持久化项目",
        }),
      ]),
    );
    expect(tasksResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: taskBody.task_id,
          task_title: "持久化任务",
          assignee_user_id: "user_admin",
        }),
      ]),
    );
    expect(agentsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_id: agent.agentId,
          owner_user_id: "user_admin",
        }),
      ]),
    );
    expect(taskOptionsResponse.json()).toMatchObject({
      responsibles: expect.arrayContaining([
        expect.objectContaining({
          user_id: "user_admin",
          display_name: "管理员",
          preferred_agent_id: agent.agentId,
        }),
      ]),
    });

    await restartedApp.close();
  });

  it("updates projects and tasks through the new PATCH routes", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_patch_member_agent",
      ownerUserId: "user_member",
      agentName: "MEMBER-PC",
      machineName: "MEMBER-PC",
    });
    const adminAgent = await registerAgent(app, {
      requestId: "req_register_patch_admin_agent",
      ownerUserId: "user_admin",
      agentName: "ADMIN-PATCH-PC",
      machineName: "ADMIN-PATCH-PC",
      localUiPort: 38501,
    });

    const createProject = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_patch_project_create",
        project_name: "Patch 项目",
        description: "用于测试 project patch",
        department: "operations",
        participant_user_ids: ["user_admin", "user_member"],
        owner_user_id: "user_admin",
        project_type: "operations",
        priority: "P2",
        status: "not_started",
        attachment_file_ids: [],
      },
    });
    expect(createProject.statusCode).toBe(201);
    const { project_id: createdProjectId } = createProject.json() as { project_id: string };

    const patchProject = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${createdProjectId}`,
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_patch_project_update",
        project_name: "Patch 项目-已更新",
        description: "更新后的项目说明",
        priority: "P1",
        status: "done",
        due_date: "2026-03-20T18:00:00+08:00",
      },
    });
    expect(patchProject.statusCode).toBe(200);
    expect(patchProject.json()).toMatchObject({
      projectId: createdProjectId,
      projectName: "Patch 项目-已更新",
      description: "更新后的项目说明",
      priority: "P1",
      status: "done",
      completionRate: 100,
    });

    const createTask = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_patch_task_create",
        project_id: createdProjectId,
        workflow_id: "wf_patch_local",
        workflow_template_id: "wf_tmpl_patch_local",
        template_version: 1,
        step_id: "step_patch_local",
        task_title: "Patch 任务",
        task_type: "general_request",
        sender_user_id: "user_admin",
        target_user_id: "user_member",
        target_agent_id: memberAgent.agentId,
        priority: "medium",
        deadline: "2026-03-19T12:00:00+08:00",
        summary: "用于测试 task patch",
        constraints: ["先完成草稿"],
        deliverables: ["Patch 报告"],
        attachment_file_ids: [],
        plan_mode: "structured",
      },
    });
    expect(createTask.statusCode).toBe(200);
    const { task_id: createdTaskId } = createTask.json() as { task_id: string };

    const patchTask = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTaskId}`,
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        request_id: "req_patch_task_update",
        project_id: "proj_demo",
        workflow_id: "wf_demo",
        workflow_template_id: "wf_tmpl_demo_v1",
        template_version: 1,
        step_id: "step_excel_revise",
        task_title: "Patch 任务-已更新",
        summary: "已经切换到 demo 项目并重新指派",
        deadline: "2026-03-20T15:00:00+08:00",
        priority: "high",
        assignee_user_id: "user_admin",
        assignee_agent_id: adminAgent.agentId,
      },
    });
    expect(patchTask.statusCode).toBe(200);
    expect(patchTask.json()).toMatchObject({
      task_id: createdTaskId,
      project_id: "proj_demo",
      workflow_id: "wf_demo",
      task_title: "Patch 任务-已更新",
      summary: "已经切换到 demo 项目并重新指派",
      deadline: "2026-03-20T15:00:00+08:00",
      priority: "high",
      assignee_user_id: "user_admin",
      assignee_agent_id: adminAgent.agentId,
    });

    await app.close();
  });

  it("rejects invalid project updates and manager-only task updates from assignees", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const owner = await login(app, "owner", "owner123");
    const member = await login(app, "member", "member123");
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_validation_member_agent",
      ownerUserId: "user_member",
      agentName: "MEMBER-VALIDATE-PC",
      machineName: "MEMBER-VALIDATE-PC",
    });
    const ownerAgent = await registerAgent(app, {
      requestId: "req_register_validation_owner_agent",
      ownerUserId: "user_owner",
      agentName: "OWNER-VALIDATE-PC",
      machineName: "OWNER-VALIDATE-PC",
      localUiPort: 38502,
    });

    const invalidProjectPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/projects/proj_demo",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_invalid_project_dates",
        start_date: "2026-03-20T10:00:00+08:00",
        due_date: "2026-03-19T10:00:00+08:00",
      },
    });
    expect(invalidProjectPatch.statusCode).toBe(400);
    expect(invalidProjectPatch.json()).toMatchObject({
      error: "Expected due date must be after the start date",
    });

    const createTask = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_validation_task_create",
        project_id: "proj_demo",
        workflow_id: "wf_demo",
        workflow_template_id: "wf_tmpl_demo_v1",
        template_version: 1,
        step_id: "step_excel_revise",
        task_title: "权限测试任务",
        task_type: "general_request",
        sender_user_id: "user_owner",
        target_user_id: "user_member",
        target_agent_id: memberAgent.agentId,
        priority: "medium",
        deadline: "2026-03-19T16:00:00+08:00",
        summary: "验证 assignee 权限和 assignee/agent 校验",
        constraints: [],
        deliverables: ["权限测试结果"],
        attachment_file_ids: [],
        plan_mode: "structured",
      },
    });
    expect(createTask.statusCode).toBe(200);
    const { task_id: createdTaskId } = createTask.json() as { task_id: string };

    const forbiddenTaskPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTaskId}`,
      headers: {
        cookie: member.cookieHeader,
        "x-csrf-token": member.csrfToken,
      },
      payload: {
        request_id: "req_member_forbidden_task_patch",
        priority: "critical",
      },
    });
    expect(forbiddenTaskPatch.statusCode).toBe(403);
    expect(forbiddenTaskPatch.json()).toMatchObject({
      error: "Assignee can only update task content fields",
    });

    const mismatchedAssigneePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTaskId}`,
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_invalid_assignee_pair",
        assignee_user_id: "user_member",
        assignee_agent_id: ownerAgent.agentId,
      },
    });
    expect(mismatchedAssigneePatch.statusCode).toBe(400);
    expect(mismatchedAssigneePatch.json()).toMatchObject({
      error: "assignee_agent_id must belong to assignee_user_id",
    });

    await app.close();
  });

  it("routes conversation messages to target agents and appends delivery receipts", async () => {
    const runtime = createPlatformApiRuntime();
    const { app, state } = runtime;
    const owner = await login(app, "owner", "owner123");
    const agent = await registerAgent(app);

    const send = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/messages",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_conversation_send",
        target_agent_id: agent.agentId,
        body: "请帮我先整理一版任务交接说明。",
      },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json()).toMatchObject({
      accepted: true,
    });

    const ownerThread = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/thread",
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    expect(ownerThread.statusCode).toBe(200);
    const ownerThreadBody = ownerThread.json() as { messages: Array<{ message_type: string }> };
    expect(ownerThreadBody.messages.map((message) => message.message_type)).toEqual(["user_message", "sender_ack"]);

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/pending`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
    });
    expect(pending.statusCode).toBe(200);
    const pendingBody = pending.json() as Array<{ message_id: string; message_type: string; body: string }>;
    expect(pendingBody).toHaveLength(1);
    expect(pendingBody[0]).toMatchObject({
      message_type: "incoming_delivery",
    });

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/${pendingBody[0].message_id}/ack`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_ack",
      },
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({
      accepted: true,
    });

    const refreshedThread = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/thread",
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    const refreshedThreadBody = refreshedThread.json() as { messages: Array<{ message_type: string }> };
    expect(refreshedThreadBody.messages.map((message) => message.message_type)).toEqual([
      "user_message",
      "sender_ack",
      "delivery_receipt",
    ]);

    const syncedMessage = [...state.conversationMessages.values()].find((message) => message.messageType === "incoming_delivery");
    expect(syncedMessage?.syncStatus).toBe("synced");

    await app.close();
  });

  it("defaults conversations to the current OpenClaw thread when no target is provided", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const member = await login(app, "member", "member123");
    const agent = await registerAgent(app);

    const send = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/messages",
      headers: {
        cookie: member.cookieHeader,
        "x-csrf-token": member.csrfToken,
      },
      payload: {
        request_id: "req_conversation_self",
        body: "先记住这是一条发给我本机 OpenClaw 的消息。",
      },
    });
    expect(send.statusCode).toBe(200);
    const sendBody = send.json() as { messages: Array<{ message_type: string }> };
    expect(sendBody.messages.map((message) => message.message_type)).toEqual(["user_message"]);

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/pending`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
    });
    expect(pending.statusCode).toBe(200);
    const pendingBody = pending.json() as Array<{ message_id: string; message_type: string }>;
    expect(pendingBody).toHaveLength(1);
    expect(pendingBody[0].message_type).toBe("user_message");

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/${pendingBody[0].message_id}/ack`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_self_ack",
      },
    });
    expect(ack.statusCode).toBe(200);

    const refreshedThread = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/thread",
      headers: {
        cookie: member.cookieHeader,
      },
    });
    expect(refreshedThread.statusCode).toBe(200);
    const refreshedThreadBody = refreshedThread.json() as { messages: Array<{ message_type: string; sync_status: string }> };
    expect(refreshedThreadBody.messages).toHaveLength(1);
    expect(refreshedThreadBody.messages[0]).toMatchObject({
      message_type: "user_message",
      sync_status: "synced",
    });

    const processing = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/${pendingBody[0].message_id}/status`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_self_processing",
        sync_status: "processing",
      },
    });
    expect(processing.statusCode).toBe(200);

    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/${pendingBody[0].message_id}/reply`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_self_reply",
        body: "这是来自真实 OpenClaw 的回复。",
      },
    });
    expect(reply.statusCode).toBe(200);

    const repliedThread = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/thread",
      headers: {
        cookie: member.cookieHeader,
      },
    });
    expect(repliedThread.statusCode).toBe(200);
    const repliedThreadBody = repliedThread.json() as {
      messages: Array<{ message_type: string; body: string; sync_status?: string }>;
    };
    expect(repliedThreadBody.messages.map((message) => message.message_type)).toEqual(["user_message", "openclaw_reply"]);
    expect(repliedThreadBody.messages[0]).toMatchObject({
      message_type: "user_message",
      sync_status: "replied",
    });
    expect(repliedThreadBody.messages[1]?.body).toBe("这是来自真实 OpenClaw 的回复。");

    await app.close();
  });

  it("allows the local agent to send self conversation messages without a browser session", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const agent = await registerAgent(app);

    const send = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.agentId}/conversations/self/messages`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
      payload: {
        request_id: "req_agent_self_conversation_send",
        body: "这是本机 overlay 发出的消息",
      },
    });
    expect(send.statusCode).toBe(200);
    const sendBody = send.json() as { messages: Array<{ message_type: string; target_agent_id: string }> };
    expect(sendBody.messages).toHaveLength(1);
    expect(sendBody.messages[0]).toMatchObject({
      message_type: "user_message",
      target_agent_id: agent.agentId,
    });

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.agentId}/conversations/messages/pending`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
    });
    expect(pending.statusCode).toBe(200);
    const pendingBody = pending.json() as Array<{ body: string; message_type: string }>;
    expect(pendingBody).toHaveLength(1);
    expect(pendingBody[0]).toMatchObject({
      body: "这是本机 overlay 发出的消息",
      message_type: "user_message",
    });

    await app.close();
  });

  it("lists conversation forwarding targets and creates forwarded messages with system task briefs", async () => {
    const runtime = createPlatformApiRuntime();
    const { app, state } = runtime;
    const owner = await login(app, "owner", "owner123");
    const ownerAgent = await registerAgent(app, {
      requestId: "req_register_owner_conversation_forward_agent",
      agentName: "OWNER-PC",
      machineName: "OWNER-PC",
      ownerUserId: "user_owner",
      localUiPort: 38500,
    });
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_member_conversation_forward_agent",
      agentName: "MEMBER-PC",
      machineName: "MEMBER-PC",
      ownerUserId: "user_member",
      localUiPort: 38501,
    });

    const targets = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-targets`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
    });
    expect(targets.statusCode).toBe(200);
    expect(targets.json()).toEqual([
      expect.objectContaining({
        user_id: "user_member",
        username: "member",
        agent_id: memberAgent.agentId,
        online: true,
      }),
    ]);

    const forward = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-forwards`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_execution",
        target_name: "member",
        forward_body: "请今天 18:00 前确认鞋面表",
        task_brief_title: "确认鞋面表",
        task_brief_summary: "请今天 18:00 前确认鞋面表",
      },
    });
    expect(forward.statusCode).toBe(200);
    const forwardBody = forward.json() as {
      accepted: boolean;
      target: { user_id: string; agent_id: string };
      forwarded_message: { message_id: string; message_type: string; body: string };
      task_brief: {
        task_id: string;
        project_name: string;
        task_title: string;
        status: string;
        openclaw_progress?: {
          current_status_label: string;
          steps: Array<{ step_label: string; status: string }>;
        };
      };
    };
    expect(forward.json()).toMatchObject({
      accepted: true,
      target: {
        user_id: "user_member",
        agent_id: memberAgent.agentId,
      },
      forwarded_message: {
        message_type: "incoming_delivery",
        body: "请今天 18:00 前确认鞋面表",
      },
      task_brief: {
        project_name: "OpenClaw 会话转发",
        task_title: "确认鞋面表",
        status: "delivered",
      },
    });
    expect(forwardBody.task_brief.openclaw_progress).toMatchObject({
      current_status_label: "已创建",
      steps: [
        { step_label: "创建", status: "completed" },
        { step_label: "进行中", status: "pending" },
        { step_label: "完成", status: "pending" },
      ],
    });

    const recipientPending = [...state.conversationMessages.values()].filter((message) =>
      message.ownerUserId === "user_member" && message.messageType === "incoming_delivery");
    expect(recipientPending).toHaveLength(1);
    expect(recipientPending[0]).toMatchObject({
      body: "请今天 18:00 前确认鞋面表",
      targetAgentId: memberAgent.agentId,
      syncStatus: "pending",
    });

    const taskBrief = [...state.tasks.values()].find((task) => task.projectId === "proj_openclaw_conversation_router");
    expect(taskBrief).toBeTruthy();
    expect(taskBrief).toMatchObject({
      taskTitle: "确认鞋面表",
      assigneeUserId: "user_member",
      assigneeAgentId: memberAgent.agentId,
      status: "delivered",
    });

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${memberAgent.agentId}/conversations/messages/${forwardBody.forwarded_message.message_id}/ack`,
      headers: {
        authorization: `Bearer ${memberAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_ack",
        delivered_at: "2026-03-18T10:15:00+08:00",
      },
    });
    expect(ack.statusCode).toBe(200);

    const afterAckTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${forwardBody.task_brief.task_id}`,
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    expect(afterAckTask.statusCode).toBe(200);
    expect(afterAckTask.json()).toMatchObject({
      task_id: forwardBody.task_brief.task_id,
      status: "in_progress",
      openclaw_progress: {
        current_status_label: "进行中",
        steps: [
          { step_label: "创建", status: "completed" },
          {
            step_label: "进行中",
            status: "active",
            actor_display_name: expect.any(String),
          },
          { step_label: "完成", status: "pending" },
        ],
      },
    });

    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${memberAgent.agentId}/conversations/messages/${forwardBody.forwarded_message.message_id}/reply`,
      headers: {
        authorization: `Bearer ${memberAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_reply_complete",
        body: "已完成，结果如下：鞋面表已经确认完毕，请查收。",
        occurred_at: "2026-03-18T10:30:00+08:00",
      },
    });
    expect(reply.statusCode).toBe(200);

    const afterReplyTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${forwardBody.task_brief.task_id}`,
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    expect(afterReplyTask.statusCode).toBe(200);
    expect(afterReplyTask.json()).toMatchObject({
      task_id: forwardBody.task_brief.task_id,
      status: "done",
      openclaw_progress: {
        current_status_label: "已完成",
        steps: [
          { step_label: "创建", status: "completed" },
          { step_label: "进行中", status: "completed" },
          {
            step_label: "完成",
            status: "completed",
            actor_display_name: expect.any(String),
          },
        ],
      },
    });

    const markedOffline = state.agents.get(memberAgent.agentId);
    if (markedOffline) {
      markedOffline.status = "offline";
      state.agents.set(markedOffline.agentId, markedOffline);
    }

    const offlineForward = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-forwards`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_offline",
        target_name: "member",
        forward_body: "这条消息不应该发送出去",
        task_brief_title: "离线拒绝测试",
        task_brief_summary: "这条消息不应该发送出去",
      },
    });
    expect(offlineForward.statusCode).toBe(400);
    expect(offlineForward.json()).toMatchObject({
      error: expect.stringContaining("当前未连接本机 OpenClaw"),
    });

    await app.close();
  });

  it("reuses an active conversation brief task instead of creating a duplicate", async () => {
    const runtime = createPlatformApiRuntime();
    const { app, state } = runtime;
    const owner = await login(app, "owner", "owner123");
    const ownerAgent = await registerAgent(app, {
      requestId: "req_register_owner_conversation_reuse_agent",
      agentName: "OWNER-PC",
      machineName: "OWNER-PC",
      ownerUserId: "user_owner",
      localUiPort: 38518,
    });
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_member_conversation_reuse_agent",
      agentName: "MEMBER-PC",
      machineName: "MEMBER-PC",
      ownerUserId: "user_member",
      localUiPort: 38519,
    });

    const firstForward = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-forwards`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_reuse_first",
        target_name: "member",
        forward_body: "Please summarize the material checklist and today's progress.",
        task_brief_title: "Material checklist summary",
        task_brief_summary: "Please summarize the material checklist and today's progress.",
      },
    });
    expect(firstForward.statusCode).toBe(200);
    const firstPayload = firstForward.json() as {
      forwarded_message: { message_id: string };
      task_brief: { task_id: string };
    };

    const secondForward = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-forwards`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_reuse_second",
        target_name: "member",
        forward_body: "Please continue the same task card instead of creating a new one.",
        task_brief_title: "Material checklist summary",
        task_brief_summary: "Please summarize the material checklist and today's progress.",
      },
    });
    expect(secondForward.statusCode).toBe(200);
    const secondPayload = secondForward.json() as {
      forwarded_message: { message_id: string };
      task_brief: { task_id: string };
    };

    expect(secondPayload.task_brief.task_id).toBe(firstPayload.task_brief.task_id);
    expect(
      [...state.tasks.values()].filter((task) =>
        task.projectId === "proj_openclaw_conversation_router"
        && task.assigneeAgentId === memberAgent.agentId
        && task.taskTitle.includes("Material")),
    ).toHaveLength(1);

    const taskDetail = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${firstPayload.task_brief.task_id}`,
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    expect(taskDetail.statusCode).toBe(200);
    expect(taskDetail.json()).toMatchObject({
      task_id: firstPayload.task_brief.task_id,
      openclaw_progress: {
        steps: [
          { status: "completed" },
          { status: "pending" },
          { status: "pending" },
        ],
      },
    });

    const linkedProgress = state.openClawTaskProgress.get(firstPayload.task_brief.task_id);
    expect(linkedProgress?.linkedMessageIds).toContain(firstPayload.forwarded_message.message_id);
    expect(linkedProgress?.linkedMessageIds).toContain(secondPayload.forwarded_message.message_id);

    await app.close();
  });

  it("keeps conversation brief tasks in progress for clarification replies", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const owner = await login(app, "owner", "owner123");
    const ownerAgent = await registerAgent(app, {
      requestId: "req_register_owner_conversation_clarify_agent",
      agentName: "OWNER-PC",
      machineName: "OWNER-PC",
      ownerUserId: "user_owner",
      localUiPort: 38510,
    });
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_member_conversation_clarify_agent",
      agentName: "MEMBER-PC",
      machineName: "MEMBER-PC",
      ownerUserId: "user_member",
      localUiPort: 38511,
    });

    const forward = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${ownerAgent.agentId}/conversation-forwards`,
      headers: {
        authorization: `Bearer ${ownerAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_clarify",
        target_name: "member",
        forward_body: "请整理一份面料清单",
        task_brief_title: "整理面料清单",
        task_brief_summary: "请整理一份面料清单",
      },
    });
    expect(forward.statusCode).toBe(200);
    const forwardPayload = forward.json() as {
      forwarded_message: { message_id: string };
      task_brief: { task_id: string };
    };

    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${memberAgent.agentId}/conversations/messages/${forwardPayload.forwarded_message.message_id}/reply`,
      headers: {
        authorization: `Bearer ${memberAgent.agentToken}`,
      },
      payload: {
        request_id: "req_conversation_forward_reply_clarify",
        body: "我还需要确认尺码和配色，请补充图片。",
        occurred_at: "2026-03-18T11:00:00+08:00",
      },
    });
    expect(reply.statusCode).toBe(200);

    const task = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${forwardPayload.task_brief.task_id}`,
      headers: {
        cookie: owner.cookieHeader,
      },
    });
    expect(task.statusCode).toBe(200);
    expect(task.json()).toMatchObject({
      task_id: forwardPayload.task_brief.task_id,
      status: "in_progress",
      openclaw_progress: {
        current_status_label: "已回复，待继续处理",
        steps: [
          { step_label: "创建", status: "completed" },
          { step_label: "进行中", status: "active" },
          { step_label: "完成", status: "pending" },
        ],
      },
    });

    await app.close();
  });

  it("accepts explicit openclaw task progress upserts", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const owner = await login(app, "owner", "owner123");
    const memberAgent = await registerAgent(app, {
      requestId: "req_register_member_progress_agent",
      agentName: "MEMBER-PC",
      machineName: "MEMBER-PC",
      ownerUserId: "user_member",
      localUiPort: 38512,
    });

    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/task-deliveries",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_openclaw_progress_delivery",
        project_id: "proj_demo",
        workflow_id: "wf_demo",
        workflow_template_id: "wf_tmpl_demo_v1",
        template_version: 1,
        step_id: "step_excel_revise",
        task_title: "OpenClaw 进度写入测试",
        task_type: "general_request",
        sender_user_id: "user_owner",
        target_user_id: "user_member",
        target_agent_id: memberAgent.agentId,
        priority: "medium",
        deadline: "2026-03-19T18:00:00+08:00",
        summary: "验证 openclaw-progress route",
        constraints: [],
        deliverables: ["写入自定义步骤"],
        attachment_file_ids: [],
        plan_mode: "structured",
      },
    });
    expect(delivery.statusCode).toBe(200);
    const deliveryBody = delivery.json() as { task_id: string };

    const update = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${deliveryBody.task_id}/openclaw-progress`,
      headers: {
        authorization: `Bearer ${memberAgent.agentToken}`,
      },
      payload: {
        request_id: "req_openclaw_progress_upsert",
        steps: [
          {
            step_index: 1,
            step_label: "创建",
            status: "completed",
            actor_display_name: "admin",
            happened_at: "2026-03-18T09:00:00+08:00",
            source: "user",
          },
          {
            step_index: 2,
            step_label: "资料整理",
            status: "completed",
            actor_display_name: "泽阳",
            happened_at: "2026-03-18T09:30:00+08:00",
            source: "openclaw",
          },
          {
            step_index: 3,
            step_label: "趋势分析",
            status: "active",
            actor_display_name: "泽阳",
            happened_at: "2026-03-18T10:00:00+08:00",
            source: "openclaw",
          },
          {
            step_index: 4,
            step_label: "完成",
            status: "pending",
            source: "system",
          },
        ],
        active_step_index: 3,
        current_status_label: "正在输出趋势分析",
        sync_task_status: "in_progress",
        decision_summary: "OpenClaw 已进入趋势分析阶段。",
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      task_id: deliveryBody.task_id,
      status: "in_progress",
      openclaw_progress: {
        active_step_index: 3,
        current_status_label: "正在输出趋势分析",
        steps: [
          { step_label: "创建", status: "completed" },
          { step_label: "资料整理", status: "completed" },
          { step_label: "趋势分析", status: "active" },
          { step_label: "完成", status: "pending" },
        ],
      },
    });

    await app.close();
  });

  it("does not fall back to another user's agent for self conversations", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const owner = await login(app, "owner", "owner123");

    await registerAgent(app);

    const send = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/messages",
      headers: {
        cookie: owner.cookieHeader,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        request_id: "req_conversation_owner_without_self_agent",
        body: "这条消息不应该被路由给别人的 OpenClaw。",
      },
    });

    expect(send.statusCode).toBe(400);
    expect(send.json()).toMatchObject({
      error: "Current OpenClaw agent is not available",
    });

    await app.close();
  });

  it("allows multiple local agents to register with the development bootstrap token", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;

    const ownerAgent = await app.inject({
      method: "POST",
      url: "/api/v1/agents/register",
      headers: {
        "x-bootstrap-token": "flow-bootstrap-local",
      },
      payload: {
        request_id: "req_register_owner_agent",
        agent_name: "OWNER-PC",
        machine_name: "OWNER-PC",
        owner_user_id: "user_owner",
        ip_address: "127.0.0.1",
        runtime_version: "0.1.0",
        local_ui_port: 38500,
        os_type: "windows",
        capabilities: ["local_storage"],
      },
    });
    expect(ownerAgent.statusCode).toBe(200);

    const memberAgent = await app.inject({
      method: "POST",
      url: "/api/v1/agents/register",
      headers: {
        "x-bootstrap-token": "flow-bootstrap-local",
      },
      payload: {
        request_id: "req_register_member_agent",
        agent_name: "MEMBER-PC",
        machine_name: "MEMBER-PC",
        owner_user_id: "user_member",
        ip_address: "127.0.0.1",
        runtime_version: "0.1.0",
        local_ui_port: 38501,
        os_type: "windows",
        capabilities: ["local_storage"],
      },
    });
    expect(memberAgent.statusCode).toBe(200);

    await app.close();
  });

  it("publishes the current agent release and exposes update availability to agents", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");
    const agent = await registerAgent(app);

    const releaseDir = path.join(storageRoot, "releases", "agents", "2026.3.11");
    fs.mkdirSync(releaseDir, { recursive: true });
    const packagePath = path.join(releaseDir, "flow-system-agent-2026.3.11.tar.gz");
    fs.writeFileSync(packagePath, "release-binary");
    const hash = sha256("release-binary");
    const size = Buffer.byteLength("release-binary");

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/releases/agents/current",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        version: "2026.3.11",
        notes: "修复会话同步和本机更新。",
        package_rel_path: "releases/agents/2026.3.11/flow-system-agent-2026.3.11.tar.gz",
        package_sha256: hash,
        package_size_bytes: size,
      },
    });
    expect(publish.statusCode).toBe(200);

    const currentRelease = await app.inject({
      method: "GET",
      url: "/api/v1/releases/agents/current",
      headers: {
        cookie: admin.cookieHeader,
      },
    });
    expect(currentRelease.statusCode).toBe(200);
    expect(currentRelease.json()).toMatchObject({
      version: "2026.3.11",
      package_sha256: hash,
    });

    const agentRelease = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.agentId}/releases/current`,
      headers: {
        authorization: `Bearer ${agent.agentToken}`,
      },
    });
    expect(agentRelease.statusCode).toBe(200);
    expect(agentRelease.json()).toMatchObject({
      current_version: "0.1.0",
      update_available: true,
      release: {
        version: "2026.3.11",
      },
    });

    const catalog = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      headers: {
        cookie: admin.cookieHeader,
      },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_id: agent.agentId,
          local_ui_port: 38500,
          update_available: true,
          latest_release_version: "2026.3.11",
        }),
      ]),
    );

    await app.close();
  });

  it("lets admins create users, update them, and blocks disabled accounts from logging in", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        username: "zhangsan",
        display_name: "张三",
        role: "member",
        password: "zhangsan123",
      },
    });
    expect(create.statusCode).toBe(201);
    const createdUser = create.json() as { user: { user_id: string; username: string; status: string } };
    expect(createdUser.user).toMatchObject({
      username: "zhangsan",
      status: "active",
    });

    const users = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: {
        cookie: admin.cookieHeader,
      },
    });
    expect(users.statusCode).toBe(200);
    expect(users.json()).toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({
          user_id: createdUser.user.user_id,
          username: "zhangsan",
        }),
      ]),
    });

    const userLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "zhangsan",
        password: "zhangsan123",
      },
    });
    expect(userLogin.statusCode).toBe(200);

    const disable = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${createdUser.user.user_id}`,
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        status: "disabled",
        password: "zhangsan456",
      },
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json()).toMatchObject({
      user: {
        user_id: createdUser.user.user_id,
        status: "disabled",
      },
    });

    const disabledLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "zhangsan",
        password: "zhangsan456",
      },
    });
    expect(disabledLogin.statusCode).toBe(403);
    expect(disabledLogin.json()).toMatchObject({
      error: "User is disabled",
    });

    const selfDisable = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/user_admin",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        status: "disabled",
      },
    });
    expect(selfDisable.statusCode).toBe(400);
    expect(selfDisable.json()).toMatchObject({
      error: "You cannot disable your own account",
    });

    await app.close();
  });

  it("lets admins delete users, revokes their sessions, and blocks self deletion", async () => {
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;
    const admin = await login(app, "admin", "admin123");

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        username: "lisi",
        display_name: "李四",
        role: "member",
        password: "lisi1234",
      },
    });
    expect(create.statusCode).toBe(201);
    const createdUser = create.json() as { user: { user_id: string } };

    const userLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "lisi",
        password: "lisi1234",
      },
    });
    expect(userLogin.statusCode).toBe(200);
    const userCookieHeader = userLogin.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${createdUser.user.user_id}`,
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({
      accepted: true,
      deleted_user_id: createdUser.user.user_id,
    });

    const users = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: {
        cookie: admin.cookieHeader,
      },
    });
    expect(users.statusCode).toBe(200);
    expect(users.json()).not.toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({
          user_id: createdUser.user.user_id,
        }),
      ]),
    });

    const deletedUserMe = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        cookie: userCookieHeader,
      },
    });
    expect(deletedUserMe.statusCode).toBe(401);

    const selfDelete = await app.inject({
      method: "DELETE",
      url: "/api/v1/users/user_admin",
      headers: {
        cookie: admin.cookieHeader,
        "x-csrf-token": admin.csrfToken,
      },
    });
    expect(selfDelete.statusCode).toBe(400);
    expect(selfDelete.json()).toMatchObject({
      error: "You cannot delete your own account",
    });

    await app.close();
  });

  it("stores local agent UI ports and returns the platform web origin to agents", async () => {
    process.env.APP_ORIGIN = "http://192.168.1.50:3000";
    const runtime = createPlatformApiRuntime();
    const { app } = runtime;

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/agents/register",
      headers: {
        "x-bootstrap-token": "flow-bootstrap-local",
      },
      payload: {
        request_id: "req_register_agent_port_config",
        agent_name: "MEMBER-PC",
        machine_name: "MEMBER-PC",
        owner_user_id: "user_member",
        ip_address: "192.168.1.88",
        runtime_version: "0.1.0",
        local_ui_port: 39500,
        os_type: "windows",
        capabilities: ["local_storage"],
      },
    });
    expect(registered.statusCode).toBe(200);
    const payload = registered.json() as { agent_id: string; agent_token: string };

    const config = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${payload.agent_id}/config`,
      headers: {
        authorization: `Bearer ${payload.agent_token}`,
      },
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toMatchObject({
      local_ui_port: 39500,
      platform_web_origin: "http://192.168.1.50:3000",
    });

    await app.close();
    delete process.env.APP_ORIGIN;
  });
});
