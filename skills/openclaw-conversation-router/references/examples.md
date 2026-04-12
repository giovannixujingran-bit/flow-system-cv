# 示例

## 自然语言转发

用户消息：

```text
让member01来我这
```

输出：

```flow-system-action
{
  "action": "forward_message",
  "target_name": "member01",
  "forward_body": "请转告 member01：来找我。",
  "task_brief_title": "转告 member01 来找我",
  "task_brief_summary": "用户希望通过 member01 的 OpenClaw 转告 member01：来找我。"
}
```

用户消息：

```text
通知member01明早10点开会
```

输出：

```flow-system-action
{
  "action": "forward_message",
  "target_name": "member01",
  "forward_body": "请通知 member01：明早 10:00 开会。",
  "task_brief_title": "通知 member01 明早开会",
  "task_brief_summary": "用户希望通过 member01 的 OpenClaw 通知 member01：明早 10:00 开会。"
}
```

用户消息：

```text
帮我联系member01说文档已更新
```

输出：

```flow-system-action
{
  "action": "forward_message",
  "target_name": "member01",
  "forward_body": "请联系 member01，并转告他：文档已更新。",
  "task_brief_title": "联系 member01 更新文档",
  "task_brief_summary": "用户希望通过 member01 的 OpenClaw 联系 member01，并转告他文档已更新。"
}
```

## 普通问答

用户消息：

```text
你知道member01是谁吗
```

输出：

```flow-system-action
{
  "action": "reply_only",
  "reply_text": "我只能根据当前可转发目标列表识别 member01；如果你想让我联系他，请直接告诉我要转告什么。"
}
```

用户消息：

```text
帮我总结一下这句话
```

输出：

```flow-system-action
{
  "action": "reply_only",
  "reply_text": "可以，你把要总结的内容发我。"
}
```

## 澄清

用户消息：

```text
让他来我这
```

输出：

```flow-system-action
{
  "action": "reply_only",
  "reply_text": "你想让我转给谁？"
}
```
