"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from "react";

import { isOpenClawReady, type OpenClawStatus, type OpenClawStatusResponse } from "@flow-system/local-openclaw-contracts";
import {
  buildConversationMessageViews,
  getConversationConnectionLabel,
  type ConversationMessage,
} from "@flow-system/local-overlay-contracts";

import { fetchPlatformJson } from "../../lib/client-platform";
import { toUiErrorMessage } from "../../lib/labels";

type ConversationThreadResponse = {
  messages?: ConversationMessage[];
  current_agent_id?: string | null;
};

function getCsrf(): string {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("flow_csrf="));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

function createUnavailableStatus(previous: OpenClawStatus): OpenClawStatus {
  return {
    ...previous,
    status_code: "not_configured",
    status_label: "未接入",
    openclaw_connected: false,
  };
}

function avatarLabel(value: string, fallback: string): string {
  const text = value.trim();
  if (!text) {
    return fallback;
  }
  return [...text].slice(0, 2).join("").toUpperCase();
}

export function ConversationPanel({
  initialMessages,
  currentUserDisplayName,
  currentAgentId,
  initialOpenClawStatus,
  localUiPort,
}: {
  initialMessages: ConversationMessage[];
  currentUserDisplayName: string;
  currentAgentId: string | null;
  initialOpenClawStatus: OpenClawStatus;
  localUiPort: number | undefined;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [activeAgentId, setActiveAgentId] = useState(currentAgentId);
  const [openClawStatus, setOpenClawStatus] = useState(initialOpenClawStatus);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedScrollRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastRenderedMessageIdRef = useRef(initialMessages[initialMessages.length - 1]?.message_id ?? "");

  const localAgentUrl = localUiPort ? `http://127.0.0.1:${localUiPort}` : null;
  const openClawConnected = isOpenClawReady(openClawStatus);
  const messageViews = buildConversationMessageViews(messages, currentUserDisplayName);

  function isNearLatestMessage(node: HTMLDivElement): boolean {
    return node.scrollHeight - node.scrollTop - node.clientHeight <= 28;
  }

  function scrollToLatestMessage(behavior: ScrollBehavior): void {
    const node = messageStreamRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
    shouldStickToBottomRef.current = true;
  }

  async function refreshThread(signal?: AbortSignal): Promise<void> {
    const requestInit: RequestInit = {
      method: "GET",
      credentials: "same-origin",
    };
    if (signal) {
      requestInit.signal = signal;
    }

    const result = await fetchPlatformJson<ConversationThreadResponse>("/api/platform/v1/conversations/thread", requestInit);

    if (!result.ok) {
      if (signal?.aborted || result.status === 0 || result.status === 401 || result.status === 403 || result.status >= 500) {
        return;
      }
      setError((previous) => previous ?? toUiErrorMessage(result.error));
      return;
    }

    setError(null);
    setMessages(result.data.messages ?? []);
    setActiveAgentId(result.data.current_agent_id ?? null);
  }

  async function refreshOpenClawStatus(signal?: AbortSignal): Promise<void> {
    if (!localAgentUrl) {
      setOpenClawStatus((previous: OpenClawStatus) => createUnavailableStatus(previous));
      return;
    }

    try {
      const requestInit: RequestInit = {
        method: "GET",
      };
      if (signal) {
        requestInit.signal = signal;
      }
      const response = await fetch(`${localAgentUrl}/api/openclaw/status`, requestInit);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as OpenClawStatusResponse;
      setOpenClawStatus(payload.status);
    } catch {
      if (signal?.aborted) {
        return;
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([refreshThread(controller.signal), refreshOpenClawStatus(controller.signal)]);
    const timer = window.setInterval(() => {
      void Promise.all([refreshThread(controller.signal), refreshOpenClawStatus(controller.signal)]);
    }, 5000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [localAgentUrl]);

  useEffect(() => {
    const latestMessageId = messages[messages.length - 1]?.message_id ?? "";
    const hasLatestMessageChanged = latestMessageId !== lastRenderedMessageIdRef.current;
    const shouldScroll =
      !hasInitializedScrollRef.current || forceScrollToBottomRef.current || (hasLatestMessageChanged && shouldStickToBottomRef.current);

    hasInitializedScrollRef.current = true;
    lastRenderedMessageIdRef.current = latestMessageId;

    if (!shouldScroll) {
      forceScrollToBottomRef.current = false;
      return;
    }

    const behavior: ScrollBehavior = forceScrollToBottomRef.current ? "smooth" : "auto";
    forceScrollToBottomRef.current = false;

    window.requestAnimationFrame(() => {
      scrollToLatestMessage(behavior);
    });
  }, [messages]);

  async function submitMessage(): Promise<void> {
    if (!draft.trim() || !activeAgentId || !openClawConnected) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await fetchPlatformJson<{ messages?: ConversationMessage[] }>("/api/platform/v1/conversations/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrf(),
        },
        body: JSON.stringify({
          request_id: `req_conversation_${Date.now()}`,
          body: draft.trim(),
        }),
      });
      if (!result.ok) {
        throw new Error(result.error);
      }

      forceScrollToBottomRef.current = true;
      setMessages(result.data.messages ?? []);
      setActiveAgentId((previous) => previous ?? currentAgentId);
      setDraft("");
    } catch (submitError) {
      setError(toUiErrorMessage(submitError instanceof Error ? submitError.message : "会话发送失败"));
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitMessage();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void submitMessage();
  }

  function onMessageStreamScroll(event: UIEvent<HTMLDivElement>): void {
    shouldStickToBottomRef.current = isNearLatestMessage(event.currentTarget);
  }

  return (
    <section className="chat-surface glass-panel">
      <div className="chat-meta">
        <div>
          <p className="eyebrow">Active Session</p>
          <h3>会话控制台 / OpenClaw</h3>
        </div>
        <div className="topbar-statuses">
          <div className="meta-pill">当前代理 {activeAgentId ?? "未绑定"}</div>
          <div className="board-badge">
            {openClawConnected ? "本机会话通道在线" : `当前状态 ${getConversationConnectionLabel(openClawConnected)}`}
          </div>
        </div>
      </div>

      <div className="message-stream" onScroll={onMessageStreamScroll} ref={messageStreamRef}>
        {messageViews.length === 0 ? (
          <div className="conversation-empty">当前还没有会话记录。发送第一条消息后，这里会显示完整线程和状态反馈。</div>
        ) : (
          messageViews.map((message) => {
            const isMe = message.align === "right";
            const bubbleLabel = isMe ? currentUserDisplayName : message.author_label;
            const avatar = isMe ? avatarLabel(currentUserDisplayName, "ME") : avatarLabel(message.author_label, "AI");

            return (
              <article className={isMe ? "message me" : "message other"} key={message.message_id}>
                {!isMe ? <div className="avatar">{avatar}</div> : null}
                <div className="bubble-wrap">
                  <div className="message-label">
                    <span>{bubbleLabel}</span>
                    <time>{message.time_label}</time>
                    {message.sync_label ? <span>{message.sync_label}</span> : null}
                  </div>
                  <div className="bubble">{message.body}</div>
                </div>
                {isMe ? <div className="avatar">{avatar}</div> : null}
              </article>
            );
          })
        )}
      </div>

      <div className="chat-footer">
        <form className="composer" onSubmit={onSubmit}>
          <button
            aria-label="添加上下文"
            className="plus-btn composer-plus"
            title="当前页面仅发送文本，会话附件请在任务创建页处理。"
            type="button"
          >
            +
          </button>
          <label className="composer-field">
            <textarea
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={openClawConnected ? "输入消息，按 Enter 发送，Shift + Enter 换行..." : `当前 OpenClaw 状态：${openClawStatus.status_label}`}
              rows={2}
              value={draft}
            />
          </label>
          <button
            className="primary-btn composer-submit"
            disabled={pending || !activeAgentId || !openClawConnected || !draft.trim()}
            type="submit"
          >
            {pending ? "发送中..." : "发送"}
          </button>
        </form>

        {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
        {!openClawConnected ? <div className="muted">当前本机 OpenClaw 未就绪，请先到代理页修复连接。</div> : null}
      </div>
    </section>
  );
}
