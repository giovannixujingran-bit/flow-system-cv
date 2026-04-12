#!/usr/bin/env bash
set -euo pipefail

preferred_input_method="${FLOW_OVERLAY_PREFERRED_INPUT_METHOD:-pinyin}"
fcitx_profile_dir="${HOME}/.config/fcitx5"
fcitx_profile_path="${fcitx_profile_dir}/profile"
fcitx_backup_path="${fcitx_profile_path}.flow-overlay.bak"

profile_contains_input_method() {
  local method_name="$1"
  [ -f "$fcitx_profile_path" ] && grep -q "^Name=${method_name}$" "$fcitx_profile_path"
}

seed_overlay_profile() {
  mkdir -p "$fcitx_profile_dir"

  if [ -f "$fcitx_profile_path" ] && [ ! -f "$fcitx_backup_path" ]; then
    cp "$fcitx_profile_path" "$fcitx_backup_path"
  fi

  cat >"$fcitx_profile_path" <<EOF
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=${preferred_input_method}

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=${preferred_input_method}
Layout=

[GroupOrder]
0=Default
EOF
}

ensure_profile() {
  if profile_contains_input_method "keyboard-us" && profile_contains_input_method "$preferred_input_method"; then
    return
  fi

  seed_overlay_profile
}

start_fcitx() {
  if ! command -v fcitx5 >/dev/null 2>&1; then
    return
  fi

  fcitx5 -r --disable=wayland -d >/dev/null 2>&1 || true

  if command -v fcitx5-remote >/dev/null 2>&1; then
    for _attempt in 1 2 3 4 5; do
      if fcitx5-remote >/dev/null 2>&1; then
        break
      fi
      sleep 0.4
    done
    fcitx5-remote -s "$preferred_input_method" >/dev/null 2>&1 || true
  fi
}

ensure_profile
start_fcitx
