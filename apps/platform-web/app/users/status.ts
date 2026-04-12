import type { UserListItem } from "./types";

export function getUserStatusLabel(status: UserListItem["status"]): string {
  return status === "active" ? "启用中" : "已停用";
}
