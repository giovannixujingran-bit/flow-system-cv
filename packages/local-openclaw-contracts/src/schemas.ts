import { z } from "zod";

export const openClawSelectionModeSchema = z.enum(["executable", "root"]);
export type OpenClawSelectionMode = z.infer<typeof openClawSelectionModeSchema>;

export const openClawDiagnosticCodeSchema = z.enum([
  "not_configured",
  "selected_path_missing",
  "executable_missing",
  "state_dir_missing",
  "config_missing",
  "auth_missing",
  "version_failed",
  "gateway_offline",
  "agent_probe_failed",
  "ready",
]);
export type OpenClawDiagnosticCode = z.infer<typeof openClawDiagnosticCodeSchema>;

export const openClawStatusSchema = z.object({
  selected_mode: openClawSelectionModeSchema.nullable(),
  selected_path: z.string().nullable(),
  openclaw_bin: z.string().nullable(),
  openclaw_state_dir: z.string().nullable(),
  openclaw_config_path: z.string().nullable(),
  current_model: z.string().nullable().optional().default(null),
  status_code: openClawDiagnosticCodeSchema,
  status_label: z.string(),
  last_validated_at: z.string().nullable(),
  last_error: z.string().nullable(),
  openclaw_connected: z.boolean(),
});
export type OpenClawStatus = z.infer<typeof openClawStatusSchema>;

export const openClawStatusResponseSchema = z.object({
  status: openClawStatusSchema,
});
export type OpenClawStatusResponse = z.infer<typeof openClawStatusResponseSchema>;

export const openClawSelectionResultSchema = z.object({
  accepted: z.boolean(),
  cancelled: z.boolean(),
  persisted: z.boolean(),
  status: openClawStatusSchema,
});
export type OpenClawSelectionResult = z.infer<typeof openClawSelectionResultSchema>;

export function getOpenClawDiagnosticLabel(code: OpenClawDiagnosticCode): string {
  switch (code) {
    case "not_configured":
      return "\u672a\u63a5\u5165";
    case "selected_path_missing":
    case "executable_missing":
    case "state_dir_missing":
    case "config_missing":
      return "\u914d\u7f6e\u7f3a\u5931";
    case "auth_missing":
      return "OAuth \u5931\u6548";
    case "version_failed":
      return "\u5df2\u627e\u5230\u5b89\u88c5\u76ee\u5f55";
    case "gateway_offline":
      return "Gateway \u4e0d\u5728\u7ebf";
    case "agent_probe_failed":
      return "Agent \u8c03\u7528\u5931\u8d25";
    case "ready":
      return "\u5df2\u8fde\u63a5";
    default:
      return "\u672a\u63a5\u5165";
  }
}

export function isOpenClawReady(status: Pick<OpenClawStatus, "status_code">): boolean {
  return status.status_code === "ready";
}

export function createOpenClawStatus(input: Omit<OpenClawStatus, "status_label" | "openclaw_connected" | "current_model"> & {
  status_label?: string;
  openclaw_connected?: boolean;
  current_model?: string | null;
}): OpenClawStatus {
  const statusCode = input.status_code;
  return openClawStatusSchema.parse({
    ...input,
    current_model: input.current_model ?? null,
    status_label: input.status_label ?? getOpenClawDiagnosticLabel(statusCode),
    openclaw_connected: input.openclaw_connected ?? isOpenClawReady({ status_code: statusCode }),
  });
}
