// Force Node.js runtime — prom-client does not support the Edge runtime
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { register } from "@/lib/metrics";

export async function GET() {
  try {
    const metrics = await register.metrics();
    return new NextResponse(metrics, {
      status: 200,
      headers: { "Content-Type": register.contentType },
    });
  } catch (error) {
    console.error("Failed to collect metrics:", error);
    return NextResponse.json({ error: "Failed to collect metrics" }, { status: 500 });
  }
}
