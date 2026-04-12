import { cookies } from "next/headers";

const API_BASE_URL = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

async function publicPlatformApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
  });
}

async function platformApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  const flowSession = cookieStore.get("flow_session")?.value;
  const flowCsrf = cookieStore.get("flow_csrf")?.value;
  const headers = new Headers(init?.headers ?? {});

  if (flowSession) {
    headers.set("cookie", `flow_session=${flowSession}; flow_csrf=${flowCsrf ?? ""}`);
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function publicPlatformApiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await publicPlatformApiFetch(path, init);
  if (!response.ok) {
    throw new Error(`Platform API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function platformApiJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const response = await platformApiFetch(path, init);
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`平台 API 请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}
