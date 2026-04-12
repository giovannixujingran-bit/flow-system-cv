# Examples

## Example 1: Initial intake

### Incoming request

```ts
const request: ExternalTaskIntakeRequest = {
  request_id: "req_external_trend_001",
  target_user_id: "user_member",
  payload: {
    source: {
      channel: "openclaw-node",
      node_id: "node-fashion-research-01",
      user_id: "user_owner",
      user_display_name: "项目负责人A",
      conversation_id: "conv_user_member",
      message_id: "msg_seed_001",
    },
    title: "25-26 春夏内衣趋势总结",
    body: "请根据以下网页资料，整理 25-26 春夏内衣流行趋势，输出为 Excel，今天晚上 8 点前给我。",
    deadline: "2026-03-14T20:00:00+08:00",
    links: [
      { url: "https://example-a.com", kind: "reference" },
      { url: "https://example-b.com", kind: "reference" },
      { url: "https://example-c.com", kind: "reference" },
    ],
    expected_output: { primary: "excel" },
    raw_payload: {},
  },
};
```

### Normalized task

```ts
const normalized: NormalizedTask = {
  task_kind: "trend-summary",
  title: "25-26 春夏内衣趋势总结",
  summary: "基于给定网页资料梳理 25-26 春夏内衣趋势，并输出 Excel 结果。",
  source_label: "node-fashion-research-01 / 项目负责人A",
  due_at: "2026-03-14T20:00:00+08:00",
  deliverable: {
    primary: "excel",
    format_hint: "趋势整理表",
  },
  inputs: {
    links: [
      { url: "https://example-a.com", label: "资料 1", kind: "reference" },
      { url: "https://example-b.com", label: "资料 2", kind: "reference" },
      { url: "https://example-c.com", label: "资料 3", kind: "reference" },
    ],
    attachments: [],
    context_blocks: [],
  },
  current_stage: {
    stage_index: 2,
    stage_code: "collecting-material",
    stage_label: "资料收集",
  },
  suggested_steps: [
    "整理网页资料并提取趋势线索",
    "归纳趋势方向与重点主题",
    "整理 Excel 输出结构",
  ],
  ui_hints: {
    subject_label: "25-26 春夏内衣趋势",
    due_label: "今天 20:00 前",
    deliverable_label: "Excel",
  },
};
```

### Progress items

```ts
const progressItems: TaskProgressItem[] = [
  {
    stage_index: 1,
    stage_code: "intake",
    stage_label: "任务接入",
    status: "completed",
    current_text: "已完成任务识别",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
  {
    stage_index: 2,
    stage_code: "collecting-material",
    stage_label: "资料收集",
    status: "active",
    current_text: "正在找 25-26 春夏内衣趋势素材",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
  {
    stage_index: 3,
    stage_code: "synthesizing",
    stage_label: "方向归纳",
    status: "pending",
    current_text: "待开始",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
  {
    stage_index: 4,
    stage_code: "structuring-output",
    stage_label: "输出整理",
    status: "pending",
    current_text: "待开始",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
  {
    stage_index: 5,
    stage_code: "awaiting-confirmation",
    stage_label: "确认交付",
    status: "pending",
    current_text: "待开始",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
];
```

### Reply snapshot

```ts
const reply: AssistantReplySnapshot = {
  revision: 1,
  body: "已收到任务。我已识别到本次目标是基于提供资料梳理 25-26 春夏内衣趋势，并输出为 Excel。当前正在整理相关趋势素材，下一步将进入方向归纳和表格结构整理。",
  current_stage_text: "整理相关趋势素材",
  next_step_text: "进入方向归纳和表格结构整理",
  created_at: "2026-03-14T11:00:00+08:00",
  source: "intake",
};
```

### UI projection

```ts
const uiTask: UITaskModel = {
  task_id: "task_ext_001",
  title: "25-26 春夏内衣趋势总结",
  summary: "基于给定网页资料梳理 25-26 春夏内衣趋势，并输出 Excel 结果。",
  source_label: "node-fashion-research-01 / 项目负责人A",
  due_label: "今天 20:00 前",
  deliverable_label: "Excel",
  materials: {
    links: [
      { url: "https://example-a.com", label: "资料 1" },
      { url: "https://example-b.com", label: "资料 2" },
      { url: "https://example-c.com", label: "资料 3" },
    ],
    attachments: [],
  },
  current_status_label: "正在找 25-26 春夏内衣趋势素材",
  progress_items: progressItems,
  assistant_reply: reply,
};
```

## Example 2: Progress update

### Update request

```ts
const update: ExternalTaskProgressUpdateRequest = {
  request_id: "req_external_trend_001_progress_1",
  stage_index: 3,
  current_text: "正在归纳趋势方向与重点主题",
  occurred_at: "2026-03-14T13:20:00+08:00",
  source: "agent",
};
```

### Updated progress items

```ts
const updatedProgressItems: TaskProgressItem[] = [
  {
    stage_index: 1,
    stage_code: "intake",
    stage_label: "任务接入",
    status: "completed",
    current_text: "已完成任务识别",
    updated_at: "2026-03-14T11:00:00+08:00",
  },
  {
    stage_index: 2,
    stage_code: "collecting-material",
    stage_label: "资料收集",
    status: "completed",
    current_text: "已完成素材收集",
    updated_at: "2026-03-14T13:20:00+08:00",
  },
  {
    stage_index: 3,
    stage_code: "synthesizing",
    stage_label: "方向归纳",
    status: "active",
    current_text: "正在归纳趋势方向与重点主题",
    updated_at: "2026-03-14T13:20:00+08:00",
  },
  {
    stage_index: 4,
    stage_code: "structuring-output",
    stage_label: "输出整理",
    status: "pending",
    current_text: "待开始",
    updated_at: "2026-03-14T13:20:00+08:00",
  },
  {
    stage_index: 5,
    stage_code: "awaiting-confirmation",
    stage_label: "确认交付",
    status: "pending",
    current_text: "待开始",
    updated_at: "2026-03-14T13:20:00+08:00",
  },
];
```

### Updated reply snapshot

```ts
const updatedReply: AssistantReplySnapshot = {
  revision: 2,
  body: "任务进展已更新。当前已进入趋势方向归纳阶段，正在提炼重点主题，下一步会整理 Excel 的输出结构并准备初版结果。",
  current_stage_text: "进入趋势方向归纳阶段并提炼重点主题",
  next_step_text: "整理 Excel 输出结构并准备初版结果",
  created_at: "2026-03-14T13:20:00+08:00",
  source: "progress-update",
};
```

## Example guardrails

- The task kind is `trend-summary` here, but the same shape must also support research, drafting, data collection, and generic analysis.
- The progress structure stays 5-stage even as wording changes.
- The reply snapshot is persisted and revisioned; it is not reconstructed only from the current UI render pass.
