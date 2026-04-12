import fs from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

type ClientCredentials = {
  agentId: string | undefined;
  agentToken: string | undefined;
};

export class PlatformRequestError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly endpoint: string,
    readonly details?: string,
  ) {
    super(`Request failed: ${status} ${statusText} (${endpoint})${details ? ` - ${details}` : ""}`);
    this.name = "PlatformRequestError";
  }
}

export type RegisterResponse = {
  agent_id: string;
  agent_token: string;
  poll_interval_seconds: number;
};

export type AgentReleaseStatusResponse = {
  current_version: string;
  update_available: boolean;
  release: {
    version: string;
    notes: string;
    package_rel_path: string;
    package_sha256: string;
    package_size_bytes: number;
    minimum_runtime_version?: string;
    published_by_user_id: string;
    published_at: string;
    package_url: string;
  } | null;
};

export type ConversationForwardTargetResponse = {
  user_id: string;
  username: string;
  display_name: string;
  agent_id: string;
  online: boolean;
};

export type ConversationForwardExecutionResponse = {
  accepted: boolean;
  target: ConversationForwardTargetResponse;
  forwarded_message: Record<string, unknown>;
  task_brief: Record<string, unknown>;
};

export type AgentConversationThreadResponse = {
  conversation_id: string;
  owner_user_id: string;
  current_agent_id: string | null;
  openclaw_connected: boolean;
  messages: Array<Record<string, unknown>>;
};

export type AgentCurrentTasksResponse = {
  tasks: Array<Record<string, unknown>>;
};

export class PlatformClient {
  private credentials: ClientCredentials;

  constructor(private readonly baseUrl: string, credentials: ClientCredentials) {
    this.credentials = credentials;
  }

  setCredentials(credentials: ClientCredentials): void {
    this.credentials = credentials;
  }

  async registerAgent(payload: Record<string, unknown>, bootstrapToken?: string): Promise<RegisterResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (bootstrapToken && bootstrapToken.trim().length > 0) {
      headers["x-bootstrap-token"] = bootstrapToken;
    } else {
      headers["x-flow-lan-auto-register"] = "1";
    }

    return this.requestJson("/api/v1/agents/register", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  async postHeartbeat(payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson("/api/v1/agents/heartbeat", {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async getPendingDeliveries(agentId: string): Promise<Array<Record<string, unknown>>> {
    return this.requestJson(`/api/v1/agents/${agentId}/deliveries/pending`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getOwnerCurrentTasks(agentId: string): Promise<AgentCurrentTasksResponse> {
    return this.requestJson(`/api/v1/agents/${agentId}/tasks/current`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getAgentConfig(agentId: string): Promise<Record<string, unknown>> {
    return this.requestJson(`/api/v1/agents/${agentId}/config`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getWorkflowTemplates(agentId: string): Promise<Array<Record<string, unknown>>> {
    return this.requestJson(`/api/v1/agents/${agentId}/workflow-templates`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getPendingConversationMessages(agentId: string): Promise<Array<Record<string, unknown>>> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/messages/pending`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getAgentConversationThread(agentId: string): Promise<AgentConversationThreadResponse> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/thread`, {
      method: "GET",
      auth: "agent",
    });
  }

  async getConversationTargets(agentId: string): Promise<ConversationForwardTargetResponse[]> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversation-targets`, {
      method: "GET",
      auth: "agent",
    });
  }

  async executeConversationForward(agentId: string, payload: Record<string, unknown>): Promise<ConversationForwardExecutionResponse> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversation-forwards`, {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async getCurrentAgentRelease(agentId: string): Promise<AgentReleaseStatusResponse> {
    return this.requestJson(`/api/v1/agents/${agentId}/releases/current`, {
      method: "GET",
      auth: "agent",
    });
  }

  async sendSelfConversationMessage(agentId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/self/messages`, {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async ackConversationMessage(agentId: string, messageId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/messages/${messageId}/ack`, {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async updateConversationMessageStatus(agentId: string, messageId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/messages/${messageId}/status`, {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async replyConversationMessage(agentId: string, messageId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(`/api/v1/agents/${agentId}/conversations/messages/${messageId}/reply`, {
      method: "POST",
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async sendJson(endpoint: string, method: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(endpoint, {
      method,
      auth: "agent",
      body: JSON.stringify(payload),
    });
  }

  async downloadToFile(endpoint: string, targetPath: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "GET",
      headers: this.authHeaders("agent"),
    });
    if (!response.ok || !response.body) {
      throw await this.buildRequestError(response, endpoint);
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      fs.createWriteStream(targetPath),
    );
  }

  async uploadFile(taskId: string, sourcePath: string, options: {
    purpose: "attachment" | "result";
    sha256Declared: string;
    sizeBytes: number;
    contentType: string;
    originalName: string;
  }): Promise<string> {
    const init = await this.requestJson("/api/v1/files/upload-init", {
      method: "POST",
      auth: "agent",
      body: JSON.stringify({
        request_id: `req_upload_init_${Date.now()}`,
        purpose: options.purpose,
        task_id: taskId,
        original_name: options.originalName,
        content_type: options.contentType,
        size_bytes: options.sizeBytes,
        sha256_declared: options.sha256Declared,
      }),
    }) as { file_id: string; upload_url: string };

    const response = await fetch(`${this.baseUrl}${init.upload_url}`, {
      method: "PUT",
      headers: {
        ...this.authHeaders("agent"),
        "content-type": options.contentType,
      },
      body: fs.createReadStream(sourcePath) as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    if (!response.ok) {
      throw await this.buildRequestError(response, init.upload_url);
    }

    await this.requestJson("/api/v1/files/complete", {
      method: "POST",
      auth: "agent",
      body: JSON.stringify({
        request_id: `req_upload_complete_${Date.now()}`,
        file_id: init.file_id,
      }),
    });

    return init.file_id;
  }

  private async requestJson(endpoint: string, options: {
    method: string;
    auth?: "agent";
    headers?: Record<string, string>;
    body?: string;
  }): Promise<any> {
    const requestInit: RequestInit = {
      method: options.method,
      headers: {
        ...(options.method !== "GET" ? { "content-type": "application/json" } : {}),
        ...this.authHeaders(options.auth),
        ...options.headers,
      },
    };
    if (options.body !== undefined) {
      requestInit.body = options.body;
    }
    const response = await fetch(`${this.baseUrl}${endpoint}`, requestInit);
    if (!response.ok) {
      throw await this.buildRequestError(response, endpoint);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  private async buildRequestError(response: Response, endpoint: string): Promise<PlatformRequestError> {
    let details: string | undefined;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json() as { error?: string; message?: string };
        details = payload.error ?? payload.message;
      } else {
        const text = (await response.text()).trim();
        details = text.length > 0 ? text : undefined;
      }
    } catch {
      details = undefined;
    }
    return new PlatformRequestError(response.status, response.statusText, endpoint, details);
  }

  private authHeaders(auth?: "agent"): Record<string, string> {
    if (auth !== "agent") {
      return {};
    }
    if (!this.credentials.agentToken) {
      throw new Error("Agent token is not configured");
    }
    return {
      authorization: `Bearer ${this.credentials.agentToken}`,
    };
  }
}
