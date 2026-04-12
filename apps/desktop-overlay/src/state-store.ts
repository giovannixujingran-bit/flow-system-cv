import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type OverlayDesktopState = {
  window_position?: { x: number; y: number };
  first_run_completed?: boolean;
  last_tab?: "conversation" | "tasks";
  muted?: boolean;
  last_platform_url?: string | null;
  last_read_conversation_message_at?: string | null;
};

function ensureDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

export class OverlayStateStore {
  readonly root: string;
  readonly filePath: string;

  constructor(root = process.env.FLOW_OVERLAY_DATA_ROOT ?? path.join(os.homedir(), "FlowCard", "overlay-data")) {
    this.root = root;
    this.filePath = path.join(root, "state.json");
    ensureDir(this.root);
  }

  read(): OverlayDesktopState {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as OverlayDesktopState;
    } catch {
      return {};
    }
  }

  write(patch: Partial<OverlayDesktopState>): OverlayDesktopState {
    const nextState = {
      ...this.read(),
      ...patch,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(nextState, null, 2), "utf8");
    return nextState;
  }
}
