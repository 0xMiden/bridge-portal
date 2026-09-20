import { NextResponse } from "next/server";

import { checkDeepHealth } from "../../lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const body = await checkDeepHealth();
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
