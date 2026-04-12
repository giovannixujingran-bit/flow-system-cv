import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:4010";

export async function POST(request: Request) {
  const payload = await request.text();
  const apiResponse = await fetch(`${API_BASE_URL}/api/v1/setup/initialize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  });

  return new NextResponse(await apiResponse.text(), {
    status: apiResponse.status,
    headers: {
      "content-type": apiResponse.headers.get("content-type") ?? "application/json",
    },
  });
}
