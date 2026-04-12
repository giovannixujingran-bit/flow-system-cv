import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

function buildForwardCookieHeader(request: Request, flowSession: string | undefined, flowCsrf: string | undefined): string | null {
  const incomingCookie = request.headers.get("cookie")?.trim();
  if (incomingCookie) {
    return incomingCookie;
  }
  if (!flowSession) {
    return null;
  }
  return `flow_session=${flowSession}; flow_csrf=${flowCsrf ?? ""}`;
}

async function proxy(request: Request, paramsPromise: Promise<{ path: string[] }>) {
  try {
    const { path } = await paramsPromise;
    const cookieStore = await cookies();
    const flowSession = cookieStore.get("flow_session")?.value;
    const flowCsrf = cookieStore.get("flow_csrf")?.value;
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    const cookieHeader = buildForwardCookieHeader(request, flowSession, flowCsrf);
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    const csrfHeader = request.headers.get("x-csrf-token") ?? flowCsrf;
    if (csrfHeader) {
      headers.set("x-csrf-token", csrfHeader);
    }
    const authorizationHeader = request.headers.get("authorization");
    if (authorizationHeader) {
      headers.set("authorization", authorizationHeader);
    }
    const apiResponse = await fetch(`${API_BASE_URL}/api/${path.join("/")}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      duplex: request.method === "GET" ? undefined : "half",
    } as RequestInit);

    return new NextResponse(await apiResponse.text(), {
      status: apiResponse.status,
      headers: {
        "content-type": apiResponse.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Platform proxy failed",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context.params);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context.params);
}

export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context.params);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context.params);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context.params);
}
