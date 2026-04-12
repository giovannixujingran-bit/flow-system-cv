import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createOpenClawStatus,
  isOpenClawReady,
  openClawSelectionResultSchema,
  openClawStatusSchema,
  type OpenClawSelectionMode,
  type OpenClawSelectionResult,
  type OpenClawStatus,
} from "@flow-system/local-openclaw-contracts";

import type { LocalAgentConfig } from "../config.js";
import { AgentLogger } from "../logger.js";
import { execBufferedCommand } from "../command.js";
import { parseOpenClawAgentResponse } from "../openclaw-command-output.js";

const persistedOpenClawConnectionSchema = openClawStatusSchema;

type OpenClawSelectionInput = {
  selectedMode: OpenClawSelectionMode;
  selectedPath: string;
};

type PickerKind = "executable" | "root";

const OPENCLAW_PICKER_TIMEOUT_MS = 15 * 60 * 1000;
const OPENCLAW_LAUNCHER_EXTENSIONS = new Set([".cmd", ".bat", ".exe", ".com"]);
const OPENCLAW_ROOT_SEARCH_DIRS = ["", "bin", "openclaw-win"];

function normalizeLauncherBaseName(input: string): string {
  return input.toLowerCase().replace(/[\s_-]+/g, "-");
}

function getOpenClawLauncherPriority(filePath: string): number {
  const extension = path.extname(filePath).toLowerCase();
  const basename = normalizeLauncherBaseName(path.basename(filePath, extension));
  const basenamePriority = basename === "openclaw" ? 0 : basename === "start-openclaw" ? 1 : 2;
  const extensionPriority = [".cmd", ".bat", ".exe", ".com"].indexOf(extension);
  return (basenamePriority * 10) + (extensionPriority === -1 ? 9 : extensionPriority);
}

function isSupportedOpenClawLauncher(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (!OPENCLAW_LAUNCHER_EXTENSIONS.has(extension)) {
    return false;
  }

  const basename = normalizeLauncherBaseName(path.basename(filePath, extension));
  return basename.includes("openclaw");
}

