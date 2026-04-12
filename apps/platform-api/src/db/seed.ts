import { hashSync } from "bcryptjs";
import { sql } from "drizzle-orm";

import { getDbClient, closeDbClient } from "./client.js";
import { agents, bootstrapTokens, projects, sessions, tasks, users, workflowTemplates, workflows } from "./schema.js";
import { hashToken } from "../state.js";

async function main(): Promise<void> {
  const db = getDbClient();
  const now = new Date();

  await db.execute(sql`
    truncate table
      ${sessions},
      ${tasks},
      ${workflows},
      ${workflowTemplates},
      ${projects},
      ${agents},
      ${bootstrapTokens},
      ${users}
    restart identity cascade
  `);

  await db.insert(users).values([
    {
      userId: "user_admin",
      username: "admin",
      passwordHash: hashSync("admin123", 10),
      role: "admin",
      displayName: "管理员",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: "user_owner",
      username: "owner",
      passwordHash: hashSync("owner123", 10),
      role: "owner",
      displayName: "项目负责人",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: "user_member",
      username: "member",
      passwordHash: hashSync("member123", 10),
      role: "member",
      displayName: "执行成员",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(projects).values({
    projectId: "proj_demo",
    projectCode: "FLOW-DEMO",
    projectName: "流程协作示例项目",
    description: "用于验证任务投递与本地接收闭环的示例项目。",
    department: "operations",
    ownerUserId: "user_owner",
    participantUserIdsJson: ["user_owner", "user_member"],
    projectType: "delivery",
    status: "in_progress",
    priority: "P1",
    startDate: now,
    dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    currentStage: "进行中",
    completionRate: 0,
    attachmentManifestJson: [],
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(workflowTemplates).values({
    workflowTemplateId: "wf_tmpl_demo_v1",
    workflowName: "企划修订流程",
    workflowType: "planning_revision",
    templateVersion: 1,
    isActive: true,
    stepsJson: [
      {
        step_id: "step_design",
        step_code: "design",
        step_name: "设计输出",
        step_order: 1,
        owner_role: "designer",
        sla_minutes: 240,
      },
      {
        step_id: "step_excel_revise",
        step_code: "excel_revise",
        step_name: "Excel 修订",
        step_order: 2,
        owner_role: "planner",
        sla_minutes: 180,
      },
      {
        step_id: "step_review",
        step_code: "review",
        step_name: "审核",
        step_order: 3,
        owner_role: "reviewer",
        sla_minutes: 120,
      },
    ],
    createdAt: now,
  });

  await db.insert(workflows).values({
    workflowId: "wf_demo",
    projectId: "proj_demo",
    workflowTemplateId: "wf_tmpl_demo_v1",
    templateVersion: 1,
    workflowName: "企划修订流程",
    workflowType: "planning_revision",
    status: "delivered",
    currentStepId: "step_excel_revise",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(bootstrapTokens).values({
    bootstrapTokenId: "req_bootstrap_local",
    tokenHash: hashToken("flow-bootstrap-local"),
    tokenPlaintext: "flow-bootstrap-local",
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbClient();
  });
