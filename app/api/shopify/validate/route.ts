import { NextRequest, NextResponse } from "next/server";

import {
  assertMyshopifyHost,
  SHOPIFY_API_VERSION,
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
      return NextResponse.json(
        { error: "חסר shop או token" },
        { status: 400 }
      );
    }
    const host = assertMyshopifyHost(shop);
    if (!/^shp(at|pa|ca)_/.test(token) && !/^shppa_/.test(token)) {
      // ממשיכים בכל זאת – אפשר להיות גם custom token, אבל נחזיר אזהרה רכה
    }

    const res = await fetch(
      `https://${host}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          error:
            "אימות נכשל. ודא שה-Access Token תקין וששתי ההרשאות (read_products, write_products) מסומנות.",
        },
        { status: 401 }
      );
    }
    if (res.status === 404) {
      return NextResponse.json(
        { error: "חנות לא נמצאה. בדוק את כתובת הדומיין." },
        { status: 404 }
      );
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `שגיאה ${res.status} ${t.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      shop?: {
        name?: string;
        domain?: string;
        myshopify_domain?: string;
        email?: string;
      };
    };
    if (!data?.shop?.name) {
      return NextResponse.json(
        { error: "תגובה לא צפויה מ-Shopify" },
        { status: 502 }
      );
    }
    const adminHost = assertMyshopifyHost(
      data.shop.myshopify_domain || host
    );
    return NextResponse.json({
      shopName: data.shop.name,
      domain: adminHost,
      email: data.shop.email,
    });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
