import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:8000";

export async function GET() {
  try {
    const upstream = await fetch(`${API_URL}/health`, { cache: "no-store" });
    const body = await upstream.json();
    return NextResponse.json({ web: "ok", api: body });
  } catch {
    return NextResponse.json({ web: "ok", api: "unreachable" }, { status: 503 });
  }
}
