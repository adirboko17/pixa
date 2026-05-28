import { NextRequest, NextResponse } from "next/server";
import {
  assertMyshopifyHost,
  fetchCollections,
} from "@/lib/shopify-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { shop, token } = (await req.json()) as {
      shop?: string;
      token?: string;
    };
    if (!shop || !token) {
      return NextResponse.json({ error: "חסר shop או token" }, { status: 400 });
    }

    const host = assertMyshopifyHost(shop);
    const collections = await fetchCollections(host, token);

    return NextResponse.json({
      collections: collections.map((c) => ({
        id: c.id,
        handle: c.handle,
        title: c.title,
        productsCount: c.productsCount,
        imageSrc: c.imageSrc,
      })),
    });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
