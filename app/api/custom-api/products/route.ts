import { NextRequest, NextResponse } from "next/server";

import { fetchCustomApiProducts } from "@/lib/custom-api-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    const { products } = await fetchCustomApiProducts({ apiUrl, apiKey });

    return NextResponse.json({
      products,
      total: products.length,
    });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
