import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export type BufferedCommandResult = {
  stdout: string;
  stderr: string;
};

const execFileAsync = promisify(execFile);

type ExecBufferedCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  stdin?: string;
};

function toPowerShellSingleQuotedLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export async function execBufferedCommand(
  command: string,
  args: string[],
  options: ExecBufferedCommandOptions,
): Promise<BufferedCommandResult> {
  const extension = path.extname(command).toLowerCase();
  const requiresCmdShell = process.platform === "win32" && (extension === ".cmd" || extension === ".bat");

  if (options.stdin !== undefined) {
    if (requiresCmdShell) {
      throw new Error("stdin is not supported for Windows .cmd/.bat commands");
    }

    return await execBufferedCommandWithStdin(command, args, options);
  }

  if (!requiresCmdShell) {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
      killSignal: "SIGKILL",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const powerShellScript = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8",
    `$command = ${toPowerShellSingleQuotedLiteral(command)}`,
    `$argsList = @(${args.map((value) => toPowerShellSingleQuotedLiteral(value)).join(", ")})`,
    "& $command @argsList",
    "exit $LASTEXITCODE",
  ].join("\n");

  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(powerShellScript),
    ],
    {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
      windowsHide: true,
      killSignal: "SIGKILL",
    },
  ).catch((error: Error & { stdout?: string; stderr?: string }) => {
    throw new Error(error.stderr || error.stdout || error.message);
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function execBufferedCommandWithStdin(
  command: string,
  args: string[],
  options: ExecBufferedCommandOptions,
): Promise<BufferedCommandResult> {
  let stdout = "";
  let stderr = "";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let bufferedBytes = 0;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      stdout = Buffer.concat(stdoutChunks).toString("utf8");
      stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (error) {
        const message = stderr || stdout || error.message;
        reject(new Error(message));
        return;
      }
      resolve();
    };

    const appendChunk = (target: Buffer[], chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bufferedBytes += buffer.length;
      if (bufferedBytes > options.maxBuffer) {
        child.kill("SIGKILL");
        finish(new Error(`Command output exceeded maxBuffer of ${options.maxBuffer} bytes`));
        return;
      }
      target.push(buffer);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Command timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.stdout.on("data", (chunk) => appendChunk(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => appendChunk(stderrChunks, chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code && code !== 0) {
        finish(new Error(`Command exited with code ${code}`));
        return;
      }
      finish();
    });

    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }
  });

  return {
    stdout,
    stderr,
  };
}
