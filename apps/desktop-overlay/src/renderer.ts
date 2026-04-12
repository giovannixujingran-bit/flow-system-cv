import type {
  OverlayBootstrap,
  OverlayConversationMessage,
  OverlayConversationsResponse,
  OverlayTaskCard,
  OverlayTaskListResponse,
} from "@flow-system/local-overlay-contracts";
import { getConversationSyncLabel } from "@flow-system/local-overlay-contracts";
import { shouldIgnoreDragStart } from "./drag-behavior.js";

type OverlayDesktopState = {
  last_tab?: "conversation" | "tasks";
  last_read_conversation_message_at?: string | null;
};

type OverlayBridge = {
  localUiPort: number;
  getBootstrap(): Promise<OverlayBootstrap>;
  getConversations(): Promise<OverlayConversationsResponse>;
  sendConversationMessage(body: string): Promise<OverlayConversationsResponse>;
  getCurrentTasks(): Promise<OverlayTaskListResponse>;
  openTask(taskId: string): Promise<unknown>;
  getWindowState(): Promise<{ expanded: boolean }>;
  getWindowBounds(): Promise<{ x: number; y: number; width: number; height: number }>;
  setWindowPosition(position: { x: number; y: number }): Promise<{ x: number; y: number; width: number; height: number }>;
  toggleWindow(): Promise<{ expanded: boolean }>;
  prepareTextInput(): Promise<{ accepted: boolean }>;
  readUiState(): Promise<OverlayDesktopState>;
  saveUiState(patch: Partial<OverlayDesktopState>): Promise<OverlayDesktopState>;
  onWindowState(listener: (payload: { expanded: boolean }) => void): () => void;
  onReconnectRequested(listener: () => void): () => void;
};

declare global {
  interface Window {
    overlayBridge: OverlayBridge;
  }
}

type UiState = {
  expanded: boolean;
  activeTab: "conversation" | "tasks";
  bootstrap: OverlayBootstrap | null;
  conversations: OverlayConversationMessage[];
  currentTasks: OverlayTaskCard[];
  input: string;
  sending: boolean;
  error: string | null;
};

type DragState = {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  moved: boolean;
  clickAction: (() => Promise<void>) | null;
};

const state: UiState = {
  expanded: false,
  activeTab: "conversation",
  bootstrap: null,
  conversations: [],
  currentTasks: [],
  input: "",
  sending: false,
  error: null,
};

const elements = {
  root: document.body,
  orbButton: document.querySelector<HTMLButtonElement>("[data-role='orb-button']")!,
  dragSurface: document.querySelector<HTMLElement>("[data-role='drag-surface']")!,
  collapseButton: document.querySelector<HTMLButtonElement>("[data-role='collapse-button']")!,
  unreadBadge: document.querySelector<HTMLElement>("[data-role='unread-badge']")!,
  headerTitle: document.querySelector<HTMLElement>("[data-role='header-title']")!,
  conversationTab: document.querySelector<HTMLButtonElement>("[data-role='tab-conversation']")!,
  taskTab: document.querySelector<HTMLButtonElement>("[data-role='tab-tasks']")!,
  conversationPane: document.querySelector<HTMLElement>("[data-role='pane-conversation']")!,
  taskPane: document.querySelector<HTMLElement>("[data-role='pane-tasks']")!,
  messages: document.querySelector<HTMLElement>("[data-role='messages']")!,
  composer: document.querySelector<HTMLFormElement>("[data-role='composer']")!,
  composerInput: document.querySelector<HTMLTextAreaElement>("[data-role='composer-input']")!,
  composerButton: document.querySelector<HTMLButtonElement>("[data-role='composer-button']")!,
  taskList: document.querySelector<HTMLElement>("[data-role='task-list']")!,
  error: document.querySelector<HTMLElement>("[data-role='error']")!,
};

let dragState: DragState | null = null;
let dragFrame: number | null = null;
let pendingDragTarget: { x: number; y: number } | null = null;
let isComposing = false;

function formatTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function messageSyncText(message: OverlayConversationMessage): string {
  if (message.author_kind !== "user" || message.sync_status === "none") {
    return "";
  }
  return message.sync_status === "pending" ? "\u5df2\u53d1\u9001" : "\u672c\u673a OpenClaw \u5df2\u63a5\u6536";
}

function messageSyncTextDetailed(message: OverlayConversationMessage): string {
  if (message.author_kind !== "user" || message.sync_status === "none") {
    return "";
  }
  return getConversationSyncLabel(message.sync_status, message.sync_detail) ?? messageSyncText(message);
}

