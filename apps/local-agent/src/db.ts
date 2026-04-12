import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { LocalAgentConfig } from "./config.js";

export type LocalTaskRow = {
  task_id: string;
  project_id: string;
  project_name: string | null;
  workflow_id: string;
  step_id: string;
  task_title: string;
  task_type: string;
  assignee_display_name: string | null;
  status: string;
  progress_percent: number;
  summary: string;
  deadline: string;
  local_task_path: string;
  output_path: string;
  attachment_manifest_json: string;
  created_at: string;
  updated_at: string;
  last_event_at: string;
};

export type OutboxRow = {
  id: number;
  request_id: string;
  endpoint: string;
  method: string;
  payload_json: string;
  status: string;
  retry_count: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalConversationMessageRow = {
  message_id: string;
  conversation_id: string;
  message_type: string;
  author_kind: string;
  body: string;
  source_user_id: string | null;
  source_display_name: string | null;
  target_user_id: string | null;
  target_agent_id: string | null;
  sync_status: string;
  sync_detail: string | null;
  delivered_to_agent_at: string | null;
  created_at: string;
  updated_at: string;
};

export class AgentDatabase {
  readonly connection: Database.Database;

  constructor(config: LocalAgentConfig) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    this.connection = new Database(config.databasePath);
    this.connection.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(`
      create table if not exists local_tasks (
        task_id text primary key,
        project_id text not null,
        project_name text,
        workflow_id text not null,
        step_id text not null,
        task_title text not null,
        task_type text not null,
        assignee_display_name text,
        status text not null,
        progress_percent integer not null,
        summary text not null,
        deadline text not null,
        local_task_path text not null,
        output_path text not null,
        attachment_manifest_json text not null,
        created_at text not null,
        updated_at text not null,
        last_event_at text not null
      );
      create table if not exists local_checklist_items (
        checklist_item_id text primary key,
        task_id text not null,
        item_order integer not null,
        item_title text not null,
        item_description text,
        status text not null,
        completed_at text,
        completed_by text,
        source text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists local_conversations (
        conversation_id text primary key,
        owner_user_id text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists local_conversation_messages (
        message_id text primary key,
        conversation_id text not null,
        message_type text not null,
        author_kind text not null,
        body text not null,
        source_user_id text,
        source_display_name text,
        target_user_id text,
        target_agent_id text,
        sync_status text not null,
        sync_detail text,
        delivered_to_agent_at text,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists local_events (
        id integer primary key autoincrement,
        request_id text not null,
        task_id text,
        event_type text not null,
        payload_json text not null,
        occurred_at text not null
      );
      create table if not exists local_settings (
        key text primary key,
        value text not null
      );
      create table if not exists sync_outbox (
        id integer primary key autoincrement,
        request_id text not null unique,
        endpoint text not null,
        method text not null,
        payload_json text not null,
        status text not null,
        retry_count integer not null,
        next_retry_at text not null,
        last_error text,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists sync_inbox (
        id integer primary key autoincrement,
        task_id text not null,
        payload_json text not null,
        received_at text not null
      );
      create table if not exists agent_state (
        key text primary key,
        value text not null
      );
    `);

    this.ensureColumn("local_tasks", "project_name", "text");
    this.ensureColumn("local_tasks", "assignee_display_name", "text");
    this.ensureColumn("local_conversation_messages", "sync_detail", "text");
  }

  private ensureColumn(tableName: string, columnName: string, columnType: string): void {
    const columns = this.connection.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.connection.exec(`alter table ${tableName} add column ${columnName} ${columnType}`);
  }
}
