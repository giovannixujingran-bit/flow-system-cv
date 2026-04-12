import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function appendLog(logFilePath, message, extra) {
  ensureDir(path.dirname(logFilePath));
  const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}\n`;
  fs.appendFileSync(logFilePath, line, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPidExit(pid, logFilePath) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await sleep(500);
    } catch {
      appendLog(logFilePath, "Parent process exited", { pid });
      return;
    }
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`);
}

function resolveSourceRoot(extractRoot) {
  const entries = fs.readdirSync(extractRoot, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractRoot, entries[0].name);
  }
  return extractRoot;
}

function copyTree(sourceRoot, targetRoot, logFilePath) {
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "runtime" || entry.name === "storage" || entry.name === ".git") {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      ensureDir(targetPath);
      copyTree(sourcePath, targetPath, logFilePath);
      continue;
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    appendLog(logFilePath, "Copied file", { targetPath });
  }
}

async function runCommand(command, args, options, logFilePath) {
  appendLog(logFilePath, "Running command", { command, args, cwd: options.cwd });
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "ignore",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    throw new Error("Updater spec path is required");
  }

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const logFilePath = spec.logFilePath;

  appendLog(logFilePath, "Updater started", { specPath });
  await waitForPidExit(spec.parentPid, logFilePath);

  const sourceRoot = resolveSourceRoot(spec.extractRoot);
  copyTree(sourceRoot, spec.appRoot, logFilePath);

  if (spec.npmCliPath) {
    await runCommand(spec.nodeExecutablePath, [spec.npmCliPath, "install", "--no-audit", "--no-fund"], {
      cwd: spec.appRoot,
      env: process.env,
    }, logFilePath);
  }

  const markerPath = path.join(spec.appRoot, "runtime", "updates", "last-applied.json");
  ensureDir(path.dirname(markerPath));
  fs.writeFileSync(markerPath, JSON.stringify({
    applied_version: spec.appliedVersion,
    applied_at: new Date().toISOString(),
  }, null, 2), "utf8");

  appendLog(logFilePath, "Restarting updated agent", { restartCommand: spec.restartCommand });
  spawn("bash", ["-lc", spec.restartCommand], {
    cwd: spec.appRoot,
    env: process.env,
    detached: true,
    stdio: "ignore",
  }).unref();
}

main().catch((error) => {
  const fallbackLog = process.argv[2] ? path.join(path.dirname(process.argv[2]), "updater-error.log") : path.resolve(process.cwd(), "updater-error.log");
  appendLog(fallbackLog, "Updater failed", { error: String(error) });
  process.exitCode = 1;
});
