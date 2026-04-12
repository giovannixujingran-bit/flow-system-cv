import { z } from "zod";

export const openClawAgentResponseSchema = z.object({
  status: z.string().optional(),
  summary: z.string().optional(),
  result: z.object({
    payloads: z.array(
      z.object({
        text: z.string().nullable().optional(),
      }).passthrough(),
    ).default([]),
  }).passthrough().optional(),
}).passthrough();

export type OpenClawAgentResponse = z.infer<typeof openClawAgentResponseSchema>;

function trimOutput(value: string): string {
  return value.trim();
}

export function combineCommandOutput(stdout: string, stderr: string): string {
  return [stdout, stderr]
    .map(trimOutput)
    .filter((value) => value.length > 0)
    .join("\n");
}

function findJsonObjectEnd(source: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (!character) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function parseEmbeddedJsonObject<T>(source: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  const trimmedSource = source.trim();
  if (trimmedSource.length === 0) {
    return null;
  }

  for (let startIndex = trimmedSource.indexOf("{"); startIndex >= 0; startIndex = trimmedSource.indexOf("{", startIndex + 1)) {
    const endIndex = findJsonObjectEnd(trimmedSource, startIndex);
    if (endIndex < 0) {
      continue;
    }

    const candidate = trimmedSource.slice(startIndex, endIndex + 1);
    try {
      const parsedCandidate = JSON.parse(candidate) as unknown;
      const validated = schema.safeParse(parsedCandidate);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractPayloadText(response: OpenClawAgentResponse): string {
  return (response.result?.payloads ?? [])
    .map((payload) => payload.text?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n\n")
    .trim();
}

function resolveFailureMessage(response: OpenClawAgentResponse, fallback: string): string {
  return response.summary?.trim()
    || response.status?.trim()
    || fallback;
}

function tryParseOpenClawAgentResponse(source: string): OpenClawAgentResponse | null {
  return parseEmbeddedJsonObject(source, openClawAgentResponseSchema);
}

export function parseOpenClawAgentResponse(stdout: string, stderr: string): OpenClawAgentResponse {
  const combined = combineCommandOutput(stdout, stderr);
  if (!combined) {
    throw new Error("OpenClaw agent returned no output.");
  }

  const parsed = tryParseOpenClawAgentResponse(combined);
  if (!parsed) {
    throw new Error("OpenClaw agent did not return valid JSON.");
  }

  return parsed;
}

export function extractOpenClawReplyText(stdout: string, stderr: string): string {
  const trimmedStdout = trimOutput(stdout);
  const trimmedStderr = trimOutput(stderr);
  const combined = combineCommandOutput(stdout, stderr);

  if (!combined) {
    throw new Error("OpenClaw agent returned no output.");
  }

  const parsed = tryParseOpenClawAgentResponse(combined);
  if (!parsed) {
    if (trimmedStdout) {
      return trimmedStdout;
    }
    throw new Error(trimmedStderr || "OpenClaw agent returned no output.");
  }

  const reply = extractPayloadText(parsed);
  if (reply) {
    return reply;
  }

  const isSuccessful = parsed.status === "ok" || parsed.summary === "completed";
  if (isSuccessful) {
    throw new Error("OpenClaw agent returned an empty reply");
  }

  throw new Error(resolveFailureMessage(parsed, trimmedStderr || trimmedStdout || "OpenClaw agent returned a non-ok status"));
}
