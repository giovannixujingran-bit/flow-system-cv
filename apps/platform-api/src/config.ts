import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type PlatformApiConfig = {
  storageMode: "memory" | "postgres";
  seedMode: "managed" | "empty" | "demo";
  allowLanAutoRegister: boolean;
  databaseUrl: string | undefined;
  runMigrations: boolean;
  importCurrentState: boolean;
  failIfDbEmptyAndNoImport: boolean;
  port: number;
  host: string;
  appOrigin: string;
  storageRoot: string;
  stateSnapshotFile: string;
  managedUsersFile: string;
  managedUsersSummaryFile: string;
  cookieSecret: string;
  sessionTtlMs: number;
  pollIntervalSeconds: number;
  heartbeatOfflineSeconds: number;
  staleMinutes: number;
  riskScanSeconds: number;
  activeHoursStart: string;
  activeHoursEnd: string;
  activeWeekdays: number[];
  maxFileSizeBytes: number;
  maxTaskBytes: number;
};

export function readPlatformApiConfig(): PlatformApiConfig {
  const seedMode = process.env.FLOW_SEED_MODE === "demo"
    ? "demo"
    : process.env.FLOW_SEED_MODE === "empty"
      ? "empty"
      : "managed";
  const storageRoot = process.env.STORAGE_ROOT ?? path.join(defaultRepoRoot, "storage");

  return {
    storageMode: process.env.STORAGE_MODE === "postgres" ? "postgres" : "memory",
    seedMode,
    allowLanAutoRegister:
      process.env.ALLOW_LAN_AUTO_REGISTER === "true"
      || process.env.HOST === "0.0.0.0",
    databaseUrl: process.env.DATABASE_URL,
    runMigrations: process.env.RUN_MIGRATIONS === "true",
    importCurrentState: process.env.IMPORT_CURRENT_STATE === "true",
    failIfDbEmptyAndNoImport: process.env.FAIL_IF_DB_EMPTY_AND_NO_IMPORT !== "false",
    port: Number(process.env.PORT ?? 4010),
    host: process.env.HOST ?? "127.0.0.1",
    appOrigin: process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
    storageRoot,
    stateSnapshotFile:
      process.env.PLATFORM_STATE_SNAPSHOT_FILE ?? path.join(storageRoot, "platform-state.json"),
    managedUsersFile:
      process.env.MANAGED_USERS_FILE ?? path.join(defaultRepoRoot, "account-management", "managed-users.json"),
    managedUsersSummaryFile:
      process.env.MANAGED_USERS_SUMMARY_FILE
      ?? path.join(defaultRepoRoot, "account-management", "accounts-summary.txt"),
    cookieSecret: process.env.COOKIE_SECRET ?? "flow-system-dev-cookie-secret",
    sessionTtlMs: Number(process.env.SESSION_TTL_HOURS ?? 8) * 60 * 60 * 1000,
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 15),
    heartbeatOfflineSeconds: Number(process.env.HEARTBEAT_OFFLINE_SECONDS ?? 45),
    staleMinutes: Number(process.env.STALE_MINUTES ?? 240),
    riskScanSeconds: Number(process.env.RISK_SCAN_SECONDS ?? 60),
    activeHoursStart: process.env.ACTIVE_HOURS_START ?? "09:00",
    activeHoursEnd: process.env.ACTIVE_HOURS_END ?? "18:00",
    activeWeekdays: (process.env.ACTIVE_WEEKDAYS ?? "1,2,3,4,5")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
    maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES ?? 10 * 1024 * 1024 * 1024),
    maxTaskBytes: Number(process.env.MAX_TASK_BYTES ?? 10 * 1024 * 1024 * 1024),
  };
}
