import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function parseArguments(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    result.set(key, value);
    if (value !== "true") {
      index += 1;
    }
  }
  return result;
}

function toIsoFromStat(filePath) {
  return fs.statSync(filePath).mtime.toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenPreview(token) {
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadExistingSnapshot(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }
  try {
    const snapshot = readJsonFile(snapshotPath);
    if (snapshot?.version !== 1) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function defaultAgentName(alias) {
  return `${alias.toUpperCase()}-PC`;
}

function normalizeStatus(status) {
  if (typeof status !== "string" || status.length === 0) {
    return "delivered";
  }
  return status;
}

function inferProjectStatus(tasks) {
  const activeStatuses = new Set(["delivered", "received", "accepted", "in_progress", "waiting_review"]);
  if (tasks.some((task) => activeStatuses.has(task.status))) {
    return "in_progress";
  }
  if (tasks.length > 0 && tasks.every((task) => ["done", "archived"].includes(task.status))) {
    return "done";
  }
  return "not_started";
}

function projectStageLabel(status) {
  if (status === "done") {
    return "已完成";
  }
  if (status === "in_progress") {
    return "进行中";
  }
  return "未启动";
}

function completionRate(tasks) {
  if (tasks.length === 0) {
    return 0;
  }
  const doneCount = tasks.filter((task) => ["done", "archived"].includes(task.status)).length;
  return Math.round((doneCount / tasks.length) * 100);
}

function latestIso(values) {
  return [...values].sort((left, right) => right.localeCompare(left))[0];
}

function earliestIso(values) {
  return [...values].sort((left, right) => left.localeCompare(right))[0];
}

function recoverAgentSnapshot(agentRoot, alias) {
  const databasePath = path.join(agentRoot, "agent-data", "agent.sqlite");
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const db = new Database(databasePath, { readonly: true });
  const agentStateRows = db.prepare("select key, value from agent_state").all();
  const settingRows = db.prepare("select key, value from local_settings").all();
  const taskRows = db.prepare("select * from local_tasks order by last_event_at desc").all();
  const checklistRows = db.prepare("select * from local_checklist_items order by task_id asc, item_order asc").all();

  const agentState = new Map(agentStateRows.map((row) => [row.key, row.value]));
  const settings = new Map(settingRows.map((row) => [row.key, row.value]));
  const ownerUserId = agentState.get("owner_user_id");
  const agentId = agentState.get("agent_id");
  const agentToken = agentState.get("agent_token");

  if (!ownerUserId || !agentId || !agentToken) {
    db.close();
    return null;
  }

  const detectedAt = toIsoFromStat(databasePath);
  const releaseJson = settings.get("agent_update_release_json");
  let runtimeVersion = "0.1.0";
  if (releaseJson) {
    try {
      const parsed = JSON.parse(releaseJson);
      runtimeVersion = typeof parsed.current_version === "string"
        ? parsed.current_version
        : typeof parsed.version === "string"
          ? parsed.version
          : runtimeVersion;
    } catch {
      runtimeVersion = "0.1.0";
    }
  }

  const agent = {
    agentId,
    agentName: defaultAgentName(alias),
    machineName: defaultAgentName(alias),
    ownerUserId,
    ipAddress: "127.0.0.1",
    localUiPort: Number(settings.get("platform_local_ui_port") ?? 38500),
    status: "offline",
    runtimeVersion,
    osType: "windows",
    capabilities: ["local_storage", "task_cards", "notifications", "action_runner"],
    tokenHash: sha256(agentToken),
    tokenPreview: tokenPreview(agentToken),
    lastHeartbeatAt: detectedAt,
    createdAt: detectedAt,
    updatedAt: detectedAt,
  };

  const tasks = taskRows.map((row) => {
    let attachmentManifest = [];
    try {
      attachmentManifest = JSON.parse(row.attachment_manifest_json ?? "[]");
    } catch {
      attachmentManifest = [];
    }

    const status = normalizeStatus(row.status);
    const receivedAt = ["received", "accepted", "in_progress", "waiting_review", "done"].includes(status) ? row.created_at : undefined;
    const startedAt = ["accepted", "in_progress", "waiting_review", "done"].includes(status) ? row.updated_at : undefined;
    const completedAt = status === "done" ? row.updated_at : undefined;

    return {
      taskId: row.task_id,
      requestId: `req_recovered_${row.task_id}`,
      projectId: row.project_id,
      workflowId: row.workflow_id,
      stepId: row.step_id,
      taskTitle: row.task_title,
      taskType: row.task_type,
      senderUserId: ownerUserId,
      assigneeUserId: ownerUserId,
      assigneeAgentId: agentId,
      priority: "medium",
      status,
      progressPercent: Number(row.progress_percent ?? 0),
      summary: row.summary,
      constraints: [],
      deliverables: [],
      deadline: row.deadline,
      ...(receivedAt ? { receivedAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      lastEventAt: row.last_event_at ?? row.updated_at ?? row.created_at,
      riskLevel: "none",
      localTaskPath: row.local_task_path,
      outputPath: row.output_path,
      attachmentManifest,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      projectName: row.project_name ?? row.project_id,
    };
  });

  const checklist = checklistRows.map((row) => ({
    checklistItemId: row.checklist_item_id,
    taskId: row.task_id,
    itemOrder: Number(row.item_order ?? 0),
    itemTitle: row.item_title,
    itemDescription: row.item_description ?? undefined,
    status: row.status,
    completedAt: row.completed_at ?? undefined,
    completedBy: row.completed_by ?? undefined,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  db.close();
  return {
    agent,
    tasks,
    checklist,
    ownerDisplayName: settings.get("owner_display_name") ?? ownerUserId,
  };
}

function buildRecoveredProjects(tasks) {
  const grouped = new Map();
  for (const task of tasks) {
    const entry = grouped.get(task.projectId) ?? {
      projectName: task.projectName ?? task.projectId,
      tasks: [],
      participantUserIds: new Set(),
    };
    entry.tasks.push(task);
    entry.participantUserIds.add(task.assigneeUserId);
    grouped.set(task.projectId, entry);
  }

  return [...grouped.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([projectId, entry], index) => {
      const status = inferProjectStatus(entry.tasks);
      const createdAt = earliestIso(entry.tasks.map((task) => task.createdAt));
      const updatedAt = latestIso(entry.tasks.map((task) => task.updatedAt));
      const deadlines = entry.tasks.map((task) => task.deadline).filter((value) => typeof value === "string" && value.length > 0);

      return {
        projectId,
        projectCode: `RECOVERED-${String(index + 1).padStart(4, "0")}`,
        projectName: entry.projectName,
        description: "Recovered from local agent cache after platform restart.",
        department: "operations",
        ownerUserId: entry.tasks[0].senderUserId,
        participantUserIds: [...entry.participantUserIds],
        projectType: "operations",
        status,
        priority: "P1",
        startDate: createdAt,
        dueDate: deadlines.length > 0 ? latestIso(deadlines) : undefined,
        currentStage: projectStageLabel(status),
        completionRate: completionRate(entry.tasks),
        attachmentManifest: [],
        createdAt,
        updatedAt,
      };
    });
}

function buildRecoveredWorkflowTemplate(tasks) {
  const uniqueStepIds = [...new Set(tasks.map((task) => task.stepId).filter(Boolean))];
  if (uniqueStepIds.length === 0) {
    return [];
  }

  return [{
    workflow_template_id: "wf_tmpl_recovered_v1",
    workflow_name: "Recovered workflow",
    workflow_type: "recovered",
    template_version: 1,
    is_active: true,
    steps: uniqueStepIds.map((stepId, index) => ({
      step_id: stepId,
      step_code: stepId,
      step_name: stepId,
      step_order: index + 1,
      owner_role: "member",
      sla_minutes: 240,
    })),
  }];
}

function buildRecoveredWorkflows(tasks) {
  const grouped = new Map();
  for (const task of tasks) {
    const entry = grouped.get(task.workflowId) ?? [];
    entry.push(task);
    grouped.set(task.workflowId, entry);
  }

  return [...grouped.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([workflowId, workflowTasks]) => ({
      workflowId,
      projectId: workflowTasks[0].projectId,
      workflowTemplateId: "wf_tmpl_recovered_v1",
      templateVersion: 1,
      workflowName: "Recovered workflow",
      workflowType: "recovered",
      status: inferProjectStatus(workflowTasks) === "done" ? "done" : "in_progress",
      currentStepId: workflowTasks[0].stepId,
      createdAt: earliestIso(workflowTasks.map((task) => task.createdAt)),
      updatedAt: latestIso(workflowTasks.map((task) => task.updatedAt)),
    }));
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const repoRoot = path.resolve(args.get("repo-root") ?? process.cwd());
  const snapshotPath = path.join(repoRoot, "storage", "platform-state.json");
  const existingSnapshot = loadExistingSnapshot(snapshotPath);

  if (existingSnapshot) {
    const hasRecoveredDomainData = (existingSnapshot.projects?.length ?? 0) > 0 || (existingSnapshot.tasks?.length ?? 0) > 0;
    if (hasRecoveredDomainData) {
      console.log("[platform-state] snapshot already present, skipping recovery");
      return;
    }
  }

  const agentsRoot = path.join(repoRoot, "runtime", "agents");
  if (!fs.existsSync(agentsRoot)) {
    console.log("[platform-state] runtime agents root not found, skipping recovery");
    return;
  }

  const recoveredAgents = [];
  const recoveredTasks = [];
  const recoveredChecklist = [];

  for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const snapshot = recoverAgentSnapshot(path.join(agentsRoot, entry.name), entry.name);
    if (!snapshot) {
      continue;
    }
    recoveredAgents.push(snapshot.agent);
    recoveredTasks.push(...snapshot.tasks);
    recoveredChecklist.push(...snapshot.checklist);
  }

  const uniqueAgents = [...new Map(recoveredAgents.map((agent) => [agent.agentId, agent])).values()];
  const uniqueTasks = [...new Map(recoveredTasks.map((task) => [task.taskId, task])).values()];
  const uniqueChecklist = [...new Map(recoveredChecklist.map((item) => [item.checklistItemId, item])).values()];

  if (uniqueAgents.length === 0 && uniqueTasks.length === 0) {
    console.log("[platform-state] no local agent cache found, skipping recovery");
    return;
  }

  const projects = buildRecoveredProjects(uniqueTasks);
  const workflowTemplates = buildRecoveredWorkflowTemplate(uniqueTasks);
  const workflows = buildRecoveredWorkflows(uniqueTasks);
  const snapshot = {
    version: 1,
    users: existingSnapshot?.users ?? [],
    agents: uniqueAgents,
    projects,
    workflowTemplates,
    workflows,
    tasks: uniqueTasks.map(({ projectName, ...task }) => task),
    checklist: uniqueChecklist,
    events: existingSnapshot?.events ?? [],
    fileObjects: existingSnapshot?.fileObjects ?? [],
    heartbeats: existingSnapshot?.heartbeats ?? [],
    conversations: existingSnapshot?.conversations ?? [],
    conversationMessages: existingSnapshot?.conversationMessages ?? [],
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `[platform-state] recovered ${snapshot.agents.length} agents, ${snapshot.projects.length} projects, ${snapshot.tasks.length} tasks`,
  );
}

main();
