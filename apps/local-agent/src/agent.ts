import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { isOpenClawReady, openClawSelectionResultSchema, openClawStatusResponseSchema, type OpenClawStatus } from "@flow-system/local-openclaw-contracts";
import {
  buildConversationMessageViews,
  conversationMessageSchema,
  conversationThreadSchema,
  getConversationConnectionLabel,
  overlayBootstrapSchema,
  overlayConversationsResponseSchema,
  overlayHealthSchema,
  overlayOpenTaskResultSchema,
  overlayTaskListResponseSchema,
} from "@flow-system/local-overlay-contracts";
import { z } from "zod";

import { AgentDatabase, type LocalConversationMessageRow, type LocalTaskRow, type OutboxRow } from "./db.js";
import type { LocalAgentConfig } from "./config.js";
import { AgentLogger } from "./logger.js";
import { extractOpenClawReplyText } from "./openclaw-command-output.js";
import { executeConversationRouterAction, conversationRoutingProjectName } from "./openclaw-conversation-router/executor.js";
import { buildConversationRouterPrompt, buildConversationRouterRepairPrompt } from "./openclaw-conversation-router/prompt.js";
import { conversationRouterTargetSchema, parseConversationRouterAction, type ConversationRouterTarget } from "./openclaw-conversation-router/protocol.js";
import { buildFlowSystemOperatorPrompt } from "./openclaw-flow-system-operator/prompt.js";
import {
  flowSystemOperatorActionSchema,
  flowSystemOperatorScriptResultSchema,
  parseFlowSystemOperatorAction,
  type FlowSystemOperatorAction,
  type FlowSystemOperatorScriptResult,
} from "./openclaw-flow-system-operator/protocol.js";
import { execBufferedCommand } from "./command.js";
import { OpenClawConnectorService } from "./services/openclaw-connector.js";
import { PlatformClient, PlatformRequestError } from "./services/platform-client.js";

const remoteChecklistSchema = z.object({
  checklistItemId: z.string().optional(),
  checklist_item_id: z.string().optional(),
  itemOrder: z.number().optional(),
  item_order: z.number().optional(),
  itemTitle: z.string().optional(),
  item_title: z.string().optional(),
  itemDescription: z.string().optional().nullable(),
  item_description: z.string().optional().nullable(),
  status: z.string(),
  completedAt: z.string().optional().nullable(),
  completed_at: z.string().optional().nullable(),
  completedBy: z.string().optional().nullable(),
  completed_by: z.string().optional().nullable(),
  source: z.string(),
  createdAt: z.string().optional(),
  created_at: z.string().optional(),
  updatedAt: z.string().optional(),
  updated_at: z.string().optional(),
});

const remoteTaskSchema = z.object({
  task_id: z.string(),
  request_id: z.string(),
  project_id: z.string(),
  project_name: z.string().optional(),
  workflow_id: z.string(),
  step_id: z.string(),
  task_title: z.string(),
  task_type: z.string(),
  assignee_user_id: z.string(),
  assignee_display_name: z.string().optional(),
  assignee_agent_id: z.string(),
  status: z.string(),
  progress_percent: z.number().optional().default(0),
  summary: z.string(),
  deadline: z.string(),
  last_event_at: z.string().optional(),
  attachment_manifest: z.array(
    z.object({
      file_id: z.string(),
      file_name: z.string(),
      content_type: z.string(),
      sha256: z.string(),
      size_bytes: z.number(),
    }),
  ),
  checklist: z.array(remoteChecklistSchema).default([]),
});

const remoteConversationMessageSchema = conversationMessageSchema;
type RemoteConversationMessage = z.infer<typeof remoteConversationMessageSchema>;

const remoteAgentReleaseSchema = z.object({
  current_version: z.string(),
  update_available: z.boolean(),
  release: z.object({
    version: z.string(),
    notes: z.string(),
    package_rel_path: z.string(),
    package_sha256: z.string(),
    package_size_bytes: z.number(),
    minimum_runtime_version: z.string().optional(),
    published_by_user_id: z.string(),
    published_at: z.string(),
    package_url: z.string(),
  }).nullable(),
});

const execFileAsync = promisify(execFile);
const overlayActiveTaskStatuses = new Set(["new", "delivered", "received", "accepted", "in_progress", "waiting_review"]);

type OverlayUiState = {
  window_position?: { x: number; y: number };
  first_run_completed?: boolean;
  last_tab?: "conversation" | "tasks";
  muted?: boolean;
  last_platform_url?: string | null;
  last_read_conversation_message_at?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function nowIsoWithLocalOffset(): string {
  return formatIsoWithLocalOffset(new Date());
}

function formatIsoWithLocalOffset(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, "0");
  const offsetRemainderMinutes = String(absoluteOffsetMinutes % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function sha256File(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  let sizeBytes = 0;

  return await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.length;
      hash.update(buffer);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve({
        sha256: hash.digest("hex"),
        sizeBytes,
      });
    });
  });
}

function ensureDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

function addMinutes(dateIso: string, minutes: number): string {
  return new Date(new Date(dateIso).getTime() + minutes * 60000).toISOString();
}

function openPath(targetPath: string): void {
  if (process.platform === "win32") {
    const child = spawn("explorer.exe", [targetPath], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [targetPath], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

function sanitizeSessionId(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeConversationIntentText(input: string): string {
  return input.replace(/\s+/g, "").toLowerCase();
}

function parseConversationDeadlineHint(messageBody: string, now = new Date()): string | null {
  const trimmed = messageBody.trim();
  const isoMatch = trimmed.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/);
  if (isoMatch) {
    const normalized = isoMatch[0].replace(/Z$/, "+00:00");
    return normalized.length === 25 ? normalized : normalized.replace(/([+-]\d{2}:\d{2})$/, ":00$1");
  }

  const normalized = normalizeConversationIntentText(trimmed);
  let dayOffset = 0;
  if (/(后天|thedayaftertomorrow)/i.test(normalized)) {
    dayOffset = 2;
  } else if (/(明天|tomorrow)/i.test(normalized)) {
    dayOffset = 1;
  }

  const timeMatch = normalized.match(/(上午|早上|中午|下午|晚上|今晚|am|pm)?(\d{1,2})(?:点|:|：)(半|(\d{1,2})分?)?/i);
  if (!timeMatch) {
    return null;
  }

  let hour = Number.parseInt(timeMatch[2] ?? "", 10);
  if (!Number.isFinite(hour)) {
    return null;
  }
  const meridiem = timeMatch[1] ?? "";
  const minuteToken = timeMatch[3] ?? "";
  const minute = minuteToken === "半"
    ? 30
    : minuteToken
      ? Number.parseInt(minuteToken, 10)
      : 0;

  if (/(下午|晚上|今晚|pm)/i.test(meridiem) && hour < 12) {
    hour += 12;
  } else if (/(上午|早上|am)/i.test(meridiem) && hour === 12) {
    hour = 0;
  }

  const deadline = new Date(now);
  deadline.setMilliseconds(0);
  deadline.setSeconds(0);
  deadline.setMinutes(Number.isFinite(minute) ? minute : 0);
  deadline.setHours(hour);
  deadline.setDate(deadline.getDate() + dayOffset);
  return formatIsoWithLocalOffset(deadline);
}

function extractConversationProjectName(messageBody: string): string | null {
  const bracketMatch = messageBody.match(/项目(?:是|为)?[【\[]([^】\]]+)[】\]]/i);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const locationMatch = messageBody.match(/在\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*里(?:新建|创建|新增|建立|添加|做|处理|安排)?/i);
  if (locationMatch?.[1]) {
    return locationMatch[1].trim();
  }

  const inlineMatch = messageBody.match(/项目(?:是|为)?[:：]?\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)(?=[，。,；; ]|让|负责人|截止|$)/i);
  return inlineMatch?.[1]?.trim() || null;
}

function extractConversationAssigneeName(messageBody: string): string | null {
  const delegatedMatch = messageBody.match(/(?:让|叫|请|安排|交给|发给)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=\s*(?:做|负责|处理|完成|整理|制作|写|跟进|来|看|查))/i);
  if (delegatedMatch?.[1]) {
    return delegatedMatch[1].trim();
  }

  const ownerMatch = messageBody.match(/(?:负责人|执行人|指派给|分配给)(?:是|改成|为|给)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})/i);
  return ownerMatch?.[1]?.trim() || null;
}

