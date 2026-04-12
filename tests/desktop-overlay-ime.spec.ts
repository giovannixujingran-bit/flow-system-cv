import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

describe("desktop overlay linux ime", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("skips IME activation on non-linux platforms", async () => {
    const { prepareLinuxTextInput } = await import("../apps/desktop-overlay/src/linux-ime");

    expect(prepareLinuxTextInput("win32", "pinyin")).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("activates and switches fcitx input method on linux", async () => {
    spawnSyncMock.mockReturnValue({ status: 0 });
    const { prepareLinuxTextInput } = await import("../apps/desktop-overlay/src/linux-ime");

    expect(prepareLinuxTextInput("linux", "pinyin")).toBe(true);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      "fcitx5-remote",
      ["-o"],
      expect.objectContaining({
        env: process.env,
        stdio: "ignore",
      }),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      "fcitx5-remote",
      ["-s", "pinyin"],
      expect.objectContaining({
        env: process.env,
        stdio: "ignore",
      }),
    );
  });
});
