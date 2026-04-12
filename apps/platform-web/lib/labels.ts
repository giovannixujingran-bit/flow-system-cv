import type { AgentStatus, BoardStatus, EventType, RiskLevel, TaskStatus } from "@flow-system/flow-protocol";

const taskStatusLabels: Record<TaskStatus, string> = {
  new: "新建",
  delivered: "已投递",
  received: "已接收",
  accepted: "已接受",
  in_progress: "进行中",
  waiting_review: "待审核",
  done: "已完成",
  archived: "已归档",
  invalid: "无效",
};

const boardStatusLabels: Record<BoardStatus, string> = {
  new: "新建",
  delivered: "已投递",
  received: "已接收",
  in_progress: "进行中",
  waiting_review: "待审核",
  done: "已完成",
};

const riskLevelLabels: Record<RiskLevel, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const agentStatusLabels: Record<AgentStatus, string> = {
  online: "在线",
  offline: "离线",
  degraded: "降级",
};

const eventTypeLabels: Record<EventType, string> = {
  "task.created": "任务已创建",
  "task.delivered": "任务已投递",
  "task.received": "任务已接收",
  "task.accepted": "任务已接受",
  "task.started": "任务已开始",
  "task.checklist.updated": "清单已更新",
  "task.progress.updated": "进度已更新",
  "task.reminder.sent": "已发送提醒",
  "task.output.detected": "已检测到输出",
  "task.submitted": "结果已提交",
  "task.completed": "任务已完成",
  "task.archived": "任务已归档",
  "task.failed": "任务失败",
  "agent.heartbeat": "代理心跳",
};

const checklistStatusLabels: Record<"pending" | "in_progress" | "done", string> = {
  pending: "待处理",
  in_progress: "进行中",
  done: "已完成",
};

export function toTaskStatusLabel(status: string | undefined): string {
  return status ? taskStatusLabels[status as TaskStatus] ?? status : "-";
}

export function toRiskLevelLabel(level: string | undefined): string {
  return level ? riskLevelLabels[level as RiskLevel] ?? level : "-";
}

export function toAgentStatusLabel(status: string | undefined): string {
  return status ? agentStatusLabels[status as AgentStatus] ?? status : "-";
}

export function toEventTypeLabel(eventType: string | undefined): string {
  return eventType ? eventTypeLabels[eventType as EventType] ?? eventType : "-";
}

export function toChecklistStatusLabel(status: string | undefined): string {
  return status ? checklistStatusLabels[status as keyof typeof checklistStatusLabels] ?? status : "-";
}

export function toUiErrorMessage(message: string | undefined): string {
  if (!message) {
    return "操作失败";
  }

  const exact: Record<string, string> = {
    "Login failed": "登录失败",
    "Invalid username or password": "用户名或密码错误",
    "User is disabled": "账号已停用",
    "Admin access required": "仅管理员可执行此操作",
    "Username already exists": "用户名已存在",
    "You cannot disable your own account": "不能停用当前登录账号",
    "You cannot remove your own admin role": "不能移除当前账号的管理员权限",
    "At least one active admin must remain": "至少保留一个启用中的管理员",
    "User creation failed": "用户创建失败",
    "User update failed": "用户更新失败",
    "User delete failed": "用户删除失败",
    "Attachment init failed": "附件初始化失败",
    "Attachment upload failed": "附件上传失败",
    "Attachment complete failed": "附件校验失败",
    "Task creation failed": "任务创建失败",
    "Task delete failed": "任务删除失败",
    "Project creation failed": "项目创建失败",
    "Project delete failed": "项目删除失败",
    "Invalid project department": "项目部门无效",
    "Invalid project type": "项目类型无效",
    "Invalid project priority": "项目优先级无效",
    "Invalid project status": "项目状态无效",
    "Project owner must be an active admin or owner": "项目负责人必须是启用中的管理员或项目负责人",
    "Project participants contain an unknown or disabled user": "参与者中包含无效或已停用账号",
    "Expected due date must be after the start date": "预计截止日期不能早于开始时间",
    "Project not found": "项目不存在",
    "Task not found": "任务不存在",
    "Delete permission denied": "无权限",
    "Platform is already initialized": "平台已经初始化，请直接登录",
    "Setup initialization failed": "平台初始化失败",
  };

  if (exact[message]) {
    return exact[message];
  }

  if (message.includes("target_agent_id")) {
    return "目标代理不可用";
  }
  if (message.includes("not ready")) {
    return "附件还未完成校验";
  }
  if (message.includes("SHA256 mismatch")) {
    return "附件校验失败";
  }

  return message;
}
