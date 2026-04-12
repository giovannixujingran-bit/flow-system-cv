import { ulid } from "ulid";

export type IdPrefix = "task" | "file" | "evt" | "req" | "agent" | "proj" | "wf" | "user" | "item";

export function makeId(prefix: IdPrefix): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}

export function isPrefixedId(value: string, prefix: IdPrefix): boolean {
  return value.startsWith(`${prefix}_`) && value.length > prefix.length + 1;
}
