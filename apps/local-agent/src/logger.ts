import fs from "node:fs";
import path from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

export class AgentLogger {
  constructor(private readonly filePath: string) {
    this.ensureParentDir();
  }

  debug(message: string, payload?: unknown): void {
    this.write("debug", message, payload);
  }

  info(message: string, payload?: unknown): void {
    this.write("info", message, payload);
  }

  warn(message: string, payload?: unknown): void {
    this.write("warn", message, payload);
  }

  error(message: string, payload?: unknown): void {
    this.write("error", message, payload);
  }

  private rotateIfNeeded(): void {
    this.ensureParentDir();
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    let size = 0;
    try {
      size = fs.statSync(this.filePath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (size < MAX_BYTES) {
      return;
    }
    for (let index = MAX_FILES - 1; index >= 1; index -= 1) {
      const source = `${this.filePath}.${index}`;
      const target = `${this.filePath}.${index + 1}`;
      if (fs.existsSync(source)) {
        try {
          fs.renameSync(source, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
    try {
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private write(level: LogLevel, message: string, payload?: unknown): void {
    this.rotateIfNeeded();
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      payload,
    });
    this.ensureParentDir();
    try {
      fs.appendFileSync(this.filePath, `${line}\n`, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.ensureParentDir();
      fs.appendFileSync(this.filePath, `${line}\n`, "utf8");
    }
  }

  private ensureParentDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }
}
