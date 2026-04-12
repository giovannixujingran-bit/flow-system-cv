import type {
  AgentStatus,
  EventEnvelope,
  FileObject,
  RiskLevel,
  TaskDeliveryRequest,
  TaskStatus,
  WorkflowTemplate,
} from "@flow-system/flow-protocol";

export type UserRecord = {
  userId: string;
  username: string;
  passwordHash: string;
  role: "admin" | "owner" | "member";
  displayName: string;
  status?: "active" | "disabled";
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
};

export type SessionRecord = {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
  createdAt: string;
};

export type BootstrapTokenRecord = {
  bootstrapTokenId: string;
  tokenHash: string;
  tokenPlaintext: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

export type AgentRecord = {
  agentId: string;
  agentName: string;
  machineName: string;
  ownerUserId: string;
  ipAddress: string;
  localUiPort: number;
  status: AgentStatus;
  runtimeVersion: string;
  osType: "windows" | "linux" | "macos";
  capabilities: string[];
  tokenHash: string;
  tokenPreview: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentManifestItem = {
  file_id: string;
  file_name: string;
  content_type: string;
  sha256: string;
  size_bytes: number;
};

export type ProjectRecord = {
  projectId: string;
  projectCode: string;
  projectName: string;
  description: string;
  department: string;
  ownerUserId: string;
  participantUserIds: string[];
  projectType: string;
  status: string;
  priority: string;
  startDate?: string;
  dueDate?: string;
  currentStage: string;
  completionRate: number;
  attachmentManifest: AttachmentManifestItem[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRecord = {
  workflowId: string;
  projectId: string;
  workflowTemplateId: string;
  templateVersion: number;
  workflowName: string;
  workflowType: string;
  status: TaskStatus;
  currentStepId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistRecord = {
  checklistItemId: string;
  taskId: string;
  itemOrder: number;
  itemTitle: string;
  itemDescription?: string;
  status: "pending" | "in_progress" | "done";
  completedAt?: string;
  completedBy?: string;
  source: "template" | "task_type" | "default";
  createdAt: string;
  updatedAt: string;
};

export type TaskRecord = {
  taskId: string;
  requestId: string;
  projectId: string;
  workflowId: string;
  workflowTemplateId?: string;
  templateVersion?: number;
  stepId: string;
  taskTitle: string;
  taskType: string;
  senderUserId: string;
  assigneeUserId: string;
  assigneeAgentId: string;
  priority: TaskDeliveryRequest["priority"];
  status: TaskStatus;
  progressPercent: number;
  summary: string;
  constraints: string[];
  deliverables: string[];
  deadline: string;
  receivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  lastEventAt: string;
  riskLevel: RiskLevel;
  localTaskPath?: string;
  outputPath?: string;
  attachmentManifest: AttachmentManifestItem[];
  createdAt: string;
  updatedAt: string;
};

export type EventRecord = EventEnvelope & {
  eventId: string;
  receivedAt: string;
};

export type FileRecord = FileObject & {
  allowedUploader: "user" | "agent";
  createdById: string;
  project_id?: string;
};

export type HeartbeatRecord = {
  agentId: string;
  occurredAt: string;
  status: AgentStatus;
  currentLoad: number;
  lastSeenTasks: number;
};

export type AgentReleaseRecord = {
  version: string;
  notes: string;
  packageRelPath: string;
  packageSha256: string;
  packageSizeBytes: number;
  minimumRuntimeVersion?: string;
  publishedByUserId: string;
  publishedAt: string;
  isCurrent?: boolean;
};

export type ConversationRecord = {
  conversationId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageRecord = {
  messageId: string;
  conversationId: string;
  ownerUserId: string;
  messageType: "user_message" | "sender_ack" | "incoming_delivery" | "delivery_receipt" | "openclaw_reply";
  authorKind: "user" | "openclaw";
  body: string;
  sourceUserId?: string;
  sourceDisplayName?: string;
  targetUserId?: string;
  targetAgentId?: string;
  syncStatus: "none" | "pending" | "synced" | "processing" | "replied" | "failed";
  syncDetail?: string;
  deliveredToAgentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpenClawTaskProgressStepRecord = {
  stepIndex: number;
  stepLabel: string;
  status: "completed" | "active" | "pending";
  actorUserId?: string;
  actorDisplayName?: string;
  actorAvatarText?: string;
  happenedAt?: string;
  source: "openclaw" | "user" | "system";
};

export type OpenClawTaskProgressRecord = {
  taskId: string;
  linkedConversationId?: string;
  linkedMessageIds: string[];
  steps: OpenClawTaskProgressStepRecord[];
  activeStepIndex: number;
  currentStatusLabel: string;
  lastDecisionSummary: string;
  updatedAt: string;
};

export type RiskRecordStored = {
  riskRecordId: string;
  taskId: string;
  riskCode: "overdue" | "stale" | "agent-offline";
  riskLevel: RiskLevel;
  details: string;
  detectedAt: string;
};

export type IdempotencyRecord = {
  key: string;
  endpoint: string;
  actorId: string;
  response: unknown;
  createdAt: string;
};

export type AppState = {
  users: Map<string, UserRecord>;
  usersByUsername: Map<string, UserRecord>;
  sessions: Map<string, SessionRecord>;
  bootstrapTokens: Map<string, BootstrapTokenRecord>;
  agents: Map<string, AgentRecord>;
  projects: Map<string, ProjectRecord>;
  workflowTemplates: Map<string, WorkflowTemplate>;
  workflows: Map<string, WorkflowRecord>;
  tasks: Map<string, TaskRecord>;
  checklist: Map<string, ChecklistRecord>;
  taskChecklistIndex: Map<string, string[]>;
  events: Map<string, EventRecord>;
  taskEventIndex: Map<string, string[]>;
  fileObjects: Map<string, FileRecord>;
  heartbeats: Map<string, HeartbeatRecord>;
  conversations: Map<string, ConversationRecord>;
  conversationMessages: Map<string, ConversationMessageRecord>;
  conversationMessageIndex: Map<string, string[]>;
  openClawTaskProgress: Map<string, OpenClawTaskProgressRecord>;
  risks: Map<string, RiskRecordStored>;
  idempotency: Map<string, IdempotencyRecord>;
  agentReleases: Map<string, AgentReleaseRecord>;
  currentAgentRelease?: AgentReleaseRecord;
};
