import fs from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import { readPlatformApiConfig } from "../config.js";
import { closeDbClient, getDbClient, getDbPool } from "./client.js";
import { currentSchemaVersion } from "./constants.js";

type VerificationResult = {
  ok: boolean;
  schema_version: string | null;
  import_run_id: string | null;
  counts: {
    expected: Record<string, number>;
    actual: Record<string, number>;
    match: boolean;
  };
  relations: Record<string, { ok: boolean; orphan_count: number }>;
  content: Record<string, unknown>;
};

function filePath(storageRoot: string, relPath: string): string {
  return path.resolve(storageRoot, relPath);
}

async function main(): Promise<void> {
  const config = readPlatformApiConfig();
  if (config.storageMode !== "postgres") {
    throw new Error("db:verify-import requires STORAGE_MODE=postgres");
  }

  const db = getDbClient(config.databaseUrl);
  const pool = getDbPool(config.databaseUrl);

  const latestImportRows = await db.execute(sql`
    select import_run_id, schema_version, counts_json
    from import_runs
    where status = 'completed'
    order by started_at desc
    limit 1
  `);
  const latestImport = latestImportRows.rows[0];
  if (!latestImport) {
    throw new Error("No completed import_runs record found.");
  }

  const schemaRows = await db.execute(sql`
    select value_json
    from system_meta
    where meta_key = 'schema_version'
    limit 1
  `);
  const schemaVersion = typeof schemaRows.rows[0]?.value_json === "string" ? schemaRows.rows[0].value_json : null;

  const countRow = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute(query);
    return Number(result.rows[0]?.count ?? 0);
  };

  const actualCounts = {
    users: await countRow(sql`select count(*)::int as count from users where deleted_at is null`),
    agents: await countRow(sql`select count(*)::int as count from agents`),
    projects: await countRow(sql`select count(*)::int as count from projects`),
    tasks: await countRow(sql`select count(*)::int as count from tasks`),
    checklist_items: await countRow(sql`select count(*)::int as count from task_checklist_items`),
    events: await countRow(sql`select count(*)::int as count from events`),
    conversations: await countRow(sql`select count(*)::int as count from conversations`),
    conversation_messages: await countRow(sql`select count(*)::int as count from conversation_messages`),
    file_objects: await countRow(sql`select count(*)::int as count from file_objects`),
    agent_releases: await countRow(sql`select count(*)::int as count from agent_releases`),
  };

  const expectedCounts = (latestImport.counts_json ?? {}) as Record<string, number>;
  const relationCounts = {
    tasks_project_fk: await countRow(sql`
      select count(*)::int as count
      from tasks t
      left join projects p on p.project_id = t.project_id
      where p.project_id is null
    `),
    tasks_assignee_user_fk: await countRow(sql`
      select count(*)::int as count
      from tasks t
      left join users u on u.user_id = t.assignee_user_id
      where u.user_id is null
    `),
    tasks_sender_user_fk: await countRow(sql`
      select count(*)::int as count
      from tasks t
      left join users u on u.user_id = t.sender_user_id
      where u.user_id is null
    `),
    file_objects_project_fk: await countRow(sql`
      select count(*)::int as count
      from file_objects f
      left join projects p on p.project_id = f.project_id
      where f.project_id is not null and p.project_id is null
    `),
    file_objects_task_fk: await countRow(sql`
      select count(*)::int as count
      from file_objects f
      left join tasks t on t.task_id = f.task_id
      where f.task_id is not null and t.task_id is null
    `),
    file_objects_created_by_user_fk: await countRow(sql`
      select count(*)::int as count
      from file_objects f
      left join users u on u.user_id = f.created_by_user_id
      where f.created_by_user_id is not null and u.user_id is null
    `),
    file_objects_created_by_agent_fk: await countRow(sql`
      select count(*)::int as count
      from file_objects f
      left join agents a on a.agent_id = f.created_by_agent_id
      where f.created_by_agent_id is not null and a.agent_id is null
    `),
    conversation_messages_conversation_fk: await countRow(sql`
      select count(*)::int as count
      from conversation_messages m
      left join conversations c on c.conversation_id = m.conversation_id
      where c.conversation_id is null
    `),
  };

  const releaseRows = await db.execute(sql`
    select version, package_rel_path, is_current
    from agent_releases
    order by is_current desc, published_at desc
  `);
  const missingReleaseFiles = releaseRows.rows.filter((row) =>
    !fs.existsSync(filePath(config.storageRoot, String(row.package_rel_path)))).length;

  const projectSamples = await db.execute(sql`
    select project_id, project_name
    from projects
    order by created_at asc
    limit 3
  `);

  const taskSamples = await db.execute(sql`
    select task_id
    from tasks
    order by created_at asc
    limit 5
  `);
  const taskTimelineSamples: Array<{ task_id: string; event_count: number }> = [];
  for (const row of taskSamples.rows) {
    const count = await countRow(sql`select count(*)::int as count from events where task_id = ${String(row.task_id)}`);
    taskTimelineSamples.push({
      task_id: String(row.task_id),
      event_count: count,
    });
  }

  const attachmentRows = await db.execute(sql`
    select file_id, storage_rel_path
    from file_objects
    where purpose = 'attachment'
    order by created_at asc
    limit 3
  `);
  const attachmentSamples = attachmentRows.rows.map((row) => ({
    file_id: String(row.file_id),
    exists: fs.existsSync(filePath(config.storageRoot, String(row.storage_rel_path))),
  }));

  const releaseSample = releaseRows.rows[0]
    ? {
        version: String(releaseRows.rows[0].version),
        exists: fs.existsSync(filePath(config.storageRoot, String(releaseRows.rows[0].package_rel_path))),
      }
    : { status: "not_applicable" };

  let pendingConversationAck: Record<string, unknown>;
  const client = await pool.connect();
  try {
    const pending = await client.query(
      `
        select message_id, target_agent_id
        from conversation_messages
        where sync_status = 'pending' and target_agent_id is not null
        order by created_at asc
        limit 1
      `,
    );

    if (pending.rowCount === 0) {
      pendingConversationAck = { status: "not_applicable" };
    } else {
      const row = pending.rows[0];
      await client.query("BEGIN");
      await client.query(
        `
          update conversation_messages
          set sync_status = 'synced',
              delivered_to_agent_at = now(),
              updated_at = now()
          where message_id = $1 and target_agent_id = $2 and sync_status = 'pending'
        `,
        [row.message_id, row.target_agent_id],
      );
      const after = await client.query(
        `
          select sync_status
          from conversation_messages
          where message_id = $1
        `,
        [row.message_id],
      );
      await client.query("ROLLBACK");

      pendingConversationAck = {
        status: after.rows[0]?.sync_status === "synced" ? "validated_in_rollback" : "failed",
        message_id: row.message_id,
      };
    }
  } finally {
    client.release();
  }

  const countsMatch = Object.entries(expectedCounts).every(([key, value]) => actualCounts[key as keyof typeof actualCounts] === value);
  const relations = {
    tasks_project_fk: { ok: relationCounts.tasks_project_fk === 0, orphan_count: relationCounts.tasks_project_fk },
    tasks_assignee_user_fk: { ok: relationCounts.tasks_assignee_user_fk === 0, orphan_count: relationCounts.tasks_assignee_user_fk },
    tasks_sender_user_fk: { ok: relationCounts.tasks_sender_user_fk === 0, orphan_count: relationCounts.tasks_sender_user_fk },
    file_objects_project_fk: { ok: relationCounts.file_objects_project_fk === 0, orphan_count: relationCounts.file_objects_project_fk },
    file_objects_task_fk: { ok: relationCounts.file_objects_task_fk === 0, orphan_count: relationCounts.file_objects_task_fk },
    file_objects_created_by_user_fk: { ok: relationCounts.file_objects_created_by_user_fk === 0, orphan_count: relationCounts.file_objects_created_by_user_fk },
    file_objects_created_by_agent_fk: { ok: relationCounts.file_objects_created_by_agent_fk === 0, orphan_count: relationCounts.file_objects_created_by_agent_fk },
    conversation_messages_conversation_fk: {
      ok: relationCounts.conversation_messages_conversation_fk === 0,
      orphan_count: relationCounts.conversation_messages_conversation_fk,
    },
    release_package_paths: { ok: missingReleaseFiles === 0, orphan_count: missingReleaseFiles },
  };

  const content = {
    projects: {
      status: projectSamples.rows.length > 0 ? "validated" : "not_applicable",
      samples: projectSamples.rows,
    },
    task_timelines: {
      status: taskTimelineSamples.length > 0 ? "validated" : "not_applicable",
      samples: taskTimelineSamples,
    },
    attachments: {
      status: attachmentSamples.length > 0 ? (attachmentSamples.every((sample) => sample.exists) ? "validated" : "failed") : "not_applicable",
      samples: attachmentSamples,
    },
    release_package: releaseSample,
    pending_conversation_ack: pendingConversationAck,
  };

  const contentOk =
    content.attachments.status !== "failed"
    && !Object.values(relations).some((entry) => !entry.ok)
    && (content.pending_conversation_ack.status === "validated_in_rollback"
      || content.pending_conversation_ack.status === "not_applicable");

  const result: VerificationResult = {
    ok: schemaVersion === currentSchemaVersion && countsMatch && !Object.values(relations).some((entry) => !entry.ok) && contentOk,
    schema_version: schemaVersion,
    import_run_id: String(latestImport.import_run_id),
    counts: {
      expected: expectedCounts,
      actual: actualCounts,
      match: countsMatch,
    },
    relations,
    content,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
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
