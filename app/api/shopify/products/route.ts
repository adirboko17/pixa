import { NextRequest, NextResponse } from "next/server";
import {
  assertMyshopifyHost,
  fetchAllProductsGraphql,
} from "@/lib/shopify-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shop?: string;
      token?: string;
      pageInfo?: string;
      limit?: number;
      collectionId?: number | string;
      fetchAll?: boolean;
    };
    if (!body.shop || !body.token) {
      return NextResponse.json(
        { error: "חסר shop או token" },
        { status: 400 }
      );
    }

    const host = assertMyshopifyHost(body.shop);
    const fetchAll = body.fetchAll !== false;
    const limit = Math.max(1, Math.min(250, body.limit || (fetchAll ? 250 : 50)));

    const { products, nextPageInfo } = await fetchAllProductsGraphql(
      host,
      body.token,
      {
        limit,
        collectionId: body.collectionId,
        fetchAll,
        pageInfo: body.pageInfo,
      }
    );

    return NextResponse.json({
      products,
      nextPageInfo,
      total: products.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    const lower = message.toLowerCase();
    const status =
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("access denied") ||
      lower.includes("unauthorized")
        ? 401
        : 502;
    const friendly =
      status === 401
        ? "אין הרשאה. ודא של-Access Token יש הרשאות read_products + write_products."
        : message;
    return NextResponse.json({ error: friendly }, { status });
  }
}
