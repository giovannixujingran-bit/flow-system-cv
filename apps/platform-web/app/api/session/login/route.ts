import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

function extractCookieValue(cookieLine: string, cookieName: string): string | null {
  const prefix = `${cookieName}=`;
  const segment = cookieLine.split(";")[0] ?? "";
  return segment.startsWith(prefix) ? segment.slice(prefix.length) : null;
}

function decodeCookieValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function POST(request: Request) {
  const payload = await request.text();
  const apiResponse = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  });

  const body = await apiResponse.text();
  const response = new NextResponse(body, {
    status: apiResponse.status,
    headers: {
      "content-type": apiResponse.headers.get("content-type") ?? "application/json",
    },
  });

  const setCookies = apiResponse.headers.getSetCookie?.() ?? [];
  for (const cookieLine of setCookies) {
    const flowSession = decodeCookieValue(extractCookieValue(cookieLine, "flow_session"));
    if (flowSession) {
      response.cookies.set("flow_session", flowSession, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      });
    }
    const flowCsrf = decodeCookieValue(extractCookieValue(cookieLine, "flow_csrf"));
    if (flowCsrf) {
      response.cookies.set("flow_csrf", flowCsrf, {
        httpOnly: false,
        sameSite: "lax",
        secure: false,
        path: "/",
      });
    }
  }

  return response;
}
