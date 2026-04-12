import { createHash, randomBytes } from "node:crypto";

import { hashSync } from "bcryptjs";

import { makeId, type TaskDeliveryRequest, type WorkflowTemplate } from "@flow-system/flow-protocol";

import type {
  AgentRecord,
  AppState,
  BootstrapTokenRecord,
  ChecklistRecord,
  ConversationMessageRecord,
  ConversationRecord,
  ProjectRecord,
  SessionRecord,
  TaskRecord,
  UserRecord,
  WorkflowRecord,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}

function createSeedUsers(): UserRecord[] {
  const createdAt = nowIso();
  return [
    {
      userId: "user_admin",
      username: "admin",
      passwordHash: hashSync("admin123", 10),
      role: "admin",
      displayName: "管理员",
      createdAt,
    },
    {
      userId: "user_owner",
      username: "owner",
      passwordHash: hashSync("owner123", 10),
      role: "owner",
      displayName: "项目负责人",
      createdAt,
    },
    {
      userId: "user_member",
      username: "member",
      passwordHash: hashSync("member123", 10),
      role: "member",
      displayName: "执行成员",
      createdAt,
    },
  ];
}

function createSeedProjects(): ProjectRecord[] {
  const createdAt = nowIso();
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      projectId: "proj_demo",
      projectCode: "FLOW-DEMO-1",
      projectName: "流程协作示例项目1",
      description: "用于展示企划修订任务在项目板中的流转。",
      department: "operations",
      ownerUserId: "user_owner",
      participantUserIds: ["user_owner", "user_member"],
      projectType: "delivery",
      status: "not_started",
      priority: "P1",
      startDate: createdAt,
      dueDate,
      currentStage: "未开始",
      completionRate: 42,
      attachmentManifest: [],
      createdAt,
      updatedAt: createdAt,
    },
    {
      projectId: "proj_demo_2",
      projectCode: "FLOW-DEMO-2",
      projectName: "流程协作示例项目2",
      description: "用于展示待审核和阻塞任务的项目视图。",
      department: "product",
      ownerUserId: "user_owner",
      participantUserIds: ["user_owner", "user_member"],
      projectType: "research",
      status: "in_progress",
      priority: "P2",
      startDate: createdAt,
      dueDate,
      currentStage: "进行中",
      completionRate: 58,
      attachmentManifest: [],
      createdAt,
      updatedAt: createdAt,
    },
    {
      projectId: "proj_demo_3",
      projectCode: "FLOW-DEMO-3",
      projectName: "流程协作示例项目3",
      description: "用于展示收包、接手和归档前任务的项目视图。",
      department: "design",
      ownerUserId: "user_owner",
      participantUserIds: ["user_owner", "user_member"],
      projectType: "marketing",
      status: "done",
      priority: "P1",
      startDate: createdAt,
      dueDate,
      currentStage: "已完成",
      completionRate: 73,
      attachmentManifest: [],
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function createSeedWorkflowTemplate(): WorkflowTemplate {
  return {
    workflow_template_id: "wf_tmpl_demo_v1",
    workflow_name: "企划修订流程",
    workflow_type: "planning_revision",
    template_version: 1,
    is_active: true,
    steps: [
      {
        step_id: "step_design",
        step_code: "design",
        step_name: "设计输出",
        step_order: 1,
        owner_role: "designer",
        sla_minutes: 240,
      },
      {
        step_id: "step_excel_revise",
        step_code: "excel_revise",
        step_name: "Excel 修订",
        step_order: 2,
        owner_role: "planner",
        sla_minutes: 180,
      },
      {
        step_id: "step_review",
        step_code: "review",
        step_name: "审核",
        step_order: 3,
        owner_role: "reviewer",
        sla_minutes: 120,
      },
    ],
  };
}

function createSeedWorkflows(template: WorkflowTemplate): WorkflowRecord[] {
  const createdAt = nowIso();
  return [
    {
      workflowId: "wf_demo",
      projectId: "proj_demo",
      workflowTemplateId: template.workflow_template_id,
      templateVersion: template.template_version,
      workflowName: template.workflow_name,
      workflowType: template.workflow_type,
      status: "in_progress",
      currentStepId: "step_excel_revise",
      createdAt,
      updatedAt: createdAt,
    },
    {
      workflowId: "wf_demo_2",
      projectId: "proj_demo_2",
      workflowTemplateId: template.workflow_template_id,
      templateVersion: template.template_version,
      workflowName: template.workflow_name,
      workflowType: template.workflow_type,
      status: "in_progress",
      currentStepId: "step_design",
      createdAt,
      updatedAt: createdAt,
    },
    {
      workflowId: "wf_demo_3",
      projectId: "proj_demo_3",
      workflowTemplateId: template.workflow_template_id,
      templateVersion: template.template_version,
      workflowName: template.workflow_name,
      workflowType: template.workflow_type,
      status: "waiting_review",
      currentStepId: "step_review",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

type SeedTaskSpec = {
  taskId: string;
  requestId: string;
  projectId: string;
  workflowId: string;
  stepId: string;
  taskTitle: string;
  summary: string;
  deliverables: string[];
  priority: TaskDeliveryRequest["priority"];
  status: TaskRecord["status"];
  completedChecklistCount: number;
  deadlineOffsetDays: number;
  assigneeAgentId: string;
};

function createSeedTaskSpecs(): SeedTaskSpec[] {
  return [
    {
      taskId: "task_demo_1_1",
      requestId: "req_seed_task_1_1",
      projectId: "proj_demo",
      workflowId: "wf_demo",
      stepId: "step_excel_revise",
      taskTitle: "面料信息补录",
      summary: "补全春夏鞋履企划表中的面料字段，并补充缺失说明。",
      deliverables: ["补全面料字段", "输出修订版表格"],
      priority: "high",
      status: "in_progress",
      completedChecklistCount: 1,
      deadlineOffsetDays: 2,
      assigneeAgentId: "agent_seed_member_1",
    },
    {
      taskId: "task_demo_1_2",
      requestId: "req_seed_task_1_2",
      projectId: "proj_demo",
      workflowId: "wf_demo",
      stepId: "step_excel_revise",
      taskTitle: "色卡编号复核",
      summary: "对第二个工作表中的色卡编号进行二次核验。",
      deliverables: ["完成色卡编号核验", "提交复核结论"],
      priority: "medium",
      status: "waiting_review",
      completedChecklistCount: 3,
      deadlineOffsetDays: 1,
      assigneeAgentId: "agent_seed_member_1",
    },
    {
      taskId: "task_demo_1_3",
      requestId: "req_seed_task_1_3",
      projectId: "proj_demo",
      workflowId: "wf_demo",
      stepId: "step_review",
      taskTitle: "最终版归档准备",
      summary: "整理最新附件和输出文件，为归档环节做准备。",
      deliverables: ["整理附件清单", "确认归档版本"],
      priority: "low",
      status: "delivered",
      completedChecklistCount: 0,
      deadlineOffsetDays: 4,
      assigneeAgentId: "agent_seed_member_1",
    },
    {
      taskId: "task_demo_2_1",
      requestId: "req_seed_task_2_1",
      projectId: "proj_demo_2",
      workflowId: "wf_demo_2",
      stepId: "step_design",
      taskTitle: "版式初稿整理",
      summary: "收拢设计初稿中的页面差异，并生成统一版式意见。",
      deliverables: ["完成版式差异清单", "输出统一建议"],
      priority: "high",
      status: "accepted",
      completedChecklistCount: 0,
      deadlineOffsetDays: 3,
      assigneeAgentId: "agent_seed_member_2",
    },
    {
      taskId: "task_demo_2_2",
      requestId: "req_seed_task_2_2",
      projectId: "proj_demo_2",
      workflowId: "wf_demo_2",
      stepId: "step_design",
      taskTitle: "设计稿差异确认",
      summary: "确认设计稿差异是否需要回退到上一版方案。",
      deliverables: ["确认差异原因", "给出回退建议"],
      priority: "critical",
      status: "in_progress",
      completedChecklistCount: 1,
      deadlineOffsetDays: 1,
      assigneeAgentId: "agent_seed_member_2",
    },
    {
      taskId: "task_demo_2_3",
      requestId: "req_seed_task_2_3",
      projectId: "proj_demo_2",
      workflowId: "wf_demo_2",
      stepId: "step_excel_revise",
      taskTitle: "字段映射校准",
      summary: "将设计稿字段重新映射到表格列，避免列定义不一致。",
      deliverables: ["校准字段映射", "补齐备注说明"],
      priority: "medium",
      status: "received",
      completedChecklistCount: 0,
      deadlineOffsetDays: 5,
      assigneeAgentId: "agent_seed_member_2",
    },
    {
      taskId: "task_demo_3_1",
      requestId: "req_seed_task_3_1",
      projectId: "proj_demo_3",
      workflowId: "wf_demo_3",
      stepId: "step_review",
      taskTitle: "审核意见汇总",
      summary: "汇总各角色的审核意见，并准备最终确认结论。",
      deliverables: ["整理审核意见", "输出审核结论"],
      priority: "high",
      status: "in_progress",
      completedChecklistCount: 2,
      deadlineOffsetDays: 2,
      assigneeAgentId: "agent_seed_member_3",
    },
    {
      taskId: "task_demo_3_2",
      requestId: "req_seed_task_3_2",
      projectId: "proj_demo_3",
      workflowId: "wf_demo_3",
      stepId: "step_review",
      taskTitle: "归档文件核对",
      summary: "检查归档包是否包含最新结果文件和附件校验记录。",
      deliverables: ["核对归档包", "补充缺失记录"],
      priority: "medium",
      status: "waiting_review",
      completedChecklistCount: 3,
      deadlineOffsetDays: 3,
      assigneeAgentId: "agent_seed_member_3",
    },
    {
      taskId: "task_demo_3_3",
      requestId: "req_seed_task_3_3",
      projectId: "proj_demo_3",
      workflowId: "wf_demo_3",
      stepId: "step_review",
      taskTitle: "归档说明补充",
      summary: "为项目归档补充最后一版说明文档和签收备注。",
      deliverables: ["补充说明文档", "确认签收备注"],
      priority: "low",
      status: "done",
      completedChecklistCount: 3,
      deadlineOffsetDays: 6,
      assigneeAgentId: "agent_seed_member_3",
    },
  ];
}

function buildSeedDelivery(spec: SeedTaskSpec, template: WorkflowTemplate): TaskDeliveryRequest {
  return {
    request_id: spec.requestId,
    project_id: spec.projectId,
    workflow_id: spec.workflowId,
    workflow_template_id: template.workflow_template_id,
    template_version: template.template_version,
    step_id: spec.stepId,
    task_title: spec.taskTitle,
    task_type: "excel_handoff",
    sender_user_id: "user_owner",
    target_user_id: "user_member",
    target_agent_id: spec.assigneeAgentId,
    priority: spec.priority,
    deadline: new Date(Date.now() + spec.deadlineOffsetDays * 24 * 60 * 60 * 1000).toISOString(),
    summary: spec.summary,
    constraints: [],
    deliverables: spec.deliverables,
    attachment_file_ids: [],
    plan_mode: "structured",
  };
}

function applyChecklistProgress(items: ChecklistRecord[], completedCount: number): ChecklistRecord[] {
  return items.map((item, index) =>
    index < completedCount
      ? {
          ...item,
          status: "done",
          completedAt: item.updatedAt,
          completedBy: "user_member",
        }
      : item,
  );
}

function createSeedTasks(template: WorkflowTemplate): Array<{ task: TaskRecord; checklist: ChecklistRecord[] }> {
  const specs = createSeedTaskSpecs();
  const now = Date.now();

  return specs.map((spec, index) => {
    const createdAt = new Date(now - (specs.length - index) * 60 * 60 * 1000).toISOString();
    const delivery = buildSeedDelivery(spec, template);
    const checklist = applyChecklistProgress(buildChecklistForTask(spec.taskId, delivery, template), spec.completedChecklistCount);
    const progressPercent = checklist.length === 0 ? 0 : Math.round((spec.completedChecklistCount / checklist.length) * 100);
    const startedAt = ["accepted", "in_progress", "waiting_review", "done"].includes(spec.status) ? createdAt : undefined;
    const receivedAt = ["received", "accepted", "in_progress", "waiting_review", "done"].includes(spec.status)
      ? createdAt
      : undefined;
    const completedAt = spec.status === "done" ? createdAt : undefined;

    const task: TaskRecord = {
      taskId: spec.taskId,
      requestId: spec.requestId,
      projectId: spec.projectId,
      workflowId: spec.workflowId,
      workflowTemplateId: template.workflow_template_id,
      templateVersion: template.template_version,
      stepId: spec.stepId,
      taskTitle: spec.taskTitle,
      taskType: "excel_handoff",
      senderUserId: "user_owner",
      assigneeUserId: "user_member",
      assigneeAgentId: spec.assigneeAgentId,
      priority: spec.priority,
      status: spec.status,
      progressPercent: spec.status === "done" ? 100 : progressPercent,
      summary: spec.summary,
      constraints: [],
      deliverables: spec.deliverables,
      deadline: delivery.deadline,
      ...(receivedAt ? { receivedAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      lastEventAt: createdAt,
      riskLevel: "none",
      attachmentManifest: [],
      createdAt,
      updatedAt: createdAt,
    };

    return { task, checklist };
  });
}

export function buildChecklistForTask(
  taskId: string,
  delivery: TaskDeliveryRequest,
  template?: WorkflowTemplate,
): ChecklistRecord[] {
  const createdAt = nowIso();
  const templateStep = template?.steps.find((step) => step.step_id === delivery.step_id);
  const templateItems = templateStep
    ? [
        {
          title: templateStep.step_name,
          description: `按“${templateStep.step_name}”步骤要求执行。`,
          source: "template" as const,
        },
      ]
    : [];
  const deliverableItems = delivery.deliverables.map((value) => ({
    title: value,
    description: `来自任务包的交付要求：${value}`,
    source: "task_type" as const,
  }));
  const defaults =
    templateItems.length + deliverableItems.length > 0
      ? []
      : [
          {
            title: "检查任务包",
            description: "查看任务元数据、附件和约束条件。",
            source: "default" as const,
          },
          {
            title: "产出结果文件",
            description: "创建或更新要求交付的结果文件。",
            source: "default" as const,
          },
          {
            title: "提交审核",
            description: "上传最终结果并将任务推进到待审核。",
            source: "default" as const,
          },
        ];
  const items = [...templateItems, ...deliverableItems, ...defaults];

  return items.map((item, index) => ({
    checklistItemId: `item_${taskId}_${index + 1}`,
    taskId,
    itemOrder: index,
    itemTitle: item.title,
    itemDescription: item.description,
    status: "pending",
    source: item.source,
    createdAt,
    updatedAt: createdAt,
  }));
}

export function createSession(userId: string, sessionTtlMs: number): SessionRecord {
  const createdAt = nowIso();
  return {
    sessionId: `sess_${createOpaqueToken()}`,
    userId,
    csrfToken: createOpaqueToken(),
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
    createdAt,
  };
}

export function createUserRecord(input: {
  username: string;
  displayName: string;
  role: UserRecord["role"];
  password: string;
  userId?: string;
  status?: UserRecord["status"];
}): UserRecord {
  const createdAt = nowIso();
  return {
    userId: input.userId ?? makeId("user"),
    username: input.username.trim().toLowerCase(),
    passwordHash: hashSync(input.password, 10),
    role: input.role,
    displayName: input.displayName.trim(),
    status: input.status ?? "active",
    createdAt,
    updatedAt: createdAt,
  };
}

export function storeUser(state: AppState, user: UserRecord): void {
  state.users.set(user.userId, user);
  state.usersByUsername.set(user.username, user);
}

export function createBootstrapToken(): BootstrapTokenRecord {
  const plaintext = "flow-bootstrap-local";
  const createdAt = nowIso();
  return {
    bootstrapTokenId: makeId("req"),
    tokenHash: hashToken(plaintext),
    tokenPlaintext: plaintext,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt,
  };
}

export function createBootstrapTokens(count: number): BootstrapTokenRecord[] {
  return Array.from({ length: count }, () => createBootstrapToken());
}

export function createAgentToken(): { token: string; tokenHash: string; tokenPreview: string } {
  const token = createOpaqueToken();
  return {
    token,
    tokenHash: hashToken(token),
    tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
  };
}

export function createAppState(options?: { seedMode?: "empty" | "demo" }): AppState {
  const seedMode = options?.seedMode ?? "empty";
  const state: AppState = {
    users: new Map(),
    usersByUsername: new Map(),
    sessions: new Map(),
    bootstrapTokens: new Map(),
    agents: new Map(),
    projects: new Map(),
    workflowTemplates: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    checklist: new Map(),
    taskChecklistIndex: new Map(),
    events: new Map(),
    taskEventIndex: new Map(),
    fileObjects: new Map(),
    heartbeats: new Map(),
    conversations: new Map(),
    conversationMessages: new Map(),
    conversationMessageIndex: new Map(),
    openClawTaskProgress: new Map(),
    risks: new Map(),
    idempotency: new Map(),
    agentReleases: new Map(),
  };

  if (seedMode === "demo") {
    for (const user of createSeedUsers()) {
      storeUser(state, user);
    }

    for (const project of createSeedProjects()) {
      state.projects.set(project.projectId, project);
    }

    const template = createSeedWorkflowTemplate();
    state.workflowTemplates.set(template.workflow_template_id, template);

    for (const workflow of createSeedWorkflows(template)) {
      state.workflows.set(workflow.workflowId, workflow);
    }

    for (const entry of createSeedTasks(template)) {
      storeTask(state, entry.task);
      appendTaskChecklist(state, entry.task.taskId, entry.checklist);
    }
  }

  for (const bootstrapToken of createBootstrapTokens(12)) {
    state.bootstrapTokens.set(bootstrapToken.bootstrapTokenId, bootstrapToken);
  }

  return state;
}

export function appendTaskChecklist(state: AppState, taskId: string, items: ChecklistRecord[]): void {
  state.taskChecklistIndex.set(taskId, items.map((item) => item.checklistItemId));
  for (const item of items) {
    state.checklist.set(item.checklistItemId, item);
  }
}

export function listTaskChecklist(state: AppState, taskId: string): ChecklistRecord[] {
  const ids = state.taskChecklistIndex.get(taskId) ?? [];
  return ids.map((id) => state.checklist.get(id)).filter((value): value is ChecklistRecord => Boolean(value));
}

export function storeTask(state: AppState, task: TaskRecord): void {
  state.tasks.set(task.taskId, task);
}

export function taskEvents(state: AppState, taskId: string): string[] {
  return state.taskEventIndex.get(taskId) ?? [];
}

export function addTaskEventIndex(state: AppState, taskId: string, eventId: string): void {
  const ids = state.taskEventIndex.get(taskId) ?? [];
  ids.push(eventId);
  state.taskEventIndex.set(taskId, ids);
}

export function ensureConversation(state: AppState, ownerUserId: string): ConversationRecord {
  const conversationId = `conv_${ownerUserId}`;
  const existing = state.conversations.get(conversationId);
  if (existing) {
    return existing;
  }
  const createdAt = nowIso();
  const record: ConversationRecord = {
    conversationId,
    ownerUserId,
    createdAt,
    updatedAt: createdAt,
  };
  state.conversations.set(conversationId, record);
  return record;
}

export function appendConversationMessage(
  state: AppState,
  input: Omit<ConversationMessageRecord, "messageId" | "createdAt" | "updatedAt">,
): ConversationMessageRecord {
  const createdAt = nowIso();
  const message: ConversationMessageRecord = {
    ...input,
    messageId: makeId("evt"),
    createdAt,
    updatedAt: createdAt,
  };
  state.conversationMessages.set(message.messageId, message);
  const ids = state.conversationMessageIndex.get(message.conversationId) ?? [];
  ids.push(message.messageId);
  state.conversationMessageIndex.set(message.conversationId, ids);

  const conversation = ensureConversation(state, message.ownerUserId);
  conversation.updatedAt = createdAt;
  state.conversations.set(conversation.conversationId, conversation);

  return message;
}

export function listConversationMessages(state: AppState, conversationId: string): ConversationMessageRecord[] {
  const ids = state.conversationMessageIndex.get(conversationId) ?? [];
  return ids
    .map((id) => state.conversationMessages.get(id))
    .filter((value): value is ConversationMessageRecord => Boolean(value))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function preferredAgentForUser(state: AppState, ownerUserId: string): AgentRecord | undefined {
  const agents = [...state.agents.values()].filter((agent) => agent.ownerUserId === ownerUserId);
  if (agents.length === 0) {
    return undefined;
  }
  return agents.sort((left, right) => {
    const statusRank = (status: AgentRecord["status"]): number => {
      if (status === "online") {
        return 0;
      }
      if (status === "degraded") {
        return 1;
      }
      return 2;
    };

    const rankDelta = statusRank(left.status) - statusRank(right.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const leftAt = left.lastHeartbeatAt ?? left.updatedAt;
    const rightAt = right.lastHeartbeatAt ?? right.updatedAt;
    return rightAt.localeCompare(leftAt);
  })[0];
}

export function listTaskResponsibles(state: AppState): Array<{ user: UserRecord; agent: AgentRecord }> {
  return [...state.users.values()]
    .filter((user) => !user.deletedAt && (user.status ?? "active") === "active")
    .map((user) => {
      const agent = preferredAgentForUser(state, user.userId);
      if (!agent) {
        return null;
      }
      return { user, agent };
    })
    .filter((value): value is { user: UserRecord; agent: AgentRecord } => Boolean(value))
    .sort((left, right) => left.user.displayName.localeCompare(right.user.displayName, "zh-CN"));
}

export function findActiveWorkflowTemplate(state: AppState, workflowTemplateId?: string): WorkflowTemplate | undefined {
  if (workflowTemplateId) {
    return state.workflowTemplates.get(workflowTemplateId);
  }

  return [...state.workflowTemplates.values()].find((template) => template.is_active);
}
