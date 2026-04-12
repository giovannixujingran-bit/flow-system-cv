import fs from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import { readPlatformApiConfig } from "../config.js";
import { closeDbClient, getDbClient, getDbPool } from "./client.js";
import { currentSchemaVersion, systemMetaKeys } from "./constants.js";

function releaseRoot(storageRoot: string): string {
  return path.join(storageRoot, "releases", "agents");
}

async function main(): Promise<void> {
  const config = readPlatformApiConfig();
  if (config.storageMode !== "postgres") {
    throw new Error("db:preflight requires STORAGE_MODE=postgres");
  }

  const db = getDbClient(config.databaseUrl);
  const pool = getDbPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    await db.execute(sql`select 1`);

    const regclass = await db.execute(sql`select to_regclass('public.system_meta') as system_meta_name, to_regclass('public.users') as users_table_name`);
    const systemMetaExists = Boolean(regclass.rows[0]?.system_meta_name);
    const usersTableExists = Boolean(regclass.rows[0]?.users_table_name);

    let schemaVersion: string | null = null;
    if (systemMetaExists) {
      const rows = await db.execute(
        sql`select value_json from system_meta where meta_key = ${systemMetaKeys.schemaVersion} limit 1`,
      );
      schemaVersion = typeof rows.rows[0]?.value_json === "string" ? rows.rows[0].value_json : null;
    }

    let isEmptyState = true;
    if (usersTableExists) {
      const usersCount = await db.execute(sql`select count(*)::int as count from users`);
      isEmptyState = Number(usersCount.rows[0]?.count ?? 0) === 0;
    }

    await client.query("BEGIN");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");

    const storageWritable = (() => {
      try {
        fs.mkdirSync(config.storageRoot, { recursive: true });
        fs.accessSync(config.storageRoot, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })();

    const releaseDir = releaseRoot(config.storageRoot);
    fs.mkdirSync(releaseDir, { recursive: true });

    const payload = {
      ok: true,
      db_ok: true,
      empty_state: isEmptyState,
      storage_writable: storageWritable,
      release_dir_ok: fs.existsSync(releaseDir),
      schema_version: schemaVersion,
      schema_version_matches_target: schemaVersion === null ? false : schemaVersion === currentSchemaVersion,
      target_schema_version: currentSchemaVersion,
    };

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbClient();
  });
