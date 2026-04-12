import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readPlatformApiConfig } from "../apps/platform-api/src/config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("platform api config", () => {
  afterEach(() => {
    delete process.env.STORAGE_MODE;
    delete process.env.DATABASE_URL;
    delete process.env.RUN_MIGRATIONS;
    delete process.env.IMPORT_CURRENT_STATE;
    delete process.env.FAIL_IF_DB_EMPTY_AND_NO_IMPORT;
    delete process.env.STORAGE_ROOT;
    delete process.env.PLATFORM_STATE_SNAPSHOT_FILE;
    delete process.env.MANAGED_USERS_FILE;
    delete process.env.MANAGED_USERS_SUMMARY_FILE;
  });

  it("resolves default storage paths from the repository root", () => {
    const config = readPlatformApiConfig();

    expect(config.storageRoot).toBe(path.join(repoRoot, "storage"));
    expect(config.stateSnapshotFile).toBe(path.join(repoRoot, "storage", "platform-state.json"));
    expect(config.managedUsersFile).toBe(path.join(repoRoot, "account-management", "managed-users.json"));
    expect(config.managedUsersSummaryFile).toBe(path.join(repoRoot, "account-management", "accounts-summary.txt"));
  });

  it("reads postgres cutover flags from the environment", () => {
    process.env.STORAGE_MODE = "postgres";
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/flow_system";
    process.env.RUN_MIGRATIONS = "true";
    process.env.IMPORT_CURRENT_STATE = "true";
    process.env.FAIL_IF_DB_EMPTY_AND_NO_IMPORT = "false";

    const config = readPlatformApiConfig();

    expect(config.storageMode).toBe("postgres");
    expect(config.databaseUrl).toBe("postgres://postgres:postgres@127.0.0.1:5432/flow_system");
    expect(config.runMigrations).toBe(true);
    expect(config.importCurrentState).toBe(true);
    expect(config.failIfDbEmptyAndNoImport).toBe(false);
  });

  it("derives the snapshot path from STORAGE_ROOT when no explicit snapshot path is provided", () => {
    process.env.STORAGE_ROOT = "D:\\tmp\\flow-storage";

    const config = readPlatformApiConfig();

    expect(config.storageRoot).toBe("D:\\tmp\\flow-storage");
    expect(config.stateSnapshotFile).toBe(path.join("D:\\tmp\\flow-storage", "platform-state.json"));
  });
});
