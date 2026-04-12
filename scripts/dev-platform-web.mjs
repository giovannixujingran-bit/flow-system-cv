import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.join(repoRoot, "apps", "platform-web");
const distDir = process.env.FLOW_NEXT_DIST_DIR?.trim() || ".next-dev";
const nextArtifactsRoot = path.join(workspaceRoot, distDir);
const host = process.env.HOSTNAME ?? process.env.HOST ?? "127.0.0.1";
const port = process.env.PORT ?? "3000";
const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");

function resetNextDevArtifacts() {
  if (!fs.existsSync(nextArtifactsRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(nextArtifactsRoot)) {
    if (entry === "cache") {
      continue;
    }

    fs.rmSync(path.join(nextArtifactsRoot, entry), { recursive: true, force: true });
  }
}

function buildDevEnvironment() {
  const env = { ...process.env };
  env.FLOW_NEXT_DIST_DIR = distDir;

  // Polling on Windows has been causing Watchpack to scan the whole drive,
  // which leaves Next dev artifacts in a partially generated state.
  if (!process.env.WATCHPACK_POLLING) {
    delete env.WATCHPACK_POLLING;
  }
  if (!process.env.CHOKIDAR_USEPOLLING) {
    delete env.CHOKIDAR_USEPOLLING;
  }

  return env;
}

resetNextDevArtifacts();

const child = spawn(
  process.execPath,
  [nextBin, "dev", "--hostname", host, "--port", port],
  {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: buildDevEnvironment(),
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});
