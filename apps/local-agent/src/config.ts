import os from "node:os";
import fs from "node:fs";
import path from "node:path";

export type LocalAgentConfig = {
  platformApiBaseUrl: string;
  platformWebOrigin: string;
  bootstrapToken: string | undefined;
  agentId: string | undefined;
  agentToken: string | undefined;
  agentName: string;
  ownerUserId: string;
  runtimeVersion: string;
  appRoot: string;
  uiHost: string;
  uiPort: number;
  pollIntervalSeconds: number;
  updateCheckIntervalSeconds: number;
  flowRoot: string;
  conversationsRoot: string;
  tasksRoot: string;
  tmpRoot: string;
  updatesRoot: string;
  recoveryRoot: string;
  overlayDataRoot: string;
  dataRoot: string;
  logsRoot: string;
  backupsRoot: string;
  databasePath: string;
  logFilePath: string;
  openClawConnectionPath: string;
  openClawBin: string | undefined;
  openClawTimeoutSeconds: number;
  openClawAutoReplyEnabled: boolean;
  nodeExecutablePath: string;
  npmCliPath: string | undefined;
  restartCommand: string | undefined;
  maxOutboxWarning: number;
  maxOutboxHardLimit: number;
  recoveryRetentionDays: number;
};

const defaultBootstrapToken = "flow-bootstrap-local";

function readBootstrapToken(): string | undefined {
  if (process.env.FLOW_AGENT_AUTO_REGISTER === "1") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(process.env, "FLOW_AGENT_BOOTSTRAP_TOKEN")) {
    const configuredToken = process.env.FLOW_AGENT_BOOTSTRAP_TOKEN?.trim();
    return configuredToken && configuredToken.length > 0 ? configuredToken : undefined;
  }
  return defaultBootstrapToken;
}

function derivePlatformWebOrigin(platformApiBaseUrl: string): string {
  try {
    const url = new URL(platformApiBaseUrl);
    url.port = url.port === "4010" || url.port === "" ? "3000" : url.port;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:3000";
  }
}

function readRuntimeVersion(appRoot: string): string {
  const candidatePaths = [
    path.join(appRoot, "apps", "local-agent", "package.json"),
    path.join(appRoot, "package.json"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    try {
      const payload = JSON.parse(fs.readFileSync(candidatePath, "utf8")) as { version?: string };
      if (payload.version) {
        return payload.version;
      }
    } catch {
      continue;
    }
  }

  return "0.1.0";
}

export function readLocalAgentConfig(): LocalAgentConfig {
  const flowRoot = process.env.FLOWCARD_ROOT ?? path.join(os.homedir(), "FlowCard");
  const overlayDataRoot = process.env.FLOW_OVERLAY_DATA_ROOT ?? path.join(flowRoot, "overlay-data");
  const dataRoot = path.join(flowRoot, "agent-data");
  const logsRoot = path.join(dataRoot, "logs");
  const appRoot = process.env.FLOW_APP_ROOT ?? process.cwd();
  const runtimeVersion = process.env.FLOW_AGENT_RUNTIME_VERSION ?? readRuntimeVersion(appRoot);
  const platformApiBaseUrl = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

  return {
    platformApiBaseUrl,
    platformWebOrigin: process.env.FLOW_PLATFORM_WEB_ORIGIN ?? derivePlatformWebOrigin(platformApiBaseUrl),
    bootstrapToken: readBootstrapToken(),
    agentId: process.env.FLOW_AGENT_ID,
    agentToken: process.env.FLOW_AGENT_TOKEN,
    agentName: process.env.FLOW_AGENT_NAME ?? os.hostname(),
    ownerUserId: process.env.FLOW_AGENT_OWNER_USER_ID ?? "user_admin",
    runtimeVersion,
    appRoot,
    uiHost: "127.0.0.1",
    uiPort: Number(process.env.FLOW_AGENT_UI_PORT ?? 38500),
    pollIntervalSeconds: Number(process.env.FLOW_AGENT_POLL_INTERVAL_SECONDS ?? 15),
    updateCheckIntervalSeconds: Number(process.env.FLOW_AGENT_UPDATE_CHECK_INTERVAL_SECONDS ?? 60),
    flowRoot,
    conversationsRoot: path.join(flowRoot, "conversations"),
    tasksRoot: path.join(flowRoot, "tasks"),
    tmpRoot: path.join(flowRoot, "tmp"),
    updatesRoot: path.join(flowRoot, "updates"),
    recoveryRoot: path.join(flowRoot, "recovery"),
    overlayDataRoot,
    dataRoot,
    logsRoot,
    backupsRoot: path.join(dataRoot, "backups"),
    databasePath: path.join(dataRoot, "agent.sqlite"),
    logFilePath: path.join(logsRoot, "agent.log"),
    openClawConnectionPath: path.join(dataRoot, "openclaw-connection.json"),
    openClawBin: process.env.FLOW_OPENCLAW_BIN,
    openClawTimeoutSeconds: Number(process.env.FLOW_OPENCLAW_TIMEOUT_SECONDS ?? 90),
    openClawAutoReplyEnabled: (process.env.FLOW_OPENCLAW_AUTO_REPLY ?? "1") !== "0",
    nodeExecutablePath: process.env.FLOW_AGENT_NODE_PATH ?? process.execPath,
    npmCliPath: process.env.FLOW_AGENT_NPM_CLI_PATH,
    restartCommand: process.env.FLOW_AGENT_RESTART_COMMAND,
    maxOutboxWarning: 1000,
    maxOutboxHardLimit: 5000,
    recoveryRetentionDays: 7,
  };
}
