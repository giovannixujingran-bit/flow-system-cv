import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { execBufferedCommand } from "../apps/local-agent/src/command.js";

describe("execBufferedCommand", () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("preserves spaced arguments for Windows .cmd commands", async () => {
    if (process.platform !== "win32") {
      return;
    }

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flow-system-command-"));
    const commandPath = path.join(tempRoot, "echo-args.cmd");
    fs.writeFileSync(
      commandPath,
      [
        "@echo off",
        "setlocal",
        "echo ARG1=%~1",
        "echo ARG2=%~2",
        "exit /b 0",
        "",
      ].join("\r\n"),
      "utf8",
    );

    const result = await execBufferedCommand(
      commandPath,
      ["agent", "flow system probe"],
      {
        cwd: tempRoot,
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );

    expect(result.stdout).toContain("ARG1=agent");
    expect(result.stdout).toContain("ARG2=flow system probe");
  });

  it("passes stdin to non-shell commands", async () => {
    const result = await execBufferedCommand(
      process.execPath,
      ["-e", "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data', (chunk) => data += chunk);process.stdin.on('end', () => process.stdout.write(data));"],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        stdin: JSON.stringify({ ok: true, source: "stdin-test" }),
      },
    );

    expect(result.stdout).toBe('{"ok":true,"source":"stdin-test"}');
  });
});
