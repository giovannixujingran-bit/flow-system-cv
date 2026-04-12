import path from "node:path";
import { fileURLToPath } from "node:url";

export const currentSchemaVersion = "0003_openclaw_task_progress";
export const currentImportToolVersion = "postgres-cutover-v2";
export const migrationTag = currentSchemaVersion;
export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export const systemMetaKeys = {
  schemaVersion: "schema_version",
  storageMode: "storage_mode",
  initialImportCompletedAt: "initial_import_completed_at",
  initialImportSourceStateHash: "initial_import_source_state_hash",
  initialImportToolVersion: "initial_import_tool_version",
  cutoverCompletedAt: "cutover_completed_at",
  lastImportCounts: "last_import_counts",
  lastCutoverStatus: "last_cutover_status",
} as const;
