import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const managedUsersFile = process.env.MANAGED_USERS_FILE ?? path.join(repoRoot, "account-management", "managed-users.json");
const summaryFile =
  process.env.MANAGED_USERS_SUMMARY_FILE ?? path.join(repoRoot, "account-management", "accounts-summary.txt");

function formatSummary(accounts) {
  const lines = [
    "Flow System 账号清单",
    "",
    "说明：",
    "- 这些账号由平台管理员统一分发。",
    "- 收件人不需要自行创建管理员账号。",
    "- 启动本机代理时，请将 OwnerUserId 设置成对应 user_id。",
    "",
  ];

  accounts.forEach((account, index) => {
    lines.push(`${index + 1}. ${account.display_name}`);
    lines.push(`   user_id: ${account.user_id}`);
    lines.push(`   username: ${account.username}`);
    lines.push(`   password: ${account.password}`);
    lines.push(`   role: ${account.role}`);
    lines.push(`   status: ${account.status ?? "active"}`);
    lines.push("");
  });

  lines.push("本机代理启动示例：");
  lines.push(".\\start-flow-agent.cmd -OwnerUserId <user_id> -UiPort 38500");

  return `${lines.join("\n")}\n`;
}

const payload = JSON.parse(fs.readFileSync(managedUsersFile, "utf8"));
const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
fs.writeFileSync(summaryFile, `\uFEFF${formatSummary(accounts)}`, "utf8");
console.log(`Synced managed accounts summary -> ${summaryFile}`);