function syncComposerValue() {
  if (isComposing) {
    return;
  }

  if (elements.composerInput.value === state.input) {
    return;
  }

  const isFocused = document.activeElement === elements.composerInput;
  const selectionStart = elements.composerInput.selectionStart ?? state.input.length;
  const selectionEnd = elements.composerInput.selectionEnd ?? state.input.length;

  elements.composerInput.value = state.input;

  if (isFocused) {
    const nextStart = Math.min(selectionStart, state.input.length);
    const nextEnd = Math.min(selectionEnd, state.input.length);
    elements.composerInput.setSelectionRange(nextStart, nextEnd);
  }
}

function renderMessages() {
  if (state.conversations.length === 0) {
    elements.messages.innerHTML = `<div class="empty-state">开始和本机 OpenClaw 对话。</div>`;
    return;
  }

  elements.messages.innerHTML = state.conversations
    .map((message) => {
      const syncText = messageSyncTextDetailed(message);
      const authorName = message.author_kind === "user"
        ? escapeHtml(state.bootstrap?.owner_display_name ?? "我")
        : "OpenClaw";
      return `
        <article class="message ${message.author_kind === "user" ? "message-user" : "message-openclaw"}">
          <header class="message-meta">
            <span>${authorName}</span>
            <span>${formatTime(message.created_at)}</span>
          </header>
          <div class="message-body">${escapeHtml(message.body)}</div>
          ${syncText ? `<div class="message-sync">${syncText}</div>` : ""}
        </article>
      `;
    })
    .join("");
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderTasks() {
  if (state.currentTasks.length === 0) {
    elements.taskList.innerHTML = `<div class="empty-state">当前没有任务。</div>`;
    return;
  }

  elements.taskList.innerHTML = state.currentTasks
    .map((task) => `
      <button class="task-card" data-task-id="${task.task_id}">
        <div class="task-project">${escapeHtml(task.project_name)}</div>
        <strong>${escapeHtml(task.task_title)}</strong>
        <div class="task-meta">
          <span>${escapeHtml(task.user_display_name)}</span>
          <span>${escapeHtml(task.status)}</span>
        </div>
      </button>
    `)
    .join("");

  for (const button of Array.from(elements.taskList.querySelectorAll<HTMLButtonElement>("[data-task-id]"))) {
    button.onclick = async () => {
      try {
        await window.overlayBridge.openTask(button.dataset.taskId ?? "");
      } catch (error) {
        state.error = error instanceof Error ? error.message : "打开任务失败";
        render();
      }
    };
  }
}

function render() {
  elements.root.dataset.expanded = state.expanded ? "true" : "false";
  elements.root.dataset.orbState = state.bootstrap?.orb_state ?? "idle";
  elements.root.dataset.activeTab = state.activeTab;
  elements.unreadBadge.textContent = String(state.bootstrap?.unread.count ?? 0);
  elements.unreadBadge.hidden = (state.bootstrap?.unread.count ?? 0) <= 0;
  elements.headerTitle.textContent = state.activeTab === "conversation" ? "会话" : "当前任务";
  elements.conversationTab.dataset.active = state.activeTab === "conversation" ? "true" : "false";
  elements.taskTab.dataset.active = state.activeTab === "tasks" ? "true" : "false";
  elements.conversationPane.hidden = state.activeTab !== "conversation";
  elements.taskPane.hidden = state.activeTab !== "tasks";
  elements.composerInput.placeholder = state.bootstrap?.openclaw_connected
    ? "直接输入要发给本机 OpenClaw 的内容"
    : "本机 OpenClaw 未连接，暂时无法发送";
  syncComposerValue();
  elements.composerButton.disabled = isComposing || state.sending || !state.bootstrap?.openclaw_connected || !state.input.trim();
  elements.error.textContent = state.error ?? "";
  elements.error.hidden = !state.error;

  renderMessages();
  renderTasks();
}

async function markConversationRead() {
  const latestOpenClawMessage = [...state.conversations]
    .filter((message) => message.author_kind === "openclaw")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!latestOpenClawMessage) {
    return;
  }
  await window.overlayBridge.saveUiState({
    last_tab: "conversation",
    last_read_conversation_message_at: latestOpenClawMessage.created_at,
  });
}

async function refreshBootstrap() {
  state.bootstrap = await window.overlayBridge.getBootstrap();
  render();
}

async function refreshConversations() {
  const payload = await window.overlayBridge.getConversations();
  state.conversations = payload.messages;
  if (state.expanded && state.activeTab === "conversation") {
    await markConversationRead();
    state.bootstrap = await window.overlayBridge.getBootstrap();
  }
  render();
}

async function refreshTasks() {
  const payload = await window.overlayBridge.getCurrentTasks();
  state.currentTasks = payload.tasks;
  render();
}

async function submitComposerMessage() {
  if (isComposing || state.sending || !state.input.trim()) {
    return;
  }

  state.sending = true;
  state.error = null;
  render();
  try {
    const payload = await window.overlayBridge.sendConversationMessage(state.input.trim());
    state.conversations = payload.messages;
    state.input = "";
  } catch (error) {
    state.error = error instanceof Error ? error.message : "发送失败";
  } finally {
    state.sending = false;
    render();
  }
}

