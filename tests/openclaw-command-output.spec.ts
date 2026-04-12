import { describe, expect, it } from "vitest";

import {
  extractOpenClawReplyText,
  parseOpenClawAgentResponse,
} from "../apps/local-agent/src/openclaw-command-output.js";

describe("openclaw command output", () => {
  it("parses JSON responses even when logs surround the payload", () => {
    const response = parseOpenClawAgentResponse(
      [
        "[OpenClaw] starting",
        "{\"status\":\"ok\",\"summary\":\"completed\",\"result\":{\"payloads\":[{\"text\":\"收到\"}]}}",
        "[OpenClaw] done",
      ].join("\n"),
      "",
    );

    expect(response.status).toBe("ok");
    expect(response.result?.payloads[0]?.text).toBe("收到");
  });

  it("extracts reply text from a JSON payload", () => {
    const reply = extractOpenClawReplyText(
      "{\"status\":\"ok\",\"summary\":\"completed\",\"result\":{\"payloads\":[{\"text\":\"收到\"}]}}",
      "",
    );

    expect(reply).toBe("收到");
  });

  it("falls back to plain stdout replies when OpenClaw does not emit JSON", () => {
    expect(extractOpenClawReplyText("收到，我在。", "")).toBe("收到，我在。");
  });

  it("throws for JSON error responses", () => {
    expect(() =>
      extractOpenClawReplyText(
        "{\"status\":\"error\",\"summary\":\"gateway offline\"}",
        "",
      )).toThrow("gateway offline");
  });
});
