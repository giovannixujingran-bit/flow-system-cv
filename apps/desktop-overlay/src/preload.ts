import { contextBridge, ipcRenderer } from "electron";
import {
  overlayBootstrapSchema,
  overlayConversationsResponseSchema,
  overlayConversationSendSchema,
  overlayHealthSchema,
  overlayOpenTaskResultSchema,
  overlayTaskListResponseSchema,
} from "@flow-system/local-overlay-contracts";

const localUiPort = Number(process.env.FLOW_AGENT_UI_PORT ?? 38500);
const baseUrl = `http://127.0.0.1:${localUiPort}`;

async function requestJson<T>(
  pathName: string,
  init?: RequestInit,
  parser?: (value: unknown) => T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${pathName}`, {
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error("无法连接本机 Agent，请先确认本机 Agent 已启动。");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 404 && pathName.startsWith("/api/overlay/")) {
      throw new Error("本机 Agent 尚未提供悬浮球接口，请先重启本机 Agent。");
    }
    throw new Error(text || `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await response.json();
  return parser ? parser(payload) : (payload as T);
}

contextBridge.exposeInMainWorld("overlayBridge", {
  localUiPort,
  getBootstrap: () => requestJson("/api/overlay/bootstrap", undefined, (value) => overlayBootstrapSchema.parse(value)),
  getHealth: () => requestJson("/api/overlay/health", undefined, (value) => overlayHealthSchema.parse(value)),
  getConversations: () => requestJson("/api/overlay/conversations", undefined, (value) => overlayConversationsResponseSchema.parse(value)),
  sendConversationMessage: (body: string) => {
    const payload = overlayConversationSendSchema.parse({ body });
    return requestJson(
      "/api/overlay/conversations/messages",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      (value) => overlayConversationsResponseSchema.parse(value),
    );
  },
  getCurrentTasks: () => requestJson("/api/overlay/tasks/current", undefined, (value) => overlayTaskListResponseSchema.parse(value)),
  openTask: (taskId: string) =>
    requestJson(
      `/api/overlay/tasks/${taskId}/open`,
      {
        method: "POST",
      },
      (value) => overlayOpenTaskResultSchema.parse(value),
    ),
  getWindowState: () => ipcRenderer.invoke("overlay:get-window-state") as Promise<{ expanded: boolean }>,
  getWindowBounds: () =>
    ipcRenderer.invoke("overlay:get-window-bounds") as Promise<{ x: number; y: number; width: number; height: number }>,
  setWindowPosition: (position: { x: number; y: number }) =>
    ipcRenderer.invoke("overlay:set-window-position", position) as Promise<{ x: number; y: number; width: number; height: number }>,
  toggleWindow: () => ipcRenderer.invoke("overlay:toggle-window") as Promise<{ expanded: boolean }>,
  prepareTextInput: () => ipcRenderer.invoke("overlay:prepare-text-input") as Promise<{ accepted: boolean }>,
  openPlatform: () => ipcRenderer.invoke("overlay:open-platform"),
  reconnectAgent: () => ipcRenderer.invoke("overlay:reconnect-agent"),
  readUiState: () => ipcRenderer.invoke("overlay:read-ui-state") as Promise<Record<string, unknown>>,
  saveUiState: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke("overlay:save-ui-state", patch) as Promise<Record<string, unknown>>,
  onWindowState: (listener: (payload: { expanded: boolean }) => void) => {
    const wrapped = (_event: unknown, payload: { expanded: boolean }) => listener(payload);
    ipcRenderer.on("overlay:window-state", wrapped);
    return () => ipcRenderer.removeListener("overlay:window-state", wrapped);
  },
  onReconnectRequested: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("overlay:reconnect-requested", wrapped);
    return () => ipcRenderer.removeListener("overlay:reconnect-requested", wrapped);
  },
});