function extractConversationTaskTitle(messageBody: string): string | null {
  const delegatedMatch = messageBody.match(/(?:让|叫|请|安排|交给|发给)\s*[A-Za-z0-9_\-\u4e00-\u9fa5]{1,24}\s*(?:做|负责|处理|完成|整理|制作|写|跟进)\s*(.+?)(?=(?:并在|并于|并请|，请|，并|,|，|。|截止|今天|明天|后天|本周|下周|$))/i);
  const verbMatch = messageBody.match(/(?:做|完成|整理|制作|写|跟进)\s*(?:一份|一个|一条|一项|一版|一套)?\s*(.+?)(?=(?:执行人|负责人|并在|并于|截止|今天|明天|后天|本周|下周|,|，|。|$))/i);
  const taskTitleSource = delegatedMatch?.[1]
    ?? verbMatch?.[1]
    ?? messageBody.match(/任务(?:名|名称)?(?:是|叫|为)?[:：]?\s*(.+?)(?=(?:，|,|。|截止|今天|明天|后天|$))/i)?.[1]
    ?? "";
  const cleaned = taskTitleSource
    .trim()
    .replace(/^(一份|一个|一条|一项|一版|一套)/, "")
    .replace(/[。！!？?]+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
}

type ConversationForwardTargetMatch = {
  target: ConversationRouterTarget;
  matchedName: string;
  index: number;
};

type ConversationForwardIntent =
  | { kind: "none" }
  | { kind: "clarify_target"; replyText: string }
  | { kind: "forward"; match: ConversationForwardTargetMatch };

type ConversationTargetIdentityIntent =
  | { kind: "none" }
  | { kind: "clarify_target"; replyText: string }
  | { kind: "identity"; match: ConversationForwardTargetMatch };

type OpenClawReplyInvocationOptions = {
  sessionNamespace?: "router" | "conversation" | "operator";
};

const pendingFlowSystemOperatorFieldNames = [
  "project_name",
  "assignee_name",
  "task_name",
  "task_title",
  "task_deadline",
  "project_owner_name",
  "due_date",
] as const;

type PendingFlowSystemOperatorField = typeof pendingFlowSystemOperatorFieldNames[number];

const pendingFlowSystemOperatorContextSchema = z.object({
  conversation_id: z.string().trim().min(1),
  action: flowSystemOperatorActionSchema,
  awaiting_field: z.enum(pendingFlowSystemOperatorFieldNames).nullable(),
  created_at: z.string().trim().min(1),
  updated_at: z.string().trim().min(1),
});

type PendingFlowSystemOperatorContext = z.infer<typeof pendingFlowSystemOperatorContextSchema>;

export class LocalAgentRuntime {
  private readonly client: PlatformClient;
  private readonly openClawConnector: OpenClawConnectorService;
  private readonly intervals: NodeJS.Timeout[] = [];
  private intakeRunning = false;
  private conversationSyncRunning = false;
  private updateCheckRunning = false;
  private updateApplyRunning = false;
  private agentId: string | undefined;
  private agentToken: string | undefined;
  private reauthPromise: Promise<void> | null = null;

  constructor(
    readonly config: LocalAgentConfig,
    readonly db: AgentDatabase,
    readonly logger: AgentLogger,
  ) {
    this.openClawConnector = new OpenClawConnectorService(config, logger);
    this.client = new PlatformClient(config.platformApiBaseUrl, {
      agentId: config.agentId,
      agentToken: config.agentToken,
    });
    this.agentId = config.agentId;
    this.agentToken = config.agentToken;
  }

  async start(): Promise<void> {
    this.prepareDirectories();
    await this.openClawConnector.initialize();
    this.loadCredentialsFromDatabase();
    await this.ensureAgentOwnerAlignment();
    await this.ensureRegistered();
    await this.syncRemoteAgentConfig();
    await this.heartbeat();
    await this.flushOutbox();
    await this.runIntakeCycle();
    await this.runConversationSync();
    await this.refreshUpdateStatus();
    await this.cleanupRecovery();
    await this.backupDatabase();

    this.intervals.push(setInterval(() => void this.heartbeat(), this.config.pollIntervalSeconds * 1000));
    this.intervals.push(setInterval(() => void this.runIntakeCycle(), this.config.pollIntervalSeconds * 1000));
    this.intervals.push(setInterval(() => void this.runConversationSync(), this.config.pollIntervalSeconds * 1000));
    this.intervals.push(setInterval(() => void this.flushOutbox(), this.config.pollIntervalSeconds * 1000));
    this.intervals.push(setInterval(() => void this.refreshUpdateStatus(), this.config.updateCheckIntervalSeconds * 1000));
    this.intervals.push(setInterval(() => void this.cleanupRecovery(), 24 * 60 * 60 * 1000));
    this.intervals.push(setInterval(() => void this.backupDatabase(), 24 * 60 * 60 * 1000));
    for (const interval of this.intervals) {
      interval.unref();
    }
  }

  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
  }

  getAllowedWebOrigins(): string[] {
    return [...new Set(
      [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        this.config.platformWebOrigin,
        this.readLocalSetting("platform_web_origin"),
      ]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .map((value) => normalizeOrigin(value)),
    )];
  }

  getOpenClawStatus(): Record<string, unknown> {
    return openClawStatusResponseSchema.parse({
      status: this.openClawConnector.getStatus(),
    });
  }

  async selectOpenClawExecutable(selectedPath?: string): Promise<Record<string, unknown>> {
    return openClawSelectionResultSchema.parse(await this.openClawConnector.selectExecutable(selectedPath));
  }

  async selectOpenClawRoot(selectedPath?: string): Promise<Record<string, unknown>> {
    return openClawSelectionResultSchema.parse(await this.openClawConnector.selectRoot(selectedPath));
  }

  async revalidateOpenClaw(): Promise<Record<string, unknown>> {
    return openClawStatusResponseSchema.parse({
      status: await this.openClawConnector.revalidate(),
    });
  }

  resetOpenClaw(): Record<string, unknown> {
    return openClawStatusResponseSchema.parse({
      status: this.openClawConnector.reset(),
    });
  }

  async getOverlayBootstrap(): Promise<Record<string, unknown>> {
    const unread = this.getOverlayUnreadState();
    const currentTasks = await this.listOverlayCurrentTasks();
    const openClawStatus = this.openClawConnector.getStatus();
    const openClawConnected = isOpenClawReady(openClawStatus);
    return overlayBootstrapSchema.parse({
      owner_user_id: this.config.ownerUserId,
      owner_display_name: this.getOwnerDisplayName(),
      agent_id: this.agentId ?? null,
      local_ui_port: this.config.uiPort,
      platform_web_origin: this.getPlatformWebOrigin(),
      openclaw_connected: openClawConnected,
      openclaw_status: openClawStatus,
      unread,
      current_task_count: currentTasks.length,
      orb_state: this.computeOverlayOrbState(unread.count),
      last_platform_url: this.readOverlayUiState().last_platform_url ?? null,
    });
  }

  getOverlayHealth(): Record<string, unknown> {
    const unread = this.getOverlayUnreadState();
    const openClawStatus = this.openClawConnector.getStatus();
    return overlayHealthSchema.parse({
      ok: true,
      openclaw_connected: isOpenClawReady(openClawStatus),
      openclaw_status: openClawStatus,
      orb_state: this.computeOverlayOrbState(unread.count),
    });
  }

  private buildOverlayConversationsResponse(
    messages: Array<z.infer<typeof remoteConversationMessageSchema>>,
    openClawStatus: OpenClawStatus,
  ): Record<string, unknown> {
    const ownerDisplayName = this.getOwnerDisplayName();
    const openClawConnected = isOpenClawReady(openClawStatus);
    return overlayConversationsResponseSchema.parse({
      owner_display_name: ownerDisplayName,
      openclaw_connected: openClawConnected,
      openclaw_status: openClawStatus,
      connection_label: getConversationConnectionLabel(openClawConnected),
      unread: this.getOverlayUnreadState(),
      messages,
      message_views: buildConversationMessageViews(messages, ownerDisplayName),
    });
  }

  listOverlayConversations(): Record<string, unknown> {
    const rows = this.db.connection.prepare(`
      select m.*
      from local_conversation_messages m
      inner join local_conversations c on c.conversation_id = m.conversation_id
      where c.owner_user_id = ?
      order by m.created_at asc
      limit 200
    `).all(this.config.ownerUserId) as LocalConversationMessageRow[];

    return this.buildOverlayConversationsResponse(
      rows.map((row) => {
        const parsedSyncStatus = conversationMessageSchema.shape.sync_status.safeParse(row.sync_status);
        return {
          message_id: row.message_id,
          conversation_id: row.conversation_id,
          owner_user_id: this.config.ownerUserId,
          message_type: row.message_type,
          author_kind: row.author_kind === "openclaw" ? "openclaw" : "user",
          body: row.body,
          source_user_id: row.source_user_id,
          source_display_name: row.source_display_name,
          target_user_id: row.target_user_id,
          target_agent_id: row.target_agent_id,
          sync_status: parsedSyncStatus.success ? parsedSyncStatus.data : "none",
          sync_detail: row.sync_detail,
          delivered_to_agent_at: row.delivered_to_agent_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      }),
      this.openClawConnector.getStatus(),
    );
  }

  async getOverlayConversations(): Promise<Record<string, unknown>> {
    try {
      const thread = await this.syncConversationThread();
      return this.buildOverlayConversationsResponse(thread.messages, this.openClawConnector.getStatus());
    } catch (error) {
      this.logger.debug("Overlay conversation refresh fell back to local cache", {
        error: String(error),
      });
    }
    return this.listOverlayConversations();
  }

  async sendOverlayConversationMessage(body: string): Promise<Record<string, unknown>> {
    const openClawStatus = this.openClawConnector.getStatus();
    if (!isOpenClawReady(openClawStatus)) {
      throw new Error(openClawStatus.status_label);
    }
    if (!this.agentId) {
      throw new Error("Current OpenClaw agent is not available");
    }
    const agentId = this.agentId;

    const payload = await this.withAgentAuthRetry(async () => this.client.sendSelfConversationMessage(agentId, {
      request_id: `req_overlay_conversation_${Date.now()}`,
      body,
    })) as { message?: Record<string, unknown>; messages?: Record<string, unknown>[] };

    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      for (const entry of payload.messages) {
        this.persistConversationMessage(remoteConversationMessageSchema.parse(entry));
      }
    } else if (payload.message) {
      this.persistConversationMessage(remoteConversationMessageSchema.parse(payload.message));
    }

    setImmediate(() => {
      void this.runConversationSync();
    });

    return this.getOverlayConversations();
  }

  async listOverlayCurrentTasks(): Promise<Array<Record<string, unknown>>> {
    const remoteTasks = await this.fetchOwnerOverlayCurrentTasks();
    if (remoteTasks.length > 0 || this.agentId) {
      return remoteTasks;
    }
    return this.listOverlayCurrentTasksFromLocal();
  }

  private async fetchOwnerOverlayCurrentTasks(): Promise<Array<Record<string, unknown>>> {
    if (!this.agentId) {
      return [];
    }

    try {
      const payload = await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          return { tasks: [] };
        }
        return this.client.getOwnerCurrentTasks(this.agentId);
      });
      const ownerDisplayName = this.getOwnerDisplayName();

      return overlayTaskListResponseSchema.parse({
        tasks: (payload.tasks ?? []).map((entry) => {
          const task = remoteTaskSchema.parse(entry);
          const localTask = this.findTask(task.task_id);

          return {
            task_id: task.task_id,
            project_id: task.project_id,
            project_name: task.project_name ?? task.project_id,
            task_title: task.task_title,
            user_display_name: task.assignee_display_name ?? ownerDisplayName,
            status: task.status,
            deadline: task.deadline,
            last_event_at: localTask?.last_event_at ?? task.last_event_at ?? nowIso(),
            local_task_path: localTask?.local_task_path ?? "",
          };
        }),
      }).tasks;
    } catch (error) {
      this.logger.warn("Overlay current task sync failed, falling back to local cache", {
        error: String(error),
      });
      return this.listOverlayCurrentTasksFromLocal();
    }
  }

  private listOverlayCurrentTasksFromLocal(): Array<Record<string, unknown>> {
    const rows = this.db.connection.prepare(`
      select *
      from local_tasks
      where status in ('new', 'delivered', 'received', 'accepted', 'in_progress', 'waiting_review')
      order by updated_at desc
    `).all() as LocalTaskRow[];
    const ownerDisplayName = this.getOwnerDisplayName();

    return overlayTaskListResponseSchema.parse({
      tasks: rows.map((row) => ({
        task_id: row.task_id,
        project_id: row.project_id,
        project_name: row.project_name ?? row.project_id,
        task_title: row.task_title,
        user_display_name: row.assignee_display_name ?? ownerDisplayName,
        status: row.status,
        deadline: row.deadline,
        last_event_at: row.last_event_at,
        local_task_path: row.local_task_path,
      })),
    }).tasks;
  }

  async openOverlayTask(taskId: string): Promise<Record<string, unknown>> {
    const task = this.findTask(taskId);
    const platformUrl = `${this.getPlatformWebOrigin()}/tasks/${taskId}`;
    const platformReachable = await this.isPlatformWebReachable();

    if (platformReachable) {
      openPath(platformUrl);
      return overlayOpenTaskResultSchema.parse({
        task_id: taskId,
        opened_target: "platform",
        destination: platformUrl,
        platform_reachable: true,
      });
    }

    if (!task) {
      throw new Error("???????????????????????");
    }

    openPath(task.local_task_path);
    return overlayOpenTaskResultSchema.parse({
      task_id: taskId,
      opened_target: "local",
      destination: task.local_task_path,
      platform_reachable: false,
    });
  }

  listTasks(): Array<Record<string, unknown>> {
    const rows = this.db.connection.prepare("select * from local_tasks order by updated_at desc").all() as LocalTaskRow[];
    return rows.map((row) => ({
      ...row,
      checklist: this.getChecklist(row.task_id),
    }));
  }

  getTask(taskId: string): Record<string, unknown> | null {
    const row = this.findTask(taskId);
    if (!row) {
      return null;
    }
    return {
      ...row,
      checklist: this.getChecklist(taskId),
    };
  }

  async acceptTask(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    this.updateTaskStatus(taskId, "accepted");
    await this.enqueueJson(`/api/v1/tasks/${taskId}/status`, {
      request_id: `req_${randomUUID()}`,
      task_id: taskId,
      status: "accepted",
      actor_role: "assignee",
      occurred_at: nowIso(),
    });
    this.logger.info("Task accepted", { taskId });
  }

  async startTask(taskId: string): Promise<void> {
    this.requireTask(taskId);
    this.updateTaskStatus(taskId, "in_progress");
    await this.enqueueJson(`/api/v1/tasks/${taskId}/status`, {
      request_id: `req_${randomUUID()}`,
      task_id: taskId,
      status: "in_progress",
      actor_role: "assignee",
      occurred_at: nowIso(),
    });
    this.logger.info("Task started", { taskId });
  }

  async updateChecklist(taskId: string, itemId: string, status: "pending" | "in_progress" | "done"): Promise<void> {
    const task = this.requireTask(taskId);
    this.db.connection.prepare(`
      update local_checklist_items
      set status = ?, completed_at = ?, updated_at = ?, completed_by = ?
      where checklist_item_id = ?
    `).run(status, status === "done" ? nowIso() : null, nowIso(), this.config.ownerUserId, itemId);
    await this.enqueueJson(`/api/v1/tasks/${taskId}/checklist/${itemId}`, {
      request_id: `req_${randomUUID()}`,
      status,
      completed_by: this.config.ownerUserId,
      occurred_at: nowIso(),
    });
    if (status === "done") {
      const firstItem = this.db.connection.prepare(`
        select checklist_item_id from local_checklist_items
        where task_id = ?
        order by item_order asc
        limit 1
      `).get(taskId) as { checklist_item_id: string } | undefined;
      if (firstItem?.checklist_item_id === itemId && ["received", "accepted"].includes(task.status)) {
        await this.startTask(taskId);
      }
    }
  }

  async triggerAction(taskId: string, actionType: "open_task_folder" | "open_attachment" | "open_output_folder", fileName?: string, confirmStart = false): Promise<void> {
    const task = this.requireTask(taskId);
    if (actionType === "open_task_folder") {
      openPath(task.local_task_path);
    } else if (actionType === "open_output_folder") {
      openPath(task.output_path);
    } else if (actionType === "open_attachment" && fileName) {
      openPath(path.join(task.local_task_path, "input", fileName));
    }
    await this.enqueueJson(`/api/v1/tasks/${taskId}/actions`, {
      request_id: `req_${randomUUID()}`,
      action_type: actionType,
      confirm_start: confirmStart,
      occurred_at: nowIso(),
    });
    if (confirmStart && ["received", "accepted"].includes(task.status)) {
      await this.startTask(taskId);
    }
  }

  async submitResults(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    const outputDir = task.output_path;
    const files = fs.readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    for (const entry of files) {
      const fullPath = path.join(outputDir, entry.name);
      const stats = fs.statSync(fullPath);
      const digest = await sha256File(fullPath);
      const contentType = entry.name.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/octet-stream";
      await this.withAgentAuthRetry(async () => this.client.uploadFile(taskId, fullPath, {
        purpose: "result",
        sha256Declared: digest.sha256,
        sizeBytes: stats.size,
        contentType,
        originalName: entry.name,
      }));
    }
    this.updateTaskStatus(taskId, "waiting_review");
    await this.enqueueJson(`/api/v1/tasks/${taskId}/status`, {
      request_id: `req_${randomUUID()}`,
      task_id: taskId,
      status: "waiting_review",
      actor_role: "assignee",
      occurred_at: nowIso(),
    });
  }

  getUpdateStatus(): Record<string, unknown> {
    const releaseJson = this.readLocalSetting("agent_update_release_json");
    const applyStatus = this.readLocalSetting("agent_update_apply_status") ?? "idle";
    const applyMessage = this.readLocalSetting("agent_update_apply_message");
    const appliedVersion = this.readLocalSetting("agent_update_applied_version");
    const release = releaseJson ? JSON.parse(releaseJson) as Record<string, unknown> : null;
    const updateAvailable = Boolean(release && release.update_available);

    return {
      current_version: this.config.runtimeVersion,
      update_available: updateAvailable,
      latest_version: release && typeof release.version === "string" ? release.version : null,
      release,
      apply_status: applyStatus,
      apply_message: applyMessage ?? null,
      applied_version: appliedVersion ?? null,
      restart_configured: Boolean(this.config.restartCommand),
    };
  }

  async syncUpdateStatus(): Promise<Record<string, unknown>> {
    await this.refreshUpdateStatus();
    return this.getUpdateStatus();
  }

  async applyAvailableUpdate(): Promise<Record<string, unknown>> {
    if (this.updateApplyRunning) {
      throw new Error("Agent update is already running");
    }
    if (!this.agentId) {
      throw new Error("Agent is not registered");
    }

    const status = this.getUpdateStatus();
    const release = status.release as Record<string, unknown> | null;
    if (!release || status.update_available !== true) {
      throw new Error("No agent update is currently available");
    }
    if (!this.config.restartCommand) {
      throw new Error("Agent restart command is not configured");
    }

    this.updateApplyRunning = true;
    this.writeLocalSetting("agent_update_apply_status", "downloading");
    this.writeLocalSetting("agent_update_apply_message", "???????");

    try {
      const version = String(release.version);
      const archiveDir = path.join(this.config.updatesRoot, "archives");
      const extractDir = path.join(this.config.updatesRoot, "extract", version);
      const archivePath = path.join(archiveDir, `flow-system-agent-${sanitizeFileName(version)}.tar.gz`);
      const updaterSpecPath = path.join(this.config.updatesRoot, `updater-${sanitizeFileName(version)}.json`);
      const updaterScriptPath = path.join(this.config.appRoot, "scripts", "local-agent-updater.mjs");

      ensureDir(this.config.updatesRoot);
      ensureDir(archiveDir);
      ensureDir(path.dirname(updaterSpecPath));

      await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          throw new Error("Agent is not registered");
        }
        return this.client.downloadToFile(`/api/v1/agents/${this.agentId}/releases/current/package`, archivePath);
      });

      const digest = await sha256File(archivePath);
      if (digest.sha256 !== String(release.package_sha256) || digest.sizeBytes !== Number(release.package_size_bytes)) {
        throw new Error("Downloaded update package failed checksum verification");
      }

      this.writeLocalSetting("agent_update_apply_status", "extracting");
      this.writeLocalSetting("agent_update_apply_message", "???????");

      fs.rmSync(extractDir, { recursive: true, force: true });
      ensureDir(extractDir);
      await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir], {
        cwd: this.config.flowRoot,
        timeout: 120_000,
      });

      const updaterSpec = {
        parentPid: process.pid,
        appRoot: this.config.appRoot,
        extractRoot: extractDir,
        nodeExecutablePath: this.config.nodeExecutablePath,
        npmCliPath: this.config.npmCliPath ?? null,
        restartCommand: this.config.restartCommand,
        logFilePath: path.join(this.config.logsRoot, "agent-update.log"),
        appliedVersion: version,
      };
      fs.writeFileSync(updaterSpecPath, JSON.stringify(updaterSpec, null, 2), "utf8");

      this.writeLocalSetting("agent_update_apply_status", "restarting");
      this.writeLocalSetting("agent_update_apply_message", "?????????");

      spawn(this.config.nodeExecutablePath, [updaterScriptPath, updaterSpecPath], {
        cwd: this.config.appRoot,
        detached: true,
        stdio: "ignore",
      }).unref();

      setTimeout(() => process.exit(0), 700);

      return {
        accepted: true,
        apply_status: "restarting",
        version,
      };
    } catch (error) {
      this.writeLocalSetting("agent_update_apply_status", "failed");
      this.writeLocalSetting("agent_update_apply_message", String(error));
      throw error;
    } finally {
      this.updateApplyRunning = false;
    }
  }

  private prepareDirectories(): void {
    for (const dir of [
      this.config.flowRoot,
      this.config.conversationsRoot,
      this.config.tasksRoot,
      this.config.tmpRoot,
      this.config.updatesRoot,
      this.config.recoveryRoot,
      this.config.overlayDataRoot,
      this.config.dataRoot,
      this.config.logsRoot,
      this.config.backupsRoot,
    ]) {
      ensureDir(dir);
    }
  }

  private loadCredentialsFromDatabase(): void {
    if (!this.agentId) {
      this.agentId = this.readAgentState("agent_id");
    }
    if (!this.agentToken) {
      this.agentToken = this.readAgentState("agent_token");
    }
    this.client.setCredentials({
      agentId: this.agentId,
      agentToken: this.agentToken,
    });
  }

  private async ensureAgentOwnerAlignment(): Promise<void> {
    const storedOwnerUserId = this.readAgentState("owner_user_id");
    if (storedOwnerUserId && storedOwnerUserId !== this.config.ownerUserId) {
      this.logger.info("Agent owner changed, clearing cached credentials", {
        storedOwnerUserId,
        configuredOwnerUserId: this.config.ownerUserId,
      });
      this.clearAgentCredentials();
      return;
    }

    if (!this.agentId || !this.agentToken || storedOwnerUserId) {
      return;
    }

    try {
      const config = await this.client.getAgentConfig(this.agentId);
      const remoteOwnerUserId = typeof config.owner_user_id === "string" ? config.owner_user_id : undefined;
      if (!remoteOwnerUserId) {
        return;
      }
      if (remoteOwnerUserId !== this.config.ownerUserId) {
        this.logger.info("Cached agent belongs to a different owner, re-registering", {
          remoteOwnerUserId,
          configuredOwnerUserId: this.config.ownerUserId,
        });
        this.clearAgentCredentials();
        return;
      }
      this.writeAgentState("owner_user_id", remoteOwnerUserId);
    } catch (error) {
      if (error instanceof PlatformRequestError && (error.status === 401 || error.status === 403)) {
        this.logger.info("Cached agent credentials are no longer valid, clearing local state");
        this.clearAgentCredentials();
        return;
      }
      throw error;
    }
  }

  private async ensureRegistered(): Promise<void> {
    if (this.agentId && this.agentToken) {
      return;
    }
    const result = await this.client.registerAgent(
      {
        request_id: `req_${randomUUID()}`,
        agent_name: this.config.agentName,
        machine_name: os.hostname(),
        owner_user_id: this.config.ownerUserId,
        ip_address: "127.0.0.1",
        runtime_version: this.config.runtimeVersion,
        local_ui_port: this.config.uiPort,
        os_type: process.platform === "win32" ? "windows" : "linux",
        capabilities: ["local_storage", "task_cards", "notifications", "action_runner"],
      },
      this.config.bootstrapToken,
    );
    this.agentId = result.agent_id;
    this.agentToken = result.agent_token;
    this.client.setCredentials({
      agentId: this.agentId,
      agentToken: this.agentToken,
    });
    this.writeAgentState("agent_id", result.agent_id);
    this.writeAgentState("agent_token", result.agent_token);
    this.writeAgentState("owner_user_id", this.config.ownerUserId);
    this.logger.info("Agent registered", { agentId: result.agent_id });
  }

  private async syncRemoteAgentConfig(): Promise<void> {
    if (!this.agentId) {
      return;
    }

    try {
      const payload = await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          throw new Error("Agent is not registered");
        }
        return this.client.getAgentConfig(this.agentId);
      });

      const platformWebOrigin = typeof payload.platform_web_origin === "string"
        ? normalizeOrigin(payload.platform_web_origin)
        : normalizeOrigin(this.config.platformWebOrigin);
      this.writeLocalSetting("platform_web_origin", platformWebOrigin);
      this.writeLocalSetting("platform_poll_interval_seconds", String(payload.poll_interval_seconds ?? this.config.pollIntervalSeconds));
      this.writeLocalSetting("platform_max_file_size_bytes", String(payload.max_file_size_bytes ?? ""));
      this.writeLocalSetting("platform_local_ui_port", String(payload.local_ui_port ?? this.config.uiPort));
      if (typeof payload.owner_display_name === "string" && payload.owner_display_name.trim().length > 0) {
        this.writeLocalSetting("owner_display_name", payload.owner_display_name);
      }
    } catch (error) {
      this.logger.warn("Agent config sync failed", { error: String(error) });
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.agentId) {
      return;
    }
    try {
      const taskCount = (this.db.connection.prepare("select count(*) as count from local_tasks").get() as { count: number }).count;
      await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          return null;
        }
        return this.client.postHeartbeat({
          request_id: `req_${randomUUID()}`,
          agent_id: this.agentId,
          status: "online",
          last_seen_tasks: taskCount,
          current_load: this.intakeRunning ? 1 : 0,
        });
      });
    } catch (error) {
      this.logger.warn("Heartbeat failed", { error: String(error) });
    }
  }

  private async runIntakeCycle(): Promise<void> {
    if (!this.agentId) {
      return;
    }
    if (this.intakeRunning) {
      this.logger.debug("Skipping intake cycle because the previous run is still active");
      return;
    }
    const pendingOutbox = this.pendingOutboxCount();
    if (pendingOutbox > this.config.maxOutboxHardLimit) {
      this.logger.warn("Skipping intake because outbox hard limit was exceeded", { pendingOutbox });
      return;
    }
    this.intakeRunning = true;
    try {
      const deliveries = await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          return [];
        }
        return this.client.getPendingDeliveries(this.agentId);
      });
      for (const delivery of deliveries) {
        await this.processPendingTask(remoteTaskSchema.parse(delivery));
      }
    } catch (error) {
      this.logger.warn("Intake cycle failed", { error: String(error) });
    } finally {
      this.intakeRunning = false;
    }
  }

  private async runConversationSync(): Promise<void> {
    if (!this.agentId) {
      return;
    }
    if (this.conversationSyncRunning) {
      this.logger.debug("Skipping conversation sync because the previous run is still active");
      return;
    }
    this.conversationSyncRunning = true;
    try {
      await this.syncConversationThread();
      const messages = await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          return [];
        }
        return this.client.getPendingConversationMessages(this.agentId);
      });
      for (const message of messages) {
        await this.processConversationMessage(remoteConversationMessageSchema.parse(message));
      }
    } catch (error) {
      this.logger.warn("Conversation sync failed", { error: String(error) });
    } finally {
      this.conversationSyncRunning = false;
    }
  }

  private async syncConversationThread(): Promise<{
    conversationId: string;
    ownerUserId: string;
    messages: Array<z.infer<typeof remoteConversationMessageSchema>>;
  }> {
    if (!this.agentId) {
      return {
        conversationId: `conv_${this.config.ownerUserId}`,
        ownerUserId: this.config.ownerUserId,
        messages: [],
      };
    }

    const payload = conversationThreadSchema.parse(
      await this.withAgentAuthRetry(async () => this.client.getAgentConversationThread(this.agentId!)),
    );
    const ownerUserId = payload.owner_user_id;
    const conversationId = payload.conversation_id;
    const remoteMessages = payload.messages;

    this.db.connection.prepare(`
      insert into local_conversations (
        conversation_id, owner_user_id, created_at, updated_at
      ) values (?, ?, ?, ?)
      on conflict(conversation_id) do update set
        owner_user_id = excluded.owner_user_id,
        updated_at = excluded.updated_at
    `).run(conversationId, ownerUserId, nowIso(), nowIso());

    const remoteIds = new Set<string>();
    for (const message of remoteMessages) {
      remoteIds.add(message.message_id);
      this.persistConversationMessage(message);
    }

    const localRows = this.db.connection.prepare(`
      select message_id
      from local_conversation_messages
      where conversation_id = ?
    `).all(conversationId) as Array<{ message_id: string }>;

    for (const row of localRows) {
      if (remoteIds.has(row.message_id)) {
        continue;
      }
      this.deleteLocalConversationMessage(conversationId, row.message_id);
    }

    return {
      conversationId,
      ownerUserId,
      messages: remoteMessages,
    };
  }

  private async refreshUpdateStatus(): Promise<void> {
    if (!this.agentId) {
      return;
    }
    if (this.updateCheckRunning) {
      return;
    }

    this.updateCheckRunning = true;
    try {
      const payload = await this.withAgentAuthRetry(async () => {
        if (!this.agentId) {
          throw new Error("Agent is not registered");
        }
        return this.client.getCurrentAgentRelease(this.agentId);
      });
      const releaseStatus = remoteAgentReleaseSchema.parse(payload);
      const release = releaseStatus.release
        ? {
            ...releaseStatus.release,
            update_available: releaseStatus.update_available,
          }
        : null;

      if (release) {
        this.writeLocalSetting("agent_update_release_json", JSON.stringify(release));
      } else {
        this.db.connection.prepare("delete from local_settings where key = ?").run("agent_update_release_json");
      }

      const currentApplyStatus = this.readLocalSetting("agent_update_apply_status");
      if (!currentApplyStatus || currentApplyStatus === "idle") {
        this.writeLocalSetting("agent_update_apply_status", releaseStatus.update_available ? "available" : "idle");
        this.writeLocalSetting("agent_update_apply_message", releaseStatus.update_available ? "?????????" : "????????");
      }
    } catch (error) {
      this.logger.warn("Update status refresh failed", { error: String(error) });
    } finally {
      this.updateCheckRunning = false;
    }
  }

  private async processPendingTask(task: z.infer<typeof remoteTaskSchema>): Promise<void> {
    const taskRoot = path.join(this.config.tasksRoot, task.task_id);
    const inputDir = path.join(taskRoot, "input");
    const outputDir = path.join(taskRoot, "output");
    const metaDir = path.join(taskRoot, "meta");
    const tmpDir = path.join(this.config.tmpRoot, task.task_id);
    ensureDir(taskRoot);
    ensureDir(inputDir);
    ensureDir(outputDir);
    ensureDir(metaDir);
    ensureDir(tmpDir);

    try {
      for (const attachment of task.attachment_manifest) {
        const localName = `${attachment.file_id}-${sanitizeFileName(attachment.file_name)}`;
        const targetPath = path.join(inputDir, localName);
        if (fs.existsSync(targetPath)) {
          const digest = await sha256File(targetPath);
          if (digest.sha256 === attachment.sha256 && digest.sizeBytes === attachment.size_bytes) {
            continue;
          }
        }

        const tmpPath = path.join(tmpDir, localName);
        await this.withAgentAuthRetry(async () => this.client.downloadToFile(`/api/v1/tasks/${task.task_id}/attachments/${attachment.file_id}`, tmpPath));
        const digest = await sha256File(tmpPath);
        if (digest.sha256 !== attachment.sha256 || digest.sizeBytes !== attachment.size_bytes) {
          this.moveToRecovery(tmpPath, task.task_id);
          throw new Error(`Attachment verification failed for ${attachment.file_name}`);
        }
        fs.renameSync(tmpPath, targetPath);
      }

      this.upsertLocalTask(task, taskRoot, outputDir);
      this.replaceChecklist(task.task_id, task.checklist);

      const row = this.requireTask(task.task_id);
      if (row.status === "delivered") {
        this.updateTaskStatus(task.task_id, "received");
        await this.enqueueJson(`/api/v1/tasks/${task.task_id}/status`, {
          request_id: `req_${randomUUID()}`,
          task_id: task.task_id,
          status: "received",
          actor_role: "assignee",
          current_step: "Task received locally",
          occurred_at: nowIso(),
        });
      }
      this.logger.info("Task received locally", { taskId: task.task_id });
    } catch (error) {
      this.logger.error("Failed to process pending task", { taskId: task.task_id, error: String(error) });
    }
  }

  private async processConversationMessage(message: RemoteConversationMessage): Promise<void> {
    const payloadPath = this.persistConversationMessage(message);
    let localMessage = await this.acknowledgeConversationMessage(message);

    if (this.shouldAutoReplyToConversationMessage(localMessage)) {
      const alreadyReplied = this.readLocalSetting(`conversation_reply_sent:${localMessage.message_id}`);
      if (alreadyReplied) {
        this.logger.debug("Skipping OpenClaw invocation because this message was already replied", {
          conversationId: localMessage.conversation_id,
          messageId: localMessage.message_id,
          replyMessageId: alreadyReplied,
        });
      } else {
        try {
          localMessage = await this.updateConversationMessageStatus(localMessage, "processing");
          this.logger.info("Invoking OpenClaw for conversation message", {
            conversationId: localMessage.conversation_id,
            messageId: localMessage.message_id,
            ownerUserId: this.config.ownerUserId,
          });
          const replyText = await this.buildConversationReplyText(localMessage);
          if (!replyText.trim()) {
            localMessage = await this.updateConversationMessageStatus(
              localMessage,
              "failed",
              "OpenClaw returned an empty reply.",
            );
            this.logger.warn("OpenClaw returned an empty reply for conversation message", {
              conversationId: localMessage.conversation_id,
              messageId: localMessage.message_id,
            });
            return;
          }

          const replyResult = await this.postConversationReply(localMessage, replyText);
          localMessage = replyResult.sourceMessage;
          this.writeLocalSetting(`conversation_reply_sent:${localMessage.message_id}`, replyResult.replyMessageId ?? "queued");
          this.logger.info("OpenClaw reply stored and posted to platform", {
            conversationId: localMessage.conversation_id,
            messageId: localMessage.message_id,
            replyMessageId: replyResult.replyMessageId ?? "queued",
          });
        } catch (error) {
          const failureReason = error instanceof Error ? error.message : String(error);
          localMessage = await this.updateConversationMessageStatus(localMessage, "failed", failureReason);
          this.logger.warn("OpenClaw reply generation failed", {
            conversationId: localMessage.conversation_id,
            messageId: localMessage.message_id,
            error: failureReason,
          });
          return;
        }
      }
    }

    this.logger.info("Conversation message stored locally", {
      conversationId: localMessage.conversation_id,
      messageId: localMessage.message_id,
      path: payloadPath,
    });
  }

  private mergeAndPersistConversationMessage(
    message: RemoteConversationMessage,
    patch: Partial<RemoteConversationMessage>,
  ): RemoteConversationMessage {
    const updatedMessage = remoteConversationMessageSchema.parse({
      ...message,
      ...patch,
    });
    this.persistConversationMessage(updatedMessage);
    return updatedMessage;
  }

  private async acknowledgeConversationMessage(message: RemoteConversationMessage): Promise<RemoteConversationMessage> {
    if (!this.agentId) {
      return message;
    }

    const deliveredAt = nowIso();
    const payload = {
      request_id: `req_conversation_ack_${message.message_id}`,
      delivered_at: deliveredAt,
    };

    try {
      const response = await this.withAgentAuthRetry(async () =>
        this.client.ackConversationMessage(this.agentId!, message.message_id, payload)) as { message?: Record<string, unknown> };
      if (response?.message) {
        const updatedMessage = remoteConversationMessageSchema.parse(response.message);
        this.persistConversationMessage(updatedMessage);
        this.logger.info("Conversation message acknowledged to platform", {
          conversationId: updatedMessage.conversation_id,
          messageId: updatedMessage.message_id,
        });
        return updatedMessage;
      }
    } catch (error) {
      await this.enqueueJson(`/api/v1/agents/${this.agentId}/conversations/messages/${message.message_id}/ack`, payload, "POST");
      this.logger.warn("Conversation acknowledge fell back to outbox", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        error: String(error),
      });
    }

    return this.mergeAndPersistConversationMessage(message, {
      sync_status: message.sync_status === "pending" ? "synced" : message.sync_status,
      sync_detail: null,
      delivered_to_agent_at: message.delivered_to_agent_at ?? deliveredAt,
      updated_at: deliveredAt,
    });
  }

  private async updateConversationMessageStatus(
    message: RemoteConversationMessage,
    syncStatus: "processing" | "failed",
    syncDetail?: string,
  ): Promise<RemoteConversationMessage> {
    if (!this.agentId) {
      return message;
    }

    const occurredAt = nowIso();
    const payload = {
      request_id: `req_conversation_status_${syncStatus}_${message.message_id}`,
      sync_status: syncStatus,
      ...(syncStatus === "failed" && syncDetail ? { sync_detail: syncDetail } : {}),
      occurred_at: occurredAt,
    };

    try {
      const response = await this.withAgentAuthRetry(async () =>
        this.client.updateConversationMessageStatus(this.agentId!, message.message_id, payload)) as { message?: Record<string, unknown> };
      if (response?.message) {
        const updatedMessage = remoteConversationMessageSchema.parse(response.message);
        this.persistConversationMessage(updatedMessage);
        return updatedMessage;
      }
    } catch (error) {
      await this.enqueueJson(`/api/v1/agents/${this.agentId}/conversations/messages/${message.message_id}/status`, payload, "POST");
      this.logger.warn("Conversation status update fell back to outbox", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        syncStatus,
        error: String(error),
      });
    }

    return this.mergeAndPersistConversationMessage(message, {
      sync_status: syncStatus,
      sync_detail: syncStatus === "failed" ? (syncDetail ?? null) : null,
      delivered_to_agent_at: message.delivered_to_agent_at ?? occurredAt,
      updated_at: occurredAt,
    });
  }

  private async postConversationReply(
    message: RemoteConversationMessage,
    replyText: string,
  ): Promise<{ sourceMessage: RemoteConversationMessage; replyMessageId?: string }> {
    if (!this.agentId) {
      throw new Error("Agent is not registered");
    }

    const occurredAt = nowIso();
    const payload = {
      request_id: `req_conversation_reply_${message.message_id}`,
      body: replyText,
      occurred_at: occurredAt,
    };

    try {
      const response = await this.withAgentAuthRetry(async () =>
        this.client.replyConversationMessage(this.agentId!, message.message_id, payload)) as {
        source_message?: Record<string, unknown>;
        message?: Record<string, unknown>;
      };

      const sourceMessage = response?.source_message
        ? remoteConversationMessageSchema.parse(response.source_message)
        : this.mergeAndPersistConversationMessage(message, {
          sync_status: "replied",
          sync_detail: null,
          delivered_to_agent_at: message.delivered_to_agent_at ?? occurredAt,
          updated_at: occurredAt,
        });
      this.persistConversationMessage(sourceMessage);

      if (response?.message) {
        const replyMessage = remoteConversationMessageSchema.parse(response.message);
        this.persistConversationMessage(replyMessage);
        return {
          sourceMessage,
          replyMessageId: replyMessage.message_id,
        };
      }

      return {
        sourceMessage,
      };
    } catch (error) {
      await this.enqueueJson(`/api/v1/agents/${this.agentId}/conversations/messages/${message.message_id}/reply`, payload, "POST");
      this.logger.warn("Conversation reply delivery fell back to outbox", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        error: String(error),
      });
      return {
        sourceMessage: this.mergeAndPersistConversationMessage(message, {
          sync_status: "replied",
          sync_detail: null,
          delivered_to_agent_at: message.delivered_to_agent_at ?? occurredAt,
          updated_at: occurredAt,
        }),
      };
    }
  }

  private async loadConversationRouterTargets(): Promise<ConversationRouterTarget[]> {
    if (!this.agentId) {
      return [];
    }

    const payload = await this.withAgentAuthRetry(async () => this.client.getConversationTargets(this.agentId!));
    return z.array(conversationRouterTargetSchema).parse(payload);
  }

  private async buildConversationReplyText(message: z.infer<typeof remoteConversationMessageSchema>): Promise<string> {
    let targets: ConversationRouterTarget[] = [];
    try {
      targets = await this.loadConversationRouterTargets();
    } catch (error) {
      this.logger.warn("Failed to load conversation forwarding targets", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        error: String(error),
      });
    }

    const forwardIntent = this.detectConversationForwardIntent(message.body, targets);
    if (forwardIntent.kind === "clarify_target") {
      return forwardIntent.replyText;
    }

    if (forwardIntent.kind === "none") {
      const identityIntent = this.detectConversationTargetIdentityIntent(message.body, targets);
      if (identityIntent.kind === "clarify_target") {
        return identityIntent.replyText;
      }
      if (identityIntent.kind === "identity") {
        return this.buildConversationTargetIdentityReply(identityIntent.match);
      }
      if (this.hasPendingFlowSystemOperatorContext(message.conversation_id) || this.looksLikeFlowSystemOperatorRequest(message.body)) {
        return this.buildFlowSystemOperatorReplyText(message);
      }
      return this.invokeOpenClawReply(
        message,
        [],
        message.body.trim(),
        { sessionNamespace: "conversation" },
      );
    }

    const rawReply = await this.invokeOpenClawReply(message, targets);
    let parsed = parseConversationRouterAction(rawReply);
    let repairApplied = false;

    if (
      forwardIntent.kind === "forward" &&
      parsed.action.action === "reply_only" &&
      this.shouldRepairConversationRouterReply(parsed.action.reply_text)
    ) {
      repairApplied = true;
      this.logger.warn("OpenClaw asked for forwarding protocol details; attempting repair", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        targetName: forwardIntent.match.matchedName,
      });
      parsed = await this.repairConversationForwardAction(message, targets, forwardIntent.match);
    }

    this.logger.info("OpenClaw conversation action parsed", {
      conversationId: message.conversation_id,
      messageId: message.message_id,
      action: parsed.action.action,
      usedStructuredBlock: parsed.used_structured_block,
      repairApplied,
    });

    if (forwardIntent.kind === "forward" && parsed.action.action !== "forward_message") {
      this.logger.warn("OpenClaw did not return forward_message for detected forward request", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        targetName: forwardIntent.match.matchedName,
        repairApplied,
      });
      return this.buildForwardContentClarification(forwardIntent.match.target);
    }

    if (!this.agentId) {
      return parsed.action.action === "reply_only"
        ? parsed.action.reply_text
        : "我暂时无法执行转发，因为本机 OpenClaw 还没有完成注册。";
    }

    const execution = await executeConversationRouterAction({
      client: this.client,
      agentId: this.agentId,
      requestId: `req_conversation_forward_${message.message_id}`,
      action: parsed.action,
    });

    if (execution.forwardResult) {
      this.logger.info("OpenClaw conversation forward executed", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        targetUserId: execution.forwardResult.target.user_id,
        targetAgentId: execution.forwardResult.target.agent_id,
        taskId: typeof execution.forwardResult.task_brief?.task_id === "string" ? execution.forwardResult.task_brief.task_id : undefined,
      });
    }

    return execution.replyText;
  }

  private persistConversationMessage(message: z.infer<typeof remoteConversationMessageSchema>): string {
    const conversationDir = path.join(this.config.conversationsRoot, message.conversation_id);
    ensureDir(conversationDir);

    const payloadPath = path.join(conversationDir, `${message.message_id}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(message, null, 2), "utf8");

    const now = nowIso();
    this.db.connection.prepare(`
      insert into local_conversations (
        conversation_id, owner_user_id, created_at, updated_at
      ) values (?, ?, ?, ?)
      on conflict(conversation_id) do update set
        owner_user_id = excluded.owner_user_id,
        updated_at = excluded.updated_at
    `).run(
      message.conversation_id,
      message.owner_user_id,
      message.created_at,
      now,
    );

    this.db.connection.prepare(`
      insert into local_conversation_messages (
        message_id, conversation_id, message_type, author_kind, body,
        source_user_id, source_display_name, target_user_id, target_agent_id,
        sync_status, sync_detail, delivered_to_agent_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(message_id) do update set
        conversation_id = excluded.conversation_id,
        message_type = excluded.message_type,
        author_kind = excluded.author_kind,
        body = excluded.body,
        source_user_id = excluded.source_user_id,
        source_display_name = excluded.source_display_name,
        target_user_id = excluded.target_user_id,
        target_agent_id = excluded.target_agent_id,
        sync_status = excluded.sync_status,
        sync_detail = excluded.sync_detail,
        delivered_to_agent_at = excluded.delivered_to_agent_at,
        updated_at = excluded.updated_at
    `).run(
      message.message_id,
      message.conversation_id,
      message.message_type,
      message.author_kind,
      message.body,
      message.source_user_id ?? null,
      message.source_display_name ?? null,
      message.target_user_id ?? null,
      message.target_agent_id ?? null,
      message.sync_status,
      message.sync_detail ?? null,
      message.delivered_to_agent_at ?? null,
      message.created_at,
      now,
    );

    return payloadPath;
  }

  private deleteLocalConversationMessage(conversationId: string, messageId: string): void {
    this.db.connection.prepare("delete from local_conversation_messages where message_id = ?").run(messageId);
    const payloadPath = path.join(this.config.conversationsRoot, conversationId, `${messageId}.json`);
    fs.rmSync(payloadPath, { force: true });
  }

  private shouldAutoReplyToConversationMessage(message: z.infer<typeof remoteConversationMessageSchema>): boolean {
    if (!this.config.openClawAutoReplyEnabled) {
      return false;
    }
    return message.message_type === "user_message" || message.message_type === "incoming_delivery";
  }

  private detectConversationForwardIntent(
    messageBody: string,
    targets: ConversationRouterTarget[],
  ): ConversationForwardIntent {
    const matches = this.findConversationForwardTargetMatches(messageBody, targets)
      .filter((match) => this.looksLikeForwardIntentForTarget(messageBody, match.matchedName));

    if (matches.length > 1) {
      return {
        kind: "clarify_target",
        replyText: this.buildAmbiguousTargetClarification(matches),
      };
    }

    if (matches.length === 1) {
      return {
        kind: "forward",
        match: matches[0]!,
      };
    }

    if (this.looksLikeForwardRequestWithoutTarget(messageBody)) {
      return {
        kind: "clarify_target",
        replyText: "你想让我转给谁？",
      };
    }

    return { kind: "none" };
  }

  private detectConversationTargetIdentityIntent(
    messageBody: string,
    targets: ConversationRouterTarget[],
  ): ConversationTargetIdentityIntent {
    const matches = this.findConversationForwardTargetMatches(messageBody, targets)
      .filter((match) => this.looksLikeConversationTargetIdentityQuestion(messageBody, match.matchedName));

    if (matches.length > 1) {
      return {
        kind: "clarify_target",
        replyText: this.buildAmbiguousTargetIdentityClarification(matches),
      };
    }

    if (matches.length === 1) {
      return {
        kind: "identity",
        match: matches[0]!,
      };
    }

    return { kind: "none" };
  }

  private findConversationForwardTargetMatches(
    messageBody: string,
    targets: ConversationRouterTarget[],
  ): ConversationForwardTargetMatch[] {
    const matches = new Map<string, ConversationForwardTargetMatch>();
    for (const target of targets) {
      const candidateNames = [...new Set([target.display_name, target.username].filter((value) => value.trim().length > 0))];
      let bestMatch: ConversationForwardTargetMatch | null = null;
      for (const candidateName of candidateNames) {
        const index = this.findConversationTargetNameIndex(messageBody, candidateName);
        if (index < 0) {
          continue;
        }
        if (!bestMatch || index < bestMatch.index || (index === bestMatch.index && candidateName.length > bestMatch.matchedName.length)) {
          bestMatch = {
            target,
            matchedName: candidateName,
            index,
          };
        }
      }
      if (bestMatch) {
        matches.set(target.user_id, bestMatch);
      }
    }
    return [...matches.values()].sort((left, right) => left.index - right.index || right.matchedName.length - left.matchedName.length);
  }

  private findConversationTargetNameIndex(messageBody: string, candidateName: string): number {
    const token = candidateName.trim().toLowerCase();
    if (token.length === 0) {
      return -1;
    }

    const loweredBody = messageBody.toLowerCase();
    if (/^[a-z0-9._-]+$/.test(token)) {
      const pattern = new RegExp(`(^|[^a-z0-9._-])${escapeRegExp(token)}($|[^a-z0-9._-])`, "i");
      const match = loweredBody.match(pattern);
      return typeof match?.index === "number" ? match.index : -1;
    }

    return normalizeConversationIntentText(loweredBody).indexOf(normalizeConversationIntentText(token));
  }

  private looksLikeForwardIntentForTarget(messageBody: string, matchedName: string): boolean {
    const normalizedBody = normalizeConversationIntentText(messageBody);
    const normalizedTarget = normalizeConversationIntentText(matchedName);
    if (normalizedTarget.length === 0) {
      return false;
    }

    const escapedTarget = escapeRegExp(normalizedTarget);
    return new RegExp(`(?:\u8f6c\u53d1\u7ed9|\u53d1\u7ed9|\u4ea4\u7ed9|\u544a\u8bc9|\u901a\u77e5|\u8054\u7cfb|\u8f6c\u544a|\u8ba9|\u53eb|\u8bf7)${escapedTarget}`).test(normalizedBody)
      || new RegExp(`${escapedTarget}(?:\u6765\u6211\u8fd9|\u6765\u6211\u8fd9\u91cc|\u6765\u627e\u6211|\u6765\u4e00\u4e0b|\u8fc7\u6765|\u627e\u6211|\u8054\u7cfb\u6211|\u56de\u6211|\u56de\u590d|\u786e\u8ba4|\u5904\u7406|\u770b\u4e00\u4e0b|\u770b\u770b|\u5f00\u4f1a)`).test(normalizedBody);
  }

  private looksLikeForwardRequestWithoutTarget(messageBody: string): boolean {
    const normalizedBody = normalizeConversationIntentText(messageBody);
    return /(\u5e2e\u6211)?(?:\u8f6c\u53d1|\u8f6c\u7ed9|\u53d1\u7ed9|\u4ea4\u7ed9)(?:\u4e00\u4e0b|\u4e00\u4e0b\u8fd9\u6761\u6d88\u606f|\u8fd9\u6761\u6d88\u606f|\u8fd9\u4e2a\u6d88\u606f)?$/.test(normalizedBody)
      || /(?:\u544a\u8bc9|\u901a\u77e5|\u8054\u7cfb|\u8f6c\u544a)(?:\u4ed6|\u5979|ta|\u5bf9\u65b9|\u90a3\u4f4d|\u90a3\u4e2a\u6210\u5458)/.test(normalizedBody)
      || /(?:\u8ba9|\u53eb|\u8bf7)(?:\u4ed6|\u5979|ta|\u5bf9\u65b9|\u90a3\u4f4d|\u90a3\u4e2a\u6210\u5458).*(?:\u6765\u6211\u8fd9|\u6765\u6211\u8fd9\u91cc|\u6765\u627e\u6211|\u8fc7\u6765|\u627e\u6211|\u8054\u7cfb\u6211|\u56de\u6211|\u56de\u590d|\u786e\u8ba4|\u5904\u7406|\u5f00\u4f1a)/.test(normalizedBody);
  }

  private looksLikeConversationTargetIdentityQuestion(messageBody: string, matchedName: string): boolean {
    const normalizedBody = normalizeConversationIntentText(messageBody);
    const normalizedTarget = normalizeConversationIntentText(matchedName);
    if (normalizedTarget.length === 0 || !normalizedBody.includes(normalizedTarget)) {
      return false;
    }

    return normalizedBody.includes(`${normalizedTarget}是谁`)
      || normalizedBody.includes(`${normalizedTarget}是什么人`)
      || normalizedBody.includes(`${normalizedTarget}是干什么的`)
      || normalizedBody.includes(`${normalizedTarget}是做什么的`)
      || normalizedBody.includes(`谁是${normalizedTarget}`)
      || normalizedBody.includes(`你知道${normalizedTarget}`)
      || normalizedBody.includes(`知道${normalizedTarget}`)
      || normalizedBody.includes(`认识${normalizedTarget}`)
      || normalizedBody.includes(`了解${normalizedTarget}`)
      || normalizedBody.includes(`whois${normalizedTarget}`)
      || normalizedBody.includes(`doyouknow${normalizedTarget}`);
  }

  private buildAmbiguousTargetClarification(matches: ConversationForwardTargetMatch[]): string {
    const labels = matches
      .slice(0, 3)
      .map(({ target }) => this.formatConversationTargetLabel(target));
    return `你是要转给 ${labels.join(" 还是 ")}？`;
  }

  private buildAmbiguousTargetIdentityClarification(matches: ConversationForwardTargetMatch[]): string {
    const labels = matches
      .slice(0, 3)
      .map(({ target }) => this.formatConversationTargetLabel(target));
    return `你想问的是 ${labels.join(" 还是 ")}？`;
  }

  private formatConversationTargetLabel(target: ConversationRouterTarget): string {
    if (target.display_name === target.username) {
      return target.username;
    }
    return `${target.display_name}（${target.username}）`;
  }

  private buildForwardContentClarification(target: ConversationRouterTarget): string {
    const label = target.display_name.trim().length > 0 ? target.display_name : target.username;
    return `你想让我告诉 ${label} 什么？`;
  }

  private buildConversationTargetIdentityReply(match: ConversationForwardTargetMatch): string {
    const label = this.formatConversationTargetLabel(match.target);
    const onlineText = match.target.online ? "在线" : "离线";
    return `根据当前可转发目标列表，${label} 是一个可联系成员，目前${onlineText}。如果你想让我联系他，直接告诉我要转告什么。`;
  }

  private looksLikeFlowSystemOperatorRequest(messageBody: string): boolean {
    const normalizedBody = normalizeConversationIntentText(messageBody);
    if (normalizedBody.length === 0) {
      return false;
    }

    if (/^确认删除(任务|项目)[a-z0-9_-]+$/i.test(normalizedBody)) {
      return true;
    }

    if (!/(任务|task|项目|project)/i.test(messageBody)) {
      return false;
    }

    return /(新建|创建|新增|建立|添加|删除|移除|修改|更新|调整|查询|查看|列出|列表|进度|状态|做到哪一步|到哪一步|负责人|截止|提醒|deadline|assignee|progress|status|delete|create|update|get|list)/i.test(messageBody);
  }

  private async buildFlowSystemOperatorReplyText(
    message: z.infer<typeof remoteConversationMessageSchema>,
  ): Promise<string> {
    try {
      const credentials = this.loadFlowSystemOperatorCredentials();
      if (!credentials) {
        return "\u5f53\u524d OpenClaw \u8fd8\u6ca1\u6709 Flow System \u64cd\u4f5c\u51ed\u636e\uff0c\u65e0\u6cd5\u6267\u884c\u771f\u5b9e\u7684\u4efb\u52a1\u6216\u9879\u76ee\u64cd\u4f5c\u3002";
      }

      const pendingContext = this.readPendingFlowSystemOperatorContext(message.conversation_id);
      const action = await this.resolveFlowSystemOperatorAction(message, pendingContext);
      if (!action) {
        return "\u6211\u521a\u624d\u6ca1\u6709\u6574\u7406\u597d\u8fd9\u6761 Flow System \u64cd\u4f5c\uff0c\u8bf7\u6362\u4e00\u79cd\u66f4\u660e\u786e\u7684\u8bf4\u6cd5\u518d\u8bd5\u4e00\u6b21\u3002";
      }

      const result = await this.runFlowSystemOperatorScript(action, credentials);
      this.syncPendingFlowSystemOperatorContext(message.conversation_id, action, result);
      return this.formatFlowSystemOperatorReply(result);
    } catch (error) {
      this.logger.warn("Flow System operator request failed", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        error: String(error),
      });
      return `\u5904\u7406\u5931\u8d25\uff1a${String(error)}`;
    }
  }

  private async resolveFlowSystemOperatorAction(
    message: z.infer<typeof remoteConversationMessageSchema>,
    pendingContext: PendingFlowSystemOperatorContext | null,
  ): Promise<FlowSystemOperatorAction | null> {
    const trimmedBody = message.body.trim();
    const hasExplicitRequest = this.looksLikeFlowSystemOperatorRequest(trimmedBody);

    if (pendingContext && !hasExplicitRequest) {
      const continuedAction = this.continuePendingFlowSystemOperatorAction(pendingContext, trimmedBody);
      if (continuedAction) {
        return continuedAction;
      }
    }

    const plannedAction = await this.planFlowSystemOperatorAction(message);
    if (plannedAction) {
      return plannedAction;
    }

    if (pendingContext) {
      return this.continuePendingFlowSystemOperatorAction(pendingContext, trimmedBody);
    }

    return null;
  }

  private async planFlowSystemOperatorAction(
    message: z.infer<typeof remoteConversationMessageSchema>,
  ): Promise<FlowSystemOperatorAction | null> {
    const prompt = buildFlowSystemOperatorPrompt({
      ownerUserId: this.config.ownerUserId,
      ownerDisplayName: this.getOwnerDisplayName(),
      currentTimeIso: nowIsoWithLocalOffset(),
      userMessage: message.body.trim(),
    });

    const rawReply = await this.invokeOpenClawReply(message, [], prompt, { sessionNamespace: "operator" });
    const parsed = parseFlowSystemOperatorAction(rawReply);
    if (!parsed.action) {
      const heuristicAction = this.buildHeuristicFlowSystemOperatorAction(message.body.trim());
      if (heuristicAction) {
        this.logger.warn("OpenClaw did not return a valid Flow System operator action; using heuristic fallback", {
          conversationId: message.conversation_id,
          messageId: message.message_id,
          usedStructuredBlock: parsed.used_structured_block,
          rawText: parsed.raw_text,
          action: heuristicAction.action,
        });
        return heuristicAction;
      }

      this.logger.warn("OpenClaw did not return a valid Flow System operator action", {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        usedStructuredBlock: parsed.used_structured_block,
        rawText: parsed.raw_text,
      });
      return null;
    }

    return {
      ...parsed.action,
      original_request: parsed.action.original_request ?? message.body.trim(),
    };
  }

  private buildHeuristicFlowSystemOperatorAction(messageBody: string): FlowSystemOperatorAction | null {
    const trimmedBody = messageBody.trim();
    if (trimmedBody.length === 0) {
      return null;
    }

    const normalizedBody = normalizeConversationIntentText(trimmedBody);
    const deleteTaskMatch = normalizedBody.match(/^确认删除任务([a-z0-9_-]+)$/i);
    if (deleteTaskMatch) {
      return {
        action: "delete_task",
        original_request: trimmedBody,
        task_id: deleteTaskMatch[1],
        confirmed: true,
        confirmation_text: `确认删除任务 ${deleteTaskMatch[1]}`,
      };
    }

    const deleteProjectMatch = normalizedBody.match(/^确认删除项目([a-z0-9_-]+)$/i);
    if (deleteProjectMatch) {
      return {
        action: "delete_project",
        original_request: trimmedBody,
        project_id: deleteProjectMatch[1],
        confirmed: true,
        confirmation_text: `确认删除项目 ${deleteProjectMatch[1]}`,
      };
    }

    if (/(新建|创建|新增|建立|添加).*(任务|task)|(任务|task).*(新建|创建|新增|建立|添加)/i.test(trimmedBody)) {
      const taskTitle = extractConversationTaskTitle(trimmedBody);
      const projectName = extractConversationProjectName(trimmedBody);
      const assigneeName = extractConversationAssigneeName(trimmedBody);
      return {
        action: "create_task",
        original_request: trimmedBody,
        ...(projectName ? { project_name: projectName } : {}),
        ...(assigneeName ? { assignee_name: this.resolveFlowSystemOperatorContinuationText(assigneeName) } : {}),
        ...(taskTitle ? { task_title: taskTitle, task_deliverables: [taskTitle] } : {}),
        task_summary: trimmedBody,
        ...(parseConversationDeadlineHint(trimmedBody) ? { task_deadline: parseConversationDeadlineHint(trimmedBody)! } : {}),
      };
    }

    return null;
  }

  private continuePendingFlowSystemOperatorAction(
    context: PendingFlowSystemOperatorContext,
    messageBody: string,
  ): FlowSystemOperatorAction | null {
    const trimmedBody = messageBody.trim();
    if (trimmedBody.length === 0) {
      return null;
    }

    const resolvedText = this.resolveFlowSystemOperatorContinuationText(trimmedBody);
    const currentAction: FlowSystemOperatorAction = {
      ...context.action,
      original_request: context.action.original_request ?? trimmedBody,
    };

    switch (context.awaiting_field) {
      case "project_name":
        return {
          ...currentAction,
          project_name: resolvedText,
        };
      case "assignee_name":
        return {
          ...currentAction,
          assignee_name: resolvedText,
        };
      case "task_name":
        return {
          ...currentAction,
          task_name: resolvedText,
        };
      case "task_title":
        return {
          ...currentAction,
          task_title: resolvedText,
          task_deliverables: currentAction.task_deliverables?.length ? currentAction.task_deliverables : [resolvedText],
        };
      case "task_deadline": {
        const deadline = parseConversationDeadlineHint(trimmedBody);
        return deadline
          ? {
              ...currentAction,
              task_deadline: deadline,
            }
          : null;
      }
      case "project_owner_name":
        return {
          ...currentAction,
          project_owner_name: resolvedText,
        };
      case "due_date": {
        const dueDate = parseConversationDeadlineHint(trimmedBody);
        return dueDate
          ? {
              ...currentAction,
              due_date: dueDate,
            }
          : null;
      }
      default:
        return {
          ...currentAction,
          project_name: resolvedText,
        };
    }
  }

  private resolveFlowSystemOperatorContinuationText(messageBody: string): string {
    const normalizedBody = normalizeConversationIntentText(messageBody);
    if (normalizedBody === "我" || normalizedBody === "我自己" || normalizedBody === "本人" || normalizedBody === "自己") {
      return this.getOwnerDisplayName();
    }
    return messageBody.trim();
  }

  private async runFlowSystemOperatorScript(
    action: FlowSystemOperatorAction,
    credentials: { username: string; password: string },
  ): Promise<FlowSystemOperatorScriptResult> {
    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
    const scriptPath = path.join(codexHome, "skills", "flow-system-operator", "scripts", "flow_system_operator.py");
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Flow System operator script not found: ${scriptPath}`);
    }

    const environment = {
      ...process.env,
      FLOW_SYSTEM_API_BASE_URL: this.config.platformApiBaseUrl,
      FLOW_SYSTEM_USERNAME: credentials.username,
      FLOW_SYSTEM_PASSWORD: credentials.password,
      FLOW_SYSTEM_WEB_ORIGIN: this.config.platformWebOrigin,
      FLOW_SYSTEM_TIMEZONE: "Asia/Shanghai",
      PYTHONIOENCODING: "utf-8",
    };
    const { stdout } = await execBufferedCommand(
      "python",
      [scriptPath, "run"],
      {
        cwd: this.config.appRoot,
        env: environment,
        maxBuffer: 4 * 1024 * 1024,
        stdin: JSON.stringify(action),
        timeout: 60_000,
      },
    );

    return flowSystemOperatorScriptResultSchema.parse(JSON.parse(stdout.trim()) as unknown);
  }

  private loadFlowSystemOperatorCredentials(): { username: string; password: string } | null {
    const accountsPath = path.join(this.config.appRoot, "account-management", "managed-users.json");
    if (!fs.existsSync(accountsPath)) {
      return null;
    }

    try {
      const payload = z.object({
        accounts: z.array(z.object({
          user_id: z.string(),
          username: z.string(),
          password: z.string(),
        })),
      }).parse(JSON.parse(fs.readFileSync(accountsPath, "utf8")) as unknown);
      const account = payload.accounts.find((candidate) => candidate.user_id === this.config.ownerUserId);
      return account ? { username: account.username, password: account.password } : null;
    } catch (error) {
      this.logger.warn("Failed to load Flow System operator credentials", {
        accountsPath,
        error: String(error),
      });
      return null;
    }
  }

  private formatFlowSystemOperatorReply(result: FlowSystemOperatorScriptResult): string {
    if (!result.ok) {
      return `\u5904\u7406\u5931\u8d25\uff1a${result.message}`;
    }

    if (result.requires_clarification) {
      return result.candidates.length > 0
        ? `${result.message}\n\u5019\u9009\uff1a${result.candidates.join("\u3001")}`
        : result.message;
    }

    if (result.requires_confirmation) {
      return result.confirmation_text
        ? `${result.message}\n\u786e\u8ba4\u547d\u4ee4\uff1a\`${result.confirmation_text}\``
        : result.message;
    }

    if (!result.executed) {
      return result.message;
    }

    const lines = [result.message];
    const taskId = this.pickFlowSystemOperatorText(result.data, ["task_id", "taskId"]);
    const taskTitle = this.pickFlowSystemOperatorText(result.data, ["task_title", "taskTitle"]);
    const projectId = this.pickFlowSystemOperatorText(result.data, ["project_id", "projectId"]);
    const projectName = this.pickFlowSystemOperatorText(result.data, ["project_name", "projectName"]);
    const assignee = this.pickFlowSystemOperatorText(result.data, ["assignee_display_name", "display_name"]);
    const deadline = this.pickFlowSystemOperatorText(result.data, ["deadline"]);
    const taskLink = result.links.task;
    const projectLink = result.links.project;
    const riskyTasks = result.data.risky_tasks;

    if (taskTitle) {
      lines.push(`- \u4efb\u52a1\uff1a${taskTitle}`);
    }
    if (taskId) {
      lines.push(`- \u4efb\u52a1ID\uff1a\`${taskId}\``);
    }
    if (projectName || projectId) {
      lines.push(`- \u9879\u76ee\uff1a${projectName ?? projectId}`);
    }
    if (assignee) {
      lines.push(`- \u8d1f\u8d23\u4eba\uff1a${assignee}`);
    }
    if (deadline) {
      lines.push(`- \u622a\u6b62\u65f6\u95f4\uff1a${deadline}`);
    }
    if (Array.isArray(riskyTasks) && riskyTasks.length > 0) {
      lines.push(`- \u98ce\u9669\u6216\u4e34\u8fd1\u622a\u6b62\uff1a${riskyTasks.join("\u3001")}`);
    }
    if (taskLink) {
      lines.push(`- \u4efb\u52a1\u8be6\u60c5\uff1a${taskLink}`);
    }
    if (projectLink) {
      lines.push(`- \u9879\u76ee\u8be6\u60c5\uff1a${projectLink}`);
    }

    return lines.join("\n");
  }

  private pickFlowSystemOperatorText(data: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private hasPendingFlowSystemOperatorContext(conversationId: string): boolean {
    return this.readPendingFlowSystemOperatorContext(conversationId) !== null;
  }

  private readPendingFlowSystemOperatorContext(conversationId: string): PendingFlowSystemOperatorContext | null {
    const raw = this.readLocalSetting(this.pendingFlowSystemOperatorContextKey(conversationId));
    if (!raw) {
      return null;
    }

    try {
      return pendingFlowSystemOperatorContextSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      this.logger.warn("Failed to parse pending Flow System operator context", {
        conversationId,
        error: String(error),
      });
      this.clearPendingFlowSystemOperatorContext(conversationId);
      return null;
    }
  }

  private syncPendingFlowSystemOperatorContext(
    conversationId: string,
    action: FlowSystemOperatorAction,
    result: FlowSystemOperatorScriptResult,
  ): void {
    if (!result.requires_clarification) {
      this.clearPendingFlowSystemOperatorContext(conversationId);
      return;
    }

    const existing = this.readPendingFlowSystemOperatorContext(conversationId);
    const now = nowIso();
    const awaitingField = this.inferPendingFlowSystemOperatorField(result.message, action);
    const context: PendingFlowSystemOperatorContext = {
      conversation_id: conversationId,
      action,
      awaiting_field: awaitingField,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.writeLocalSetting(
      this.pendingFlowSystemOperatorContextKey(conversationId),
      JSON.stringify(context),
    );
  }

  private inferPendingFlowSystemOperatorField(
    replyMessage: string,
    action: FlowSystemOperatorAction,
  ): PendingFlowSystemOperatorField | null {
    const normalizedMessage = normalizeConversationIntentText(replyMessage);
    if (normalizedMessage.includes("项目")) {
      return "project_name";
    }
    if (normalizedMessage.includes("负责人") || normalizedMessage.includes("执行人") || normalizedMessage.includes("指派")) {
      return "assignee_name";
    }
    if (normalizedMessage.includes("截止") || normalizedMessage.includes("deadline") || normalizedMessage.includes("due")) {
      return action.action === "create_project" || action.action === "update_project" ? "due_date" : "task_deadline";
    }
    if (normalizedMessage.includes("任务")) {
      return "task_name";
    }
    return null;
  }

  private pendingFlowSystemOperatorContextKey(conversationId: string): string {
    return `flow_system_operator_pending:${conversationId}`;
  }

  private clearPendingFlowSystemOperatorContext(conversationId: string): void {
    this.clearLocalSetting(this.pendingFlowSystemOperatorContextKey(conversationId));
  }

  private shouldRepairConversationRouterReply(replyText: string): boolean {
    const normalizedReply = normalizeConversationIntentText(replyText);
    return /(\u4f1a\u8bdd\u8f6c\u53d1\u534f\u8bae|\u534f\u8bae\u6b63\u6587|\u7528\u6237\u6d88\u606f\u539f\u6587|\u6d88\u606f\u539f\u6587|\u8bf7\u628a.*?(\u534f\u8bae|\u539f\u6587|\u6b63\u6587).*?\u53d1\u6211|\u6309\u534f\u8bae\u6267\u884c|\u53ef\u76f4\u63a5\u8f6c\u53d1\u7684\u7ed3\u679c|conversation forwarding protocol|protocol body|original user message|original message|paste .* protocol|send me .* protocol|directly forwardable result|\$openclaw-conversation-router|flow-system-action)/i.test(normalizedReply);
  }

  private async repairConversationForwardAction(
    message: z.infer<typeof remoteConversationMessageSchema>,
    targets: ConversationRouterTarget[],
    match: ConversationForwardTargetMatch,
  ) {
    const repairPrompt = buildConversationRouterRepairPrompt({
      appRoot: this.config.appRoot,
      ownerUserId: this.config.ownerUserId,
      ownerDisplayName: this.getOwnerDisplayName(),
      systemProjectName: conversationRoutingProjectName,
      targets,
      userMessage: message.body.trim(),
      forcedTargetName: match.matchedName,
    });
    const rawReply = await this.invokeOpenClawReply(message, targets, repairPrompt);
    return parseConversationRouterAction(rawReply);
  }

  private async invokeOpenClawReply(
    message: z.infer<typeof remoteConversationMessageSchema>,
    targets: ConversationRouterTarget[] = [],
    promptOverride?: string,
    options?: OpenClawReplyInvocationOptions,
  ): Promise<string> {
    const openClawBin = await this.openClawConnector.resolveExecutableForInvocation();
    const prompt = promptOverride ?? buildConversationRouterPrompt({
      appRoot: this.config.appRoot,
      ownerUserId: this.config.ownerUserId,
      ownerDisplayName: this.getOwnerDisplayName(),
      systemProjectName: conversationRoutingProjectName,
      targets,
      userMessage: message.body.trim(),
    });
    if (!prompt) {
      return "";
    }

    const sessionNamespace = options?.sessionNamespace ?? "router";
    const sessionId = sanitizeSessionId(
      sessionNamespace === "conversation"
        ? `flow-system-conversation-v1-${this.config.ownerUserId}-${message.conversation_id}`
        : sessionNamespace === "operator"
          ? `flow-system-operator-v1-${this.config.ownerUserId}-${message.conversation_id}`
          : `flow-system-router-v2-${this.config.ownerUserId}-${message.conversation_id}`,
    );
    const environment = {
      ...process.env,
      PATH: [path.dirname(openClawBin), process.env.PATH ?? ""]
        .filter((value) => value.length > 0)
        .join(path.delimiter),
    };
    const timeoutMs = Math.max((this.config.openClawTimeoutSeconds + 15) * 1000, 30_000);
    const startedAt = Date.now();

    const { stdout, stderr } = await execBufferedCommand(
      openClawBin,
      [
        "agent",
        "--session-id",
        sessionId,
        "--message",
        prompt,
        "--json",
        "--timeout",
        String(this.config.openClawTimeoutSeconds),
      ],
      {
        cwd: this.config.flowRoot,
        env: environment,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
    );

    const reply = extractOpenClawReplyText(stdout, stderr);

    this.logger.info("OpenClaw reply generated", {
      conversationId: message.conversation_id,
      messageId: message.message_id,
      sessionId,
      durationMs: Date.now() - startedAt,
      replyChars: reply.length,
    });

    return reply;
  }

  private upsertLocalTask(task: z.infer<typeof remoteTaskSchema>, taskRoot: string, outputDir: string): void {
    const now = nowIso();
    this.db.connection.prepare(`
      insert into local_tasks (
        task_id, project_id, project_name, workflow_id, step_id, task_title, task_type, assignee_display_name,
        status, progress_percent, summary, deadline, local_task_path, output_path, attachment_manifest_json,
        created_at, updated_at, last_event_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(task_id) do update set
        project_id = excluded.project_id,
        project_name = excluded.project_name,
        workflow_id = excluded.workflow_id,
        step_id = excluded.step_id,
        task_title = excluded.task_title,
        task_type = excluded.task_type,
        assignee_display_name = excluded.assignee_display_name,
        summary = excluded.summary,
        deadline = excluded.deadline,
        local_task_path = excluded.local_task_path,
        output_path = excluded.output_path,
        attachment_manifest_json = excluded.attachment_manifest_json,
        updated_at = excluded.updated_at
    `).run(
      task.task_id,
      task.project_id,
      task.project_name ?? task.project_id,
      task.workflow_id,
      task.step_id,
      task.task_title,
      task.task_type,
      task.assignee_display_name ?? this.getOwnerDisplayName(),
      this.existingTaskStatus(task.task_id) ?? "delivered",
      task.progress_percent ?? 0,
      task.summary,
      task.deadline,
      taskRoot,
      outputDir,
      JSON.stringify(task.attachment_manifest),
      now,
      now,
      now,
    );
  }

  private replaceChecklist(taskId: string, checklist: z.infer<typeof remoteChecklistSchema>[]): void {
    this.db.connection.prepare("delete from local_checklist_items where task_id = ?").run(taskId);
    const insert = this.db.connection.prepare(`
      insert into local_checklist_items (
        checklist_item_id, task_id, item_order, item_title, item_description, status,
        completed_at, completed_by, source, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of checklist) {
      insert.run(
        item.checklist_item_id ?? item.checklistItemId,
        taskId,
        item.item_order ?? item.itemOrder ?? 0,
        item.item_title ?? item.itemTitle ?? "",
        item.item_description ?? item.itemDescription ?? null,
        item.status,
        item.completed_at ?? item.completedAt ?? null,
        item.completed_by ?? item.completedBy ?? null,
        item.source,
        item.created_at ?? item.createdAt ?? nowIso(),
        item.updated_at ?? item.updatedAt ?? nowIso(),
      );
    }
  }

  private async enqueueJson(endpoint: string, payload: Record<string, unknown>, method = "PATCH"): Promise<void> {
    const now = nowIso();
    this.db.connection.prepare(`
      insert into sync_outbox (
        request_id, endpoint, method, payload_json, status, retry_count, next_retry_at, last_error, created_at, updated_at
      ) values (?, ?, ?, ?, 'pending', 0, ?, null, ?, ?)
      on conflict(request_id) do nothing
    `).run(String(payload.request_id), endpoint, method, JSON.stringify(payload), now, now, now);
  }

  private async flushOutbox(): Promise<void> {
    if (!this.agentId) {
      return;
    }
    const due = this.db.connection.prepare(`
      select * from sync_outbox
      where status = 'pending' and next_retry_at <= ?
      order by created_at asc
      limit 20
    `).all(nowIso()) as OutboxRow[];
    for (const row of due) {
      try {
        await this.withAgentAuthRetry(async () => this.client.sendJson(row.endpoint, row.method, JSON.parse(row.payload_json) as Record<string, unknown>));
        this.db.connection.prepare("update sync_outbox set status = 'done', updated_at = ? where id = ?").run(nowIso(), row.id);
      } catch (error) {
        const retryCount = row.retry_count + 1;
        const nextRetryAt =
          retryCount === 1 ? addMinutes(nowIso(), 0.5)
            : retryCount === 2 ? addMinutes(nowIso(), 2)
            : retryCount === 3 ? addMinutes(nowIso(), 10)
            : retryCount === 4 ? addMinutes(nowIso(), 30)
            : addMinutes(nowIso(), 120);
        this.db.connection.prepare(`
          update sync_outbox
          set retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ?
          where id = ?
        `).run(retryCount, nextRetryAt, String(error), nowIso(), row.id);
        this.logger.warn("Outbox delivery failed", { endpoint: row.endpoint, requestId: row.request_id, error: String(error) });
      }
    }
  }

  private pendingOutboxCount(): number {
    const row = this.db.connection.prepare("select count(*) as count from sync_outbox where status = 'pending'").get() as { count: number };
    return row.count;
  }

  private requireTask(taskId: string): LocalTaskRow {
    const task = this.findTask(taskId);
    if (!task) {
      throw new Error(`Unknown local task: ${taskId}`);
    }
    return task;
  }

  private findTask(taskId: string): LocalTaskRow | undefined {
    return this.db.connection.prepare("select * from local_tasks where task_id = ?").get(taskId) as LocalTaskRow | undefined;
  }

  private existingTaskStatus(taskId: string): string | undefined {
    const row = this.db.connection.prepare("select status from local_tasks where task_id = ?").get(taskId) as { status: string } | undefined;
    return row?.status;
  }

  private updateTaskStatus(taskId: string, status: string): void {
    this.db.connection.prepare(`
      update local_tasks
      set status = ?, updated_at = ?, last_event_at = ?
      where task_id = ?
    `).run(status, nowIso(), nowIso(), taskId);
  }

  private getChecklist(taskId: string): Array<Record<string, unknown>> {
    return this.db.connection.prepare(`
      select * from local_checklist_items
      where task_id = ?
      order by item_order asc
    `).all(taskId) as Array<Record<string, unknown>>;
  }

  private getOwnerDisplayName(): string {
    return this.readLocalSetting("owner_display_name") ?? this.config.ownerUserId;
  }

  private getPlatformWebOrigin(): string {
    return this.readLocalSetting("platform_web_origin") ?? normalizeOrigin(this.config.platformWebOrigin);
  }

  private readOverlayUiState(): OverlayUiState {
    const statePath = path.join(this.config.overlayDataRoot, "state.json");
    if (!fs.existsSync(statePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8")) as OverlayUiState;
    } catch {
      return {};
    }
  }

  private getOverlayUnreadState(): { count: number; last_openclaw_message_at: string | null } {
    const row = this.db.connection.prepare(`
      select created_at
      from local_conversation_messages
      where author_kind = 'openclaw'
      order by created_at desc
      limit 1
    `).get() as { created_at: string } | undefined;
    const lastReadAt = this.readOverlayUiState().last_read_conversation_message_at ?? null;
    const unreadRow = this.db.connection.prepare(`
      select count(*) as count
      from local_conversation_messages
      where author_kind = 'openclaw'
    `).get() as { count: number };

    if (!lastReadAt) {
      return {
        count: unreadRow.count,
        last_openclaw_message_at: row?.created_at ?? null,
      };
    }

    const filteredUnreadRow = this.db.connection.prepare(`
      select count(*) as count
      from local_conversation_messages
      where author_kind = 'openclaw' and created_at > ?
    `).get(lastReadAt) as { count: number };
    return {
      count: filteredUnreadRow.count,
      last_openclaw_message_at: row?.created_at ?? null,
    };
  }

  private computeOverlayOrbState(unreadCount: number): "idle" | "unread" | "processing" | "error" {
    if (!this.agentId || !isOpenClawReady(this.openClawConnector.getStatus())) {
      return "error";
    }

    if (unreadCount > 0) {
      return "unread";
    }

    const pendingRow = this.db.connection.prepare(`
      select count(*) as count
      from local_conversation_messages
      where sync_status in ('pending', 'processing')
    `).get() as { count: number };
    if (pendingRow.count > 0) {
      return "processing";
    }

    return "idle";
  }

  private async isPlatformWebReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    timeout.unref();
    try {
      const response = await fetch(this.getPlatformWebOrigin(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private readAgentState(key: string): string | undefined {
    const row = this.db.connection.prepare("select value from agent_state where key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private readLocalSetting(key: string): string | undefined {
    const row = this.db.connection.prepare("select value from local_settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private writeLocalSetting(key: string, value: string): void {
    this.db.connection.prepare(`
      insert into local_settings (key, value) values (?, ?)
      on conflict(key) do update set value = excluded.value
    `).run(key, value);
  }

  private clearLocalSetting(key: string): void {
    this.db.connection.prepare("delete from local_settings where key = ?").run(key);
  }

  private writeAgentState(key: string, value: string): void {
    this.db.connection.prepare(`
      insert into agent_state (key, value) values (?, ?)
      on conflict(key) do update set value = excluded.value
    `).run(key, value);
  }

  private clearAgentState(key: string): void {
    this.db.connection.prepare("delete from agent_state where key = ?").run(key);
  }

  private clearAgentCredentials(): void {
    this.agentId = undefined;
    this.agentToken = undefined;
    this.clearAgentState("agent_id");
    this.clearAgentState("agent_token");
    this.clearAgentState("owner_user_id");
    this.client.setCredentials({
      agentId: undefined,
      agentToken: undefined,
    });
  }

  private async reRegisterAgent(): Promise<void> {
    if (this.reauthPromise) {
      return this.reauthPromise;
    }
    this.reauthPromise = (async () => {
      this.logger.warn("Agent credentials were rejected. Re-registering.");
      this.clearAgentCredentials();
      await this.ensureRegistered();
      await this.syncRemoteAgentConfig();
    })();
    try {
      await this.reauthPromise;
    } finally {
      this.reauthPromise = null;
    }
  }

  private async withAgentAuthRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof PlatformRequestError) || error.status !== 401) {
        throw error;
      }
      await this.reRegisterAgent();
      return operation();
    }
  }

  private moveToRecovery(sourcePath: string, taskId: string): void {
    if (!fs.existsSync(sourcePath)) {
      return;
    }
    const recoveryDir = path.join(this.config.recoveryRoot, `${taskId}-${Date.now()}`);
    ensureDir(recoveryDir);
    fs.renameSync(sourcePath, path.join(recoveryDir, path.basename(sourcePath)));
  }

  private async cleanupRecovery(): Promise<void> {
    ensureDir(this.config.recoveryRoot);
    const cutoff = Date.now() - this.config.recoveryRetentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(this.config.recoveryRoot, { withFileTypes: true })) {
      const fullPath = path.join(this.config.recoveryRoot, entry.name);
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs < cutoff) {
        this.logger.info("Removing expired recovery data", { path: fullPath });
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  private async backupDatabase(): Promise<void> {
    ensureDir(this.config.backupsRoot);
    if (!fs.existsSync(this.config.databasePath)) {
      return;
    }
    const backupPath = path.join(this.config.backupsRoot, `agent-${new Date().toISOString().slice(0, 10)}.sqlite`);
    fs.copyFileSync(this.config.databasePath, backupPath);
    const backups = fs.readdirSync(this.config.backupsRoot).sort();
    while (backups.length > 7) {
      const oldest = backups.shift();
      if (oldest) {
        fs.rmSync(path.join(this.config.backupsRoot, oldest), { force: true });
      }
    }
  }
}
