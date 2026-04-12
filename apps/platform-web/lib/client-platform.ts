type PlatformClientJsonResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export async function fetchPlatformJson<T>(
  path: string,
  init?: RequestInit,
): Promise<PlatformClientJsonResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: init?.credentials ?? "same-origin",
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      const error =
        (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" && payload.message) ||
        `Platform request failed: ${response.status}`;
      return {
        ok: false,
        status: response.status,
        error,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: (payload ?? null) as T,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network request failed",
    };
  }
}
