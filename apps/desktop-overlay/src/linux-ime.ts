import { spawnSync } from "node:child_process";

function runFcitxRemote(args: string[]) {
  return spawnSync("fcitx5-remote", args, {
    env: process.env,
    stdio: "ignore",
  });
}

function shouldManageLinuxIme(platform = process.platform): boolean {
  return platform === "linux";
}

export function prepareLinuxTextInput(
  platform = process.platform,
  preferredInputMethod = process.env.FLOW_OVERLAY_PREFERRED_INPUT_METHOD ?? "pinyin",
): boolean {
  if (!shouldManageLinuxIme(platform)) {
    return false;
  }

  const activateResult = runFcitxRemote(["-o"]);
  const switchResult = runFcitxRemote(["-s", preferredInputMethod]);

  return activateResult.status === 0 || switchResult.status === 0;
}