function isDirectOpenClawCliLauncher(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  const basename = normalizeLauncherBaseName(path.basename(filePath, extension));
  return OPENCLAW_LAUNCHER_EXTENSIONS.has(extension) && basename === "openclaw";
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function createWindowsPickerCommand(kind: PickerKind): string[] {
  const commonDialogPrelude = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class OpenClawPickerWin32 {",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
    "}",
    "\"@",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual",
    "$cursor = [System.Windows.Forms.Cursor]::Position",
    "$ownerX = [Math]::Max($cursor.X - 120, 0)",
    "$ownerY = [Math]::Max($cursor.Y - 40, 0)",
    "$owner.Location = New-Object System.Drawing.Point($ownerX, $ownerY)",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$owner.ShowInTaskbar = $false",
    "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None",
    "$owner.TopMost = $true",
    "$owner.Opacity = 0.01",
    "$owner.Show()",
    "$owner.Activate()",
    "$owner.BringToFront()",
    "[void][OpenClawPickerWin32]::BringWindowToTop($owner.Handle)",
    "[void][OpenClawPickerWin32]::SetForegroundWindow($owner.Handle)",
    "[System.Windows.Forms.Application]::DoEvents()",
    "$focusTimer = New-Object System.Windows.Forms.Timer",
    "$focusTimer.Interval = 250",
    "$focusTimer.Add_Tick({",
    "  [void][OpenClawPickerWin32]::BringWindowToTop($owner.Handle)",
    "  [void][OpenClawPickerWin32]::SetForegroundWindow($owner.Handle)",
    "})",
    "$focusTimer.Start()",
  ];

  const script = kind === "executable"
    ? [
        ...commonDialogPrelude,
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        "$dialog.Filter = 'OpenClaw launchers (*openclaw*.cmd;*openclaw*.bat;*openclaw*.exe;*openclaw*.com)|*openclaw*.cmd;*openclaw*.bat;*openclaw*.exe;*openclaw*.com|Command files (*.cmd;*.bat)|*.cmd;*.bat|Executable files (*.exe;*.com)|*.exe;*.com'",
        "$dialog.Title = 'Select an OpenClaw launcher'",
        "$dialog.Multiselect = $false",
        "$dialog.CheckFileExists = $true",
        "try {",
        "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
        "    [Console]::Write($dialog.FileName)",
        "  }",
        "} finally {",
        "  $focusTimer.Stop()",
        "  $focusTimer.Dispose()",
        "  $owner.Close()",
        "  $owner.Dispose()",
        "}",
      ].join("\n")
    : [
        ...commonDialogPrelude,
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$dialog.Description = 'Select the OpenClaw installation root'",
        "$dialog.ShowNewFolderButton = $false",
        "try {",
        "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
        "    [Console]::Write($dialog.SelectedPath)",
        "  }",
        "} finally {",
        "  $focusTimer.Stop()",
        "  $focusTimer.Dispose()",
        "  $owner.Close()",
        "  $owner.Dispose()",
        "}",
      ].join("\n");

  return [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodePowerShellCommand(script),
  ];
}

function normalizeFsPath(input: string): string {
  return path.resolve(input.trim().replace(/^"+|"+$/g, ""));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCurrentModel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readCurrentModelFromConfig(configPath: string): string | null {
  try {
    const payload = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      agents?: {
        defaults?: {
          model?: {
            primary?: unknown;
          };
        };
      };
    };
    return normalizeCurrentModel(payload.agents?.defaults?.model?.primary);
  } catch {
    return null;
  }
}

function parseCurrentModelFromStatusOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const directMatch = line.match(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i)?.[0];
    const normalizedDirect = normalizeCurrentModel(directMatch);
    if (normalizedDirect) {
      return normalizedDirect;
    }

    const embeddedMatch = line.match(/([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/i)?.[1];
    const normalizedEmbedded = normalizeCurrentModel(embeddedMatch);
    if (normalizedEmbedded) {
      return normalizedEmbedded;
    }
  }

  return null;
}

export class OpenClawConnectorService {
  private status: OpenClawStatus;

  constructor(
    private readonly config: LocalAgentConfig,
    private readonly logger: AgentLogger,
  ) {
    this.status = createOpenClawStatus({
      selected_mode: null,
      selected_path: null,
      openclaw_bin: null,
      openclaw_state_dir: null,
      openclaw_config_path: null,
      status_code: "not_configured",
      last_validated_at: null,
      last_error: null,
    });
  }

  async initialize(): Promise<void> {
    this.status = this.loadPersistedStatus();
    const hasPersistedSelection = this.status.selected_mode !== null && this.status.selected_path !== null;
    if (!hasPersistedSelection && !this.config.openClawBin) {
      return;
    }

    try {
      await this.revalidate();
    } catch (error) {
      this.logger.warn("OpenClaw revalidation failed during startup", {
        error: toErrorMessage(error),
      });
    }
  }

  getStatus(): OpenClawStatus {
    return this.status;
  }

  getCompatibilityConnected(): boolean {
    return isOpenClawReady(this.status);
  }

  async resolveExecutableForInvocation(): Promise<string> {
    const currentStatus = await this.revalidate();
    if (!isOpenClawReady(currentStatus) || !currentStatus.openclaw_bin) {
      throw new Error(currentStatus.status_label);
    }
    return currentStatus.openclaw_bin;
  }

  async selectExecutable(selectedPath?: string): Promise<OpenClawSelectionResult> {
    const chosenPath = selectedPath ?? await this.pickPath("executable");
    if (!chosenPath) {
      return openClawSelectionResultSchema.parse({
        accepted: false,
        cancelled: true,
        persisted: false,
        status: this.status,
      });
    }

    return this.applySelection({
      selectedMode: "executable",
      selectedPath: normalizeFsPath(chosenPath),
    });
  }

  async selectRoot(selectedPath?: string): Promise<OpenClawSelectionResult> {
    const chosenPath = selectedPath ?? await this.pickPath("root");
    if (!chosenPath) {
      return openClawSelectionResultSchema.parse({
        accepted: false,
        cancelled: true,
        persisted: false,
        status: this.status,
      });
    }

    return this.applySelection({
      selectedMode: "root",
      selectedPath: normalizeFsPath(chosenPath),
    });
  }

  async revalidate(): Promise<OpenClawStatus> {
    const selection = this.getActiveSelection();
    if (!selection) {
      this.status = createOpenClawStatus({
        selected_mode: null,
        selected_path: null,
        openclaw_bin: null,
        openclaw_state_dir: null,
        openclaw_config_path: null,
        status_code: "not_configured",
        last_validated_at: this.status.last_validated_at,
        last_error: null,
      });
      return this.status;
    }

    const validated = await this.validateSelection(selection);
    this.status = validated;
    if (!this.config.openClawBin) {
      this.persistStatus(validated);
    }
    return validated;
  }

  reset(): OpenClawStatus {
    fs.rmSync(this.config.openClawConnectionPath, { force: true });
    this.status = createOpenClawStatus({
      selected_mode: null,
      selected_path: null,
      openclaw_bin: null,
      openclaw_state_dir: null,
      openclaw_config_path: null,
      status_code: "not_configured",
      last_validated_at: null,
      last_error: null,
    });
    return this.status;
  }

  private getActiveSelection(): OpenClawSelectionInput | null {
    if (this.config.openClawBin) {
      return {
        selectedMode: "executable",
        selectedPath: normalizeFsPath(this.config.openClawBin),
      };
    }

    if (this.status.selected_mode && this.status.selected_path) {
      return {
        selectedMode: this.status.selected_mode,
        selectedPath: this.status.selected_path,
      };
    }

    return null;
  }

  private async applySelection(selection: OpenClawSelectionInput): Promise<OpenClawSelectionResult> {
    const validated = await this.validateSelection(selection);
    const hadPersistedReadySelection = isOpenClawReady(this.loadPersistedStatus());
    const canPersist = isOpenClawReady(validated) || !hadPersistedReadySelection;

    this.status = validated;
    if (canPersist && !this.config.openClawBin) {
      this.persistStatus(validated);
    }

    return openClawSelectionResultSchema.parse({
      accepted: true,
      cancelled: false,
      persisted: canPersist,
      status: validated,
    });
  }

  private loadPersistedStatus(): OpenClawStatus {
    if (!fs.existsSync(this.config.openClawConnectionPath)) {
      return createOpenClawStatus({
        selected_mode: null,
        selected_path: null,
        openclaw_bin: null,
        openclaw_state_dir: null,
        openclaw_config_path: null,
        status_code: "not_configured",
        last_validated_at: null,
        last_error: null,
      });
    }

    try {
      const payload = JSON.parse(fs.readFileSync(this.config.openClawConnectionPath, "utf8"));
      return persistedOpenClawConnectionSchema.parse(payload);
    } catch (error) {
      this.logger.warn("Failed to read persisted OpenClaw connection state", {
        error: toErrorMessage(error),
        path: this.config.openClawConnectionPath,
      });
      return createOpenClawStatus({
        selected_mode: null,
        selected_path: null,
        openclaw_bin: null,
        openclaw_state_dir: null,
        openclaw_config_path: null,
        status_code: "not_configured",
        last_validated_at: null,
        last_error: null,
      });
    }
  }

  private persistStatus(status: OpenClawStatus): void {
    fs.mkdirSync(path.dirname(this.config.openClawConnectionPath), { recursive: true });
    fs.writeFileSync(this.config.openClawConnectionPath, JSON.stringify(status, null, 2), "utf8");
  }

  private async validateSelection(selection: OpenClawSelectionInput): Promise<OpenClawStatus> {
    const baseStatus = {
      selected_mode: selection.selectedMode,
      selected_path: selection.selectedPath,
      openclaw_bin: null as string | null,
      openclaw_state_dir: null as string | null,
      openclaw_config_path: null as string | null,
      last_validated_at: nowIso(),
      last_error: null as string | null,
    };

    if (!fs.existsSync(selection.selectedPath)) {
      return createOpenClawStatus({
        ...baseStatus,
        status_code: "selected_path_missing",
        last_error: `Selected path does not exist: ${selection.selectedPath}`,
      });
    }

    if (selection.selectedMode === "executable" && !isSupportedOpenClawLauncher(selection.selectedPath)) {
      return createOpenClawStatus({
        ...baseStatus,
        status_code: "executable_missing",
        last_error: "Selected file is not a supported OpenClaw launcher. Use openclaw.* or start-openclaw.*.",
      });
    }

    const openClawBin = selection.selectedMode === "executable"
      ? this.resolveExecutableFromSelection(selection.selectedPath)
      : this.resolveExecutableFromRoot(selection.selectedPath);
    if (!openClawBin) {
      return createOpenClawStatus({
        ...baseStatus,
        status_code: "executable_missing",
        last_error: "No supported OpenClaw launcher was found in the selected root. Expected openclaw.* or start-openclaw.* in the root, bin, or openclaw-win folder.",
      });
    }

    const normalizedBin = normalizeFsPath(openClawBin);
    if (!fs.existsSync(normalizedBin)) {
      return createOpenClawStatus({
        ...baseStatus,
        openclaw_bin: normalizedBin,
        status_code: "executable_missing",
        last_error: `Executable does not exist: ${normalizedBin}`,
      });
    }

    const stateDir = path.join(os.homedir(), ".openclaw");
    const configPath = path.join(stateDir, "openclaw.json");
    const authPath = path.join(stateDir, "agents", "main", "agent", "auth-profiles.json");
    const currentModelFromConfig = readCurrentModelFromConfig(configPath);
    const statusBaseWithPaths = {
      ...baseStatus,
      openclaw_bin: normalizedBin,
      openclaw_state_dir: stateDir,
      openclaw_config_path: configPath,
      current_model: currentModelFromConfig,
    };

    if (!fs.existsSync(stateDir)) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "state_dir_missing",
        last_error: `State directory does not exist: ${stateDir}`,
      });
    }

    if (!fs.existsSync(configPath)) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "config_missing",
        last_error: `Config file does not exist: ${configPath}`,
      });
    }

    if (!fs.existsSync(authPath)) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "auth_missing",
        last_error: `Auth file does not exist: ${authPath}`,
      });
    }

    const env = this.buildCommandEnvironment(normalizedBin);

    try {
      await execBufferedCommand(normalizedBin, ["--version"], {
        cwd: this.config.flowRoot,
        env,
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (error) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "version_failed",
        last_error: toErrorMessage(error),
      });
    }

    try {
      const gateway = await execBufferedCommand(normalizedBin, ["gateway", "status"], {
        cwd: this.config.flowRoot,
        env,
        timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const gatewayOutput = `${gateway.stdout}\n${gateway.stderr}`;
      if (!/RPC probe:\s*ok/i.test(gatewayOutput)) {
        return createOpenClawStatus({
          ...statusBaseWithPaths,
          status_code: "gateway_offline",
          last_error: gatewayOutput.trim() || "OpenClaw gateway did not report RPC probe: ok.",
        });
      }
    } catch (error) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "gateway_offline",
        last_error: toErrorMessage(error),
      });
    }

    try {
      const probe = await execBufferedCommand(
        normalizedBin,
        [
          "agent",
          "--session-id",
          `flow-system-probe-${Date.now()}`,
          "--message",
          "flow-system probe",
          "--json",
          "--timeout",
          String(Math.max(Math.min(this.config.openClawTimeoutSeconds, 12), 5)),
        ],
        {
          cwd: this.config.flowRoot,
          env,
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      const payload = parseOpenClawAgentResponse(probe.stdout, probe.stderr);
      const isProbeReady = payload.status === "ok" || payload.summary === "completed";
      if (!isProbeReady) {
        return createOpenClawStatus({
          ...statusBaseWithPaths,
          status_code: "agent_probe_failed",
          last_error: `OpenClaw agent probe returned status: ${payload.status ?? payload.summary ?? "unknown"}`,
        });
      }
    } catch (error) {
      return createOpenClawStatus({
        ...statusBaseWithPaths,
        status_code: "agent_probe_failed",
        last_error: toErrorMessage(error),
      });
    }

    const currentModel = currentModelFromConfig ?? await this.readCurrentModelFromCli(normalizedBin, env);

    return createOpenClawStatus({
      ...statusBaseWithPaths,
      current_model: currentModel,
      status_code: "ready",
      last_error: null,
    });
  }

  private resolveExecutableFromRoot(rootPath: string): string | null {
    for (const relativeDir of OPENCLAW_ROOT_SEARCH_DIRS) {
      const candidateDir = path.join(rootPath, relativeDir);
      if (!fs.existsSync(candidateDir) || !fs.statSync(candidateDir).isDirectory()) {
        continue;
      }

      const candidate = fs.readdirSync(candidateDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(candidateDir, entry.name))
        .filter((entryPath) => isSupportedOpenClawLauncher(entryPath))
        .sort((left, right) => getOpenClawLauncherPriority(left) - getOpenClawLauncherPriority(right))[0];

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  private resolveExecutableFromSelection(selectedPath: string): string {
    if (isDirectOpenClawCliLauncher(selectedPath)) {
      return selectedPath;
    }

    const searchRoots = [
      path.dirname(selectedPath),
      path.dirname(path.dirname(selectedPath)),
    ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

    for (const rootPath of searchRoots) {
      const resolved = this.resolveExecutableFromRoot(rootPath);
      if (resolved) {
        return resolved;
      }
    }

    return selectedPath;
  }

  private buildCommandEnvironment(openClawBin: string): NodeJS.ProcessEnv {
    const commandDir = path.dirname(openClawBin);
    return {
      ...process.env,
      PATH: [commandDir, process.env.PATH ?? ""]
        .filter((value) => value.length > 0)
        .join(path.delimiter),
    };
  }

  private async readCurrentModelFromCli(openClawBin: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    try {
      const result = await execBufferedCommand(openClawBin, ["models", "status", "--plain"], {
        cwd: this.config.flowRoot,
        env,
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return parseCurrentModelFromStatusOutput(`${result.stdout}\n${result.stderr}`);
    } catch {
      return null;
    }
  }

  private async pickPath(kind: PickerKind): Promise<string | null> {
    if (process.platform !== "win32") {
      throw new Error("Interactive OpenClaw selection is only supported on Windows.");
    }

    const result = await execBufferedCommand("powershell.exe", createWindowsPickerCommand(kind), {
      cwd: this.config.flowRoot,
      env: process.env,
      timeout: OPENCLAW_PICKER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const selectedPath = result.stdout.trim();
    return selectedPath.length > 0 ? selectedPath : null;
  }
}