async function prepareComposerInput() {
  try {
    await window.overlayBridge.prepareTextInput();
  } catch {
    // Ignore IME preparation failures so the input box remains usable.
  }
}

async function flushDragPosition() {
  if (!pendingDragTarget) {
    dragFrame = null;
    return;
  }
  const nextTarget = pendingDragTarget;
  pendingDragTarget = null;
  await window.overlayBridge.setWindowPosition(nextTarget);
  if (pendingDragTarget) {
    dragFrame = window.requestAnimationFrame(() => {
      void flushDragPosition();
    });
    return;
  }
  dragFrame = null;
}

function scheduleWindowMove(x: number, y: number) {
  pendingDragTarget = { x, y };
  if (dragFrame !== null) {
    return;
  }
  dragFrame = window.requestAnimationFrame(() => {
    void flushDragPosition();
  });
}

function clearDragState() {
  dragState = null;
}

type DragBindingOptions = {
  clickAction?: () => Promise<void>;
  ignoreInteractiveChildren?: boolean;
};

function bindWindowDrag(handle: HTMLElement, options: DragBindingOptions = {}) {
  handle.addEventListener("pointerdown", async (event) => {
    if (event.button !== 0) {
      return;
    }
    if (shouldIgnoreDragStart(handle, event.target, options.ignoreInteractiveChildren ?? false)) {
      return;
    }
    const bounds = await window.overlayBridge.getWindowBounds();
    dragState = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startWindowX: bounds.x,
      startWindowY: bounds.y,
      moved: false,
      clickAction: options.clickAction ?? null,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Ignore unsupported pointer capture combinations.
    }
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.screenX - dragState.startScreenX;
    const deltaY = event.screenY - dragState.startScreenY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.moved = true;
      scheduleWindowMove(dragState.startWindowX + deltaX, dragState.startWindowY + deltaY);
    }
  });

  handle.addEventListener("pointerup", async (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const currentDrag = dragState;
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore when capture was not established.
    }
    clearDragState();
    if (!currentDrag.moved && currentDrag.clickAction) {
      await currentDrag.clickAction();
    }
  });

  handle.addEventListener("pointercancel", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    clearDragState();
  });
}

async function initialize() {
  const uiState = await window.overlayBridge.readUiState();
  state.activeTab = uiState.last_tab ?? "conversation";
  state.expanded = (await window.overlayBridge.getWindowState()).expanded;
  render();

  try {
    await Promise.all([refreshBootstrap(), refreshConversations(), refreshTasks()]);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "初始化失败";
    render();
  }

  bindWindowDrag(elements.orbButton, {
    clickAction: async () => {
      const result = await window.overlayBridge.toggleWindow();
      state.expanded = result.expanded;
      if (state.expanded && state.activeTab === "conversation") {
        await markConversationRead();
        await refreshBootstrap();
      }
      render();
    },
  });

  bindWindowDrag(elements.dragSurface, {
    ignoreInteractiveChildren: true,
  });

  elements.collapseButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  elements.collapseButton.onclick = async () => {
    const result = await window.overlayBridge.toggleWindow();
    state.expanded = result.expanded;
    render();
  };

  elements.conversationTab.onclick = async () => {
    state.activeTab = "conversation";
    await window.overlayBridge.saveUiState({ last_tab: "conversation" });
    await markConversationRead();
    await refreshBootstrap();
    render();
  };

  elements.taskTab.onclick = async () => {
    state.activeTab = "tasks";
    await window.overlayBridge.saveUiState({ last_tab: "tasks" });
    render();
  };

  elements.composerInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  elements.composerInput.addEventListener("focus", () => {
    void prepareComposerInput();
  });

  elements.composerInput.addEventListener("pointerdown", () => {
    void prepareComposerInput();
  });

  elements.composerInput.addEventListener("compositionend", () => {
    isComposing = false;
    state.input = elements.composerInput.value;
    render();
  });

  elements.composerInput.addEventListener("input", () => {
    state.input = elements.composerInput.value;
    if (!isComposing) {
      render();
    }
  });

  elements.composerInput.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter"
      || event.shiftKey
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submitComposerMessage();
  });

  elements.composer.onsubmit = async (event) => {
    event.preventDefault();
    await submitComposerMessage();
  };

  window.overlayBridge.onWindowState((payload) => {
    state.expanded = payload.expanded;
    render();
  });

  window.overlayBridge.onReconnectRequested(() => {
    void Promise.all([refreshBootstrap(), refreshConversations(), refreshTasks()]);
  });

  window.setInterval(() => {
    void refreshBootstrap();
  }, 5000);
  window.setInterval(() => {
    void refreshConversations();
  }, 3000);
  window.setInterval(() => {
    void refreshTasks();
  }, 10000);
}

void initialize();
