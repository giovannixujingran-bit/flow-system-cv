import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { prepareLinuxTextInput } from "./linux-ime.js";
import { OverlayStateStore, type OverlayDesktopState } from "./state-store.js";
import {
  COLLAPSED_SIZE,
  clampWindowBounds,
  collapsedToExpandedBounds,
  defaultCollapsedBounds,
  expandedToCollapsedBounds,
} from "./window-layout.js";

const store = new OverlayStateStore();
const windowState = { expanded: false };
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function prepareTextInput() {
  return prepareLinuxTextInput();
}

function configureLinuxDisplayBackend() {
  if (process.platform !== "linux") {
    return;
  }

  const backend = (process.env.FLOW_OVERLAY_LINUX_BACKEND ?? "x11").toLowerCase();
  if (backend === "wayland") {
    app.commandLine.appendSwitch("enable-wayland-ime");
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    app.commandLine.appendSwitch("wayland-text-input-version", "3");
    return;
  }

  // WSLg 的 Wayland IME 在当前环境下会退化成英文直出，默认固定走 X11/xwayland。
  app.commandLine.appendSwitch("ozone-platform", "x11");
  app.commandLine.appendSwitch("ozone-platform-hint", "x11");
}

app.disableHardwareAcceleration();
configureLinuxDisplayBackend();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-features", "UseSkiaRenderer,VizDisplayCompositor");

function createTrayIcon() {
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <defs>
          <radialGradient id="g" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="38%" stop-color="#f8fafc"/>
            <stop offset="78%" stop-color="#cbd5e1"/>
            <stop offset="100%" stop-color="#94a3b8"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="29" fill="url(#g)"/>
        <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="1.8"/>
        <circle cx="32" cy="32" r="11" fill="none" stroke="rgba(148,163,184,0.8)" stroke-width="2"/>
      </svg>
    `).toString("base64")}`,
  );
}

function emitWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("overlay:window-state", { expanded: windowState.expanded });
  }
}

function currentDisplay() {
  return mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
}

function persistCollapsedAnchor() {
  if (!mainWindow) {
    return;
  }
  const bounds = mainWindow.getBounds();
  const display = currentDisplay();
  const collapsedBounds = windowState.expanded
    ? expandedToCollapsedBounds(bounds, display)
    : { x: bounds.x, y: bounds.y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE };

  store.write({
    window_position: {
      x: collapsedBounds.x,
      y: collapsedBounds.y,
    },
  });
}

function ensureWindowBounds() {
  if (!mainWindow) {
    return;
  }
  const savedState = store.read();
  const display = currentDisplay();
  const collapsedBounds = savedState.window_position
    ? {
        x: savedState.window_position.x,
        y: savedState.window_position.y,
        width: COLLAPSED_SIZE,
        height: COLLAPSED_SIZE,
      }
    : defaultCollapsedBounds(display);
  const targetBounds = windowState.expanded ? collapsedToExpandedBounds(collapsedBounds, display) : collapsedBounds;
  mainWindow.setBounds(targetBounds, false);
}

function setExpanded(expanded: boolean) {
  windowState.expanded = expanded;
  ensureWindowBounds();
  persistCollapsedAnchor();
  emitWindowState();
}

function toggleWindow() {
  setExpanded(!windowState.expanded);
  mainWindow?.show();
  mainWindow?.focus();
  return { expanded: windowState.expanded };
}

function openPlatform() {
  const state = store.read();
  const destination = state.last_platform_url ?? process.env.FLOW_PLATFORM_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  void shell.openExternal(destination);
  store.write({ last_platform_url: destination });
}

function registerAutostartTask() {
  if (process.platform !== "win32") {
    return;
  }
  const command = process.env.FLOW_OVERLAY_AUTOSTART_COMMAND;
  if (!command) {
    return;
  }
  spawnSync(
    "schtasks.exe",
    ["/Create", "/F", "/SC", "ONLOGON", "/TN", "Flow System Overlay", "/TR", command],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

function createMainWindow() {
  const preloadPath = fileURLToPath(new URL("./preload.js", import.meta.url));
  const htmlPath = fileURLToPath(new URL("./index.html", import.meta.url));

  mainWindow = new BrowserWindow({
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(htmlPath);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ensureWindowBounds();

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("move", () => {
    persistCollapsedAnchor();
  });

  mainWindow.on("focus", () => {
    prepareTextInput();
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    emitWindowState();
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Flow System Overlay");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开悬浮球",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: "打开平台",
        click: () => openPlatform(),
      },
      {
        label: "重新连接本机 Agent",
        click: () => {
          mainWindow?.webContents.send("overlay:reconnect-requested");
        },
      },
      { type: "separator" },
      {
        label: "退出悬浮球",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );

  tray.on("click", () => {
    if (!mainWindow) {
      return;
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    void toggleWindow();
  });
}

function getSafeBounds() {
  return (
    mainWindow?.getBounds() ?? {
      x: 0,
      y: 0,
      width: COLLAPSED_SIZE,
      height: COLLAPSED_SIZE,
    }
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(() => {
  registerAutostartTask();
  createMainWindow();
  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("overlay:get-window-state", async () => ({ expanded: windowState.expanded }));
ipcMain.handle("overlay:get-window-bounds", async () => getSafeBounds());
ipcMain.handle("overlay:set-window-position", async (_event, position: { x: number; y: number }) => {
  if (!mainWindow) {
    return getSafeBounds();
  }
  const currentBounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(position.x),
    y: Math.round(position.y),
  });
  const nextBounds = clampWindowBounds(
    {
      ...currentBounds,
      x: Math.round(position.x),
      y: Math.round(position.y),
    },
    display,
  );
  mainWindow.setBounds(nextBounds, false);
  persistCollapsedAnchor();
  return mainWindow.getBounds();
});
ipcMain.handle("overlay:toggle-window", async () => toggleWindow());
ipcMain.handle("overlay:prepare-text-input", async () => ({ accepted: prepareTextInput() }));
ipcMain.handle("overlay:open-platform", async () => {
  openPlatform();
  return { accepted: true };
});
ipcMain.handle("overlay:reconnect-agent", async () => {
  mainWindow?.webContents.send("overlay:reconnect-requested");
  return { accepted: true };
});
ipcMain.handle("overlay:read-ui-state", async () => store.read());
ipcMain.handle("overlay:save-ui-state", async (_event, patch: Partial<OverlayDesktopState>) => store.write(patch));
