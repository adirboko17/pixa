import { NextRequest, NextResponse } from "next/server";
import { scanCatalog } from "@/lib/site-catalog-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    if (!body?.url) {
      return NextResponse.json({ error: "חסר url" }, { status: 400 });
    }
    const result = await scanCatalog(body.url);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    const status = /לא הצלחנו/.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
