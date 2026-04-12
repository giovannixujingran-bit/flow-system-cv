import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      cookie,
    },
  }).catch(() => null);

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set("flow_session", "", {
    path: "/",
    expires: new Date(0),
  });
  response.cookies.set("flow_csrf", "", {
    path: "/",
    expires: new Date(0),
  });
  return response;
}
