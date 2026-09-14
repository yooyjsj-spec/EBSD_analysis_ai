import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:8000";

export async function POST(request: Request) {
  const form = await request.formData();
  const upstream = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    body: form,
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}
