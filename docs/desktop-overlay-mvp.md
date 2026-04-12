# Desktop Overlay MVP

## 定位

桌面悬浮球属于本机 Agent 生态的一部分，只消费本机 `local-agent` 的本地接口，不直接访问平台 API，也不依赖浏览器登录态。

当前层次固定为：

- `apps/desktop-overlay`
  - Electron 宿主、悬浮球窗口、托盘菜单、桌面 UI
- `packages/local-overlay-contracts`
  - Electron 和 `local-agent` 之间的共享本地契约
- `apps/local-agent`
  - overlay 数据聚合层和本地接口提供方

## 本地接口

悬浮球只使用这些接口：

- `GET /api/overlay/bootstrap`
- `GET /api/overlay/health`
- `GET /api/overlay/conversations`
- `POST /api/overlay/conversations/messages`
- `GET /api/overlay/tasks/current`
- `POST /api/overlay/tasks/:taskId/open`

## 数据来源

- 会话：
  - 来自本机 `local_conversation_messages`
  - 消息发送后仍通过现有会话链路同步到平台
- 当前任务：
  - 来自本机 `local_tasks`
  - 过滤逻辑和网页里的“当前任务”保持一致
- 球体状态：
  - 来自 `bootstrap` 聚合结果
  - 当前固定为 `idle / unread / processing / error`

## 本地持久化

overlay 自身状态不回写平台，只存本机：

- `FlowCard/overlay-data/state.json`

当前保存项：

- 窗口位置
- 最后打开的 tab
- 最近一次已读会话时间
- 最近一次打开的平台地址

## 启动入口

- `start-flow-overlay.cmd`
- `stop-flow-overlay.cmd`
- `scripts/start-flow-overlay.ps1`
- `scripts/stop-flow-overlay.ps1`

这些脚本负责：

- 准备 overlay 运行目录
- 绑定本机 `local-agent` 端口
- 注册 Windows 登录自启任务
- 启动 Electron overlay 进程

## 修改边界

后续如果只改视觉和交互，优先改：

- `apps/desktop-overlay/src/index.html`
- `apps/desktop-overlay/src/styles.css`
- `apps/desktop-overlay/src/renderer.ts`

如果只改球体展开、吸附、窗口尺寸，优先改：

- `apps/desktop-overlay/src/window-layout.ts`
- `apps/desktop-overlay/src/main.ts`

如果只改本地数据结构或新增字段，优先改：

- `packages/local-overlay-contracts/src/schemas.ts`
- `apps/local-agent/src/agent.ts`
- `apps/local-agent/src/http-server.ts`

不要直接让 overlay 去请求平台 API。桌面端和平台之间的唯一边界仍然是本机 `local-agent`。
