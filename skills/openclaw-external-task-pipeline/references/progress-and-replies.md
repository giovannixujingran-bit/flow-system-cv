# Progress And Replies

The external-task pipeline uses a stable 5-stage structure. The structure does not change per task instance; only stage status, `current_text`, timestamps, and optional note change.

## Stage taxonomy

| Index | Code | Label | Purpose |
| --- | --- | --- | --- |
| 1 | `intake` | 任务接入 | 已收到并完成初步识别 |
| 2 | `collecting-material` | 资料收集 | 正在聚合输入资料、网页、附件、上下文 |
| 3 | `synthesizing` | 方向归纳 | 正在提炼重点、分类信息、形成结论 |
| 4 | `structuring-output` | 输出整理 | 正在把结果整理成目标交付格式 |
| 5 | `awaiting-confirmation` | 确认交付 | 已形成初步结果，等待确认或收尾 |

## Progress copy rules

- Current progress text lives only in `TaskProgressItem.current_text`.
- Do not prefix the text with stage numbers; the UI already has `stage_index`.
- Prefer stable present-progressive copy for active stages.
- Prefer concise product-style wording, not parser- or model-oriented language.
- Keep wording reusable across task kinds. The variable parts should come from `subject_label` and `deliverable_label`.

## Recommended active-stage templates

- Stage 1: `已完成任务识别`
- Stage 2:
  - `正在整理 {subject_label} 相关资料`
  - `正在找 {subject_label} 素材`
- Stage 3:
  - `正在归纳 {subject_label} 方向与重点主题`
  - `正在提炼 {subject_label} 关键结论`
- Stage 4:
  - `正在整理 {deliverable_label} 输出结构`
  - `正在完善 {deliverable_label} 结果内容`
- Stage 5:
  - `已完成初步总结，等待确认`
  - `已形成初稿，等待确认`

## Pending and completed states

- Completed stages keep a short completed sentence, for example `已完成任务识别`
- Pending stages default to `待开始`
- Only one stage is `active` at a time
- A progress update advances the active stage by status plus `current_text`; it does not rebuild the whole structure from scratch

## Reply snapshot rules

Every intake or progress update must produce and persist a new `AssistantReplySnapshot`.

```ts
type AssistantReplySnapshot = {
  revision: number;
  body: string;
  current_stage_text: string;
  next_step_text: string;
  created_at: string;
  source: "intake" | "progress-update";
};
```

Rules:

- `revision` starts at `1` on intake and increments by `1` on each progress update
- `current_stage_text` is semantically aligned with the active progress item, but should not be a verbatim copy if a more natural summary is available
- `next_step_text` describes the next expected move, not the current move
- `body` is 1-2 natural Chinese sentences suitable for direct conversation display

## Reply wording template

Use this structure unless the task kind needs a stronger variant:

`已收到任务。我已识别到本次目标是{goal}。当前正在{current_stage_text}，下一步将{next_step_text}。`

Guidelines:

- Mention the task goal once
- Mention the current stage in human language
- Mention the immediate next step
- Avoid exact repetition of `current_text` when that would sound robotic

## Update behavior

For `POST /api/v1/external-tasks/:taskId/progress`:

- Resolve stage code and stage label from `stage_index`
- Update exactly one `TaskProgressItem` to `active`
- Mark earlier stages `completed`
- Mark later stages `pending`
- Replace the active stage `current_text` with the request payload text
- Generate a fresh reply snapshot from the new active stage and append it to `reply_history`
- Emit a task progress event after the companion record is updated
