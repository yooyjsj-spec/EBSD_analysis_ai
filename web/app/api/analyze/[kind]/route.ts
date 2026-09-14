import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:8000";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!["sem", "ipf", "kam"].includes(kind)) {
    return NextResponse.json({ detail: "지원하지 않는 분석 유형입니다." }, { status: 404 });
  }
  const form = await request.formData();
  const upstream = await fetch(`${API_URL}/api/analyze/${kind}`, {
    method: "POST",
    body: form,
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}
