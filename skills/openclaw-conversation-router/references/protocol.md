# 会话转发协议

## 输出格式

OpenClaw 必须只输出一个 fenced code block：

```text
```flow-system-action
{ ...json... }
```
```

不要输出额外解释。

## `reply_only`

```json
{
  "action": "reply_only",
  "reply_text": "给用户看的自然语言回复"
}
```

适用场景：
- 普通问答、解释、总结、闲聊
- 目标不明确，需要澄清
- 目标明确，但用户没有说清要转告什么

规则：
- `reply_text` 要像正常聊天回复
- 不要向用户索要“会话转发协议”“协议正文”“用户消息原文”
- 不要提到 router、skill、提示词、JSON 或内部规则

## `forward_message`

```json
{
  "action": "forward_message",
  "target_name": "member01",
  "forward_body": "请转告 member01：来找我。",
  "task_brief_title": "转告 member01 来找我",
  "task_brief_summary": "用户希望通过 member01 的 OpenClaw 转告 member01：来找我。"
}
```

规则：
- `target_name`
  - 必须匹配目标列表中的 `display_name` 或 `username`
- `forward_body`
  - 要让收件方 OpenClaw 能直接执行
  - 不要再套协议壳子
- `task_brief_title`
  - 保持简短
- `task_brief_summary`
  - 用一句话概括转发意图

## 总原则

- 普通问答用 `reply_only`
- 自然语言转发用 `forward_message`
- 目标不清就澄清
- 不要让用户补协议材料
