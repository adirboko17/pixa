import { NextRequest, NextResponse } from "next/server";

import { fetchCustomApiProducts } from "@/lib/custom-api-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { apiUrl, apiKey } = (await req.json()) as {
      apiUrl?: string;
      apiKey?: string;
    };

    if (!apiUrl || !apiKey) {
      return NextResponse.json(
        { error: "חסר כתובת API או API Key" },
        { status: 400 }
      );
    }

    const { products, storeName } = await fetchCustomApiProducts({
      apiUrl,
      apiKey,
    });

    return NextResponse.json({
      storeName: storeName || "Lovable / API",
      productCount: products.length,
    });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    const status = m.includes("אימות") ? 401 : 500;
    return NextResponse.json({ error: m }, { status });
  }
}
