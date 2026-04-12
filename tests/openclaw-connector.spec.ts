import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LocalAgentConfig } from "../apps/local-agent/src/config.js";
import { AgentLogger } from "../apps/local-agent/src/logger.js";
import {
  createWindowsPickerCommand,
  OpenClawConnectorService,
} from "../apps/local-agent/src/services/openclaw-connector.js";

type MockOpenClawRuntime = {
  binPath: string;
  userProfileRoot: string;
};

function createMockOpenClawRuntime(root: string): MockOpenClawRuntime {
  const userProfileRoot = path.join(root, "user-profile");
  const stateDir = path.join(userProfileRoot, ".openclaw");
  const authDir = path.join(stateDir, "agents", "main", "agent");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "openclaw.json"), JSON.stringify({
    agents: {
      defaults: {
        model: {
          primary: "openai-codex/gpt-5.3-codex",
        },
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(authDir, "auth-profiles.json"), JSON.stringify({ profiles: [] }, null, 2), "utf8");

  const binPath = path.join(root, "mock-openclaw.cmd");
  fs.writeFileSync(
    binPath,
    [
      "@echo off",
      "setlocal",
      "if /I \"%~1\"==\"--version\" (",
      "  echo OpenClaw 2026.3.8",
      "  exit /b 0",
      ")",
      "if /I \"%~1\"==\"gateway\" if /I \"%~2\"==\"status\" (",
      "  echo RPC probe: ok",
      "  exit /b 0",
      ")",
      "if /I \"%~1\"==\"models\" if /I \"%~2\"==\"status\" if /I \"%~3\"==\"--plain\" (",
      "  echo openai-codex/gpt-5.3-codex",
      "  exit /b 0",
      ")",
      "if /I \"%~1\"==\"agent\" (",
      "  echo {\"status\":\"ok\",\"result\":{\"payloads\":[{\"text\":\"mock-openclaw-probe\"}]}}",
      "  exit /b 0",
      ")",
      "echo unsupported command>&2",
      "exit /b 1",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return {
    binPath,
    userProfileRoot,
  };
}

function createConfig(root: string, openClawBin?: string): LocalAgentConfig {
  return {
    platformApiBaseUrl: "http://127.0.0.1:4010",
    platformWebOrigin: "http://127.0.0.1:3000",
    bootstrapToken: "flow-bootstrap-local",
    agentId: undefined,
    agentToken: undefined,
    agentName: "ADMIN-PC",
    ownerUserId: "user_admin",
    runtimeVersion: "0.1.0",
    appRoot: path.resolve("/mnt/d/openclaw/workspace/flow-system"),
    uiHost: "127.0.0.1",
    uiPort: 38500,
    pollIntervalSeconds: 15,
    updateCheckIntervalSeconds: 60,
    flowRoot: root,
    conversationsRoot: path.join(root, "conversations"),
    tasksRoot: path.join(root, "tasks"),
    tmpRoot: path.join(root, "tmp"),
    updatesRoot: path.join(root, "updates"),
    recoveryRoot: path.join(root, "recovery"),
    overlayDataRoot: path.join(root, "overlay-data"),
    dataRoot: path.join(root, "agent-data"),
    logsRoot: path.join(root, "agent-data", "logs"),
    backupsRoot: path.join(root, "agent-data", "backups"),
    databasePath: path.join(root, "agent-data", "agent.sqlite"),
    logFilePath: path.join(root, "agent-data", "logs", "agent.log"),
    openClawConnectionPath: path.join(root, "agent-data", "openclaw-connection.json"),
    openClawBin,
    openClawTimeoutSeconds: 90,
    openClawAutoReplyEnabled: true,
    nodeExecutablePath: process.execPath,
    npmCliPath: undefined,
    restartCommand: "true",
    maxOutboxWarning: 1000,
    maxOutboxHardLimit: 5000,
    recoveryRetentionDays: 7,
  };
}

describe("openclaw connector service", () => {
  let root: string;
  let mockOpenClaw: MockOpenClawRuntime;
  const originalUserProfile = process.env.USERPROFILE;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flow-openclaw-connector-"));
    mockOpenClaw = createMockOpenClawRuntime(root);
    process.env.USERPROFILE = mockOpenClaw.userProfileRoot;
    process.env.HOME = mockOpenClaw.userProfileRoot;
  });

  afterEach(() => {
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("persists a validated executable selection and restores it on restart", async () => {
    const config = createConfig(root);
    const logger = new AgentLogger(config.logFilePath);
    const connector = new OpenClawConnectorService(config, logger);

    const selection = await connector.selectExecutable(mockOpenClaw.binPath);
    expect(selection).toMatchObject({
      accepted: true,
      cancelled: false,
      persisted: true,
      status: {
        status_code: "ready",
        openclaw_connected: true,
        openclaw_bin: mockOpenClaw.binPath,
        current_model: "openai-codex/gpt-5.3-codex",
      },
    });
    expect(fs.existsSync(config.openClawConnectionPath)).toBe(true);

    const restartedConnector = new OpenClawConnectorService(config, logger);
    await restartedConnector.initialize();
    expect(restartedConnector.getStatus()).toMatchObject({
      status_code: "ready",
      openclaw_connected: true,
      openclaw_bin: mockOpenClaw.binPath,
      current_model: "openai-codex/gpt-5.3-codex",
    });
  });

  it("does not overwrite a valid selection when a later root selection is invalid", async () => {
    const config = createConfig(root);
    const logger = new AgentLogger(config.logFilePath);
    const connector = new OpenClawConnectorService(config, logger);

    await connector.selectExecutable(mockOpenClaw.binPath);
    const invalidRoot = path.join(root, "invalid-root");
    fs.mkdirSync(invalidRoot, { recursive: true });

    const selection = await connector.selectRoot(invalidRoot);
    expect(selection).toMatchObject({
      accepted: true,
      cancelled: false,
      persisted: false,
      status: {
        status_code: "executable_missing",
        openclaw_connected: false,
      },
    });

    const persisted = JSON.parse(fs.readFileSync(config.openClawConnectionPath, "utf8")) as { status_code: string; openclaw_bin: string };
    expect(persisted.status_code).toBe("ready");
    expect(persisted.openclaw_bin).toBe(mockOpenClaw.binPath);
  });

  it("persists the latest invalid selection when there is no prior ready configuration", async () => {
    const config = createConfig(root);
    const logger = new AgentLogger(config.logFilePath);
    const connector = new OpenClawConnectorService(config, logger);
    const invalidRoot = path.join(root, "invalid-root");
    fs.mkdirSync(invalidRoot, { recursive: true });

    const selection = await connector.selectRoot(invalidRoot);
    expect(selection).toMatchObject({
      accepted: true,
      cancelled: false,
      persisted: true,
      status: {
        selected_mode: "root",
        selected_path: invalidRoot,
        status_code: "executable_missing",
        openclaw_connected: false,
      },
    });

    const restartedConnector = new OpenClawConnectorService(config, logger);
    await restartedConnector.initialize();
    expect(restartedConnector.getStatus()).toMatchObject({
      selected_mode: "root",
      selected_path: invalidRoot,
      status_code: "executable_missing",
      openclaw_connected: false,
      current_model: null,
    });
  });

  it("falls back to the CLI model status when the config does not expose a default model", async () => {
    const configPath = path.join(mockOpenClaw.userProfileRoot, ".openclaw", "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify({ agents: { defaults: {} } }, null, 2), "utf8");

    const config = createConfig(root);
    const logger = new AgentLogger(config.logFilePath);
    const connector = new OpenClawConnectorService(config, logger);

    const selection = await connector.selectExecutable(mockOpenClaw.binPath);
    expect(selection.status).toMatchObject({
      status_code: "ready",
      current_model: "openai-codex/gpt-5.3-codex",
    });
  });

  it("returns a null current model when the OpenClaw config is missing", async () => {
    fs.rmSync(path.join(mockOpenClaw.userProfileRoot, ".openclaw", "openclaw.json"), { force: true });

    const config = createConfig(root);
    const logger = new AgentLogger(config.logFilePath);
    const connector = new OpenClawConnectorService(config, logger);

    const selection = await connector.selectExecutable(mockOpenClaw.binPath);
    expect(selection.status).toMatchObject({
      status_code: "config_missing",
      current_model: null,
    });
  });

  it("builds stable encoded powershell commands for both picker types", () => {
    const executableCommand = createWindowsPickerCommand("executable");
    const rootCommand = createWindowsPickerCommand("root");

    expect(executableCommand).toMatchObject([
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      expect.any(String),
    ]);
    expect(rootCommand).toMatchObject([
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      expect.any(String),
    ]);

    const executableScript = Buffer.from(executableCommand[5] ?? "", "base64").toString("utf16le");
    const rootScript = Buffer.from(rootCommand[5] ?? "", "base64").toString("utf16le");

    expect(executableScript).toContain("OpenFileDialog");
    expect(executableScript).toContain("Select an OpenClaw launcher");
    expect(executableScript).toContain("$owner.TopMost = $true");
    expect(executableScript).toContain("$focusTimer = New-Object System.Windows.Forms.Timer");
    expect(executableScript).toContain("$focusTimer.Start()");
    expect(executableScript).toContain("SetForegroundWindow($owner.Handle)");
    expect(executableScript).toContain("ShowDialog($owner)");
    expect(rootScript).toContain("FolderBrowserDialog");
    expect(rootScript).toContain("Select the OpenClaw installation root");
    expect(rootScript).toContain("$owner.TopMost = $true");
    expect(rootScript).toContain("$focusTimer = New-Object System.Windows.Forms.Timer");
    expect(rootScript).toContain("$focusTimer.Start()");
    expect(rootScript).toContain("SetForegroundWindow($owner.Handle)");
    expect(rootScript).toContain("ShowDialog($owner)");
  });
});
