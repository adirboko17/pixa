// שחזור templates/index.json מגיבוי שיצרנו ב-replace-hero.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const API_VERSION = "2025-01";

function normalizeShop(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

async function adminFetch<T = unknown>(
  shop: string,
  token: string,
  path: string,
  init: { method?: "GET" | "PUT"; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: T | null; text?: string }> {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method: init.method || "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      "content-type": "application/json",
      accept: "application/json",
    },
    cache: "no-store",
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shop?: string;
      token?: string;
      backupAssetKey?: string;
    };
    if (!body.shop || !body.token || !body.backupAssetKey) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }
    if (!body.backupAssetKey.startsWith("config/photospro-hero-backup-")) {
      return NextResponse.json(
        { error: "backupAssetKey לא תקין" },
        { status: 400 }
      );
    }
    const shop = normalizeShop(body.shop);
    const token = body.token;

    const themesRes = await adminFetch<{
      themes?: Array<{ id: number; role: string }>;
    }>(shop, token, "/themes.json");
    if (!themesRes.ok || !themesRes.data?.themes) {
      return NextResponse.json(
        { error: `שגיאה בטעינת themes (${themesRes.status})` },
        { status: 502 }
      );
    }
    const main = themesRes.data.themes.find((t) => t.role === "main");
    if (!main) {
      return NextResponse.json(
        { error: "לא נמצא theme פעיל" },
        { status: 404 }
      );
    }

    const backupRes = await adminFetch<{
      asset?: { value?: string };
    }>(
      shop,
      token,
      `/themes/${main.id}/assets.json?asset[key]=${encodeURIComponent(
        body.backupAssetKey
      )}`
    );
    if (backupRes.status === 404 || !backupRes.data?.asset?.value) {
      return NextResponse.json(
        { error: "הגיבוי לא נמצא" },
        { status: 404 }
      );
    }
    let parsed: { original_value?: string };
    try {
      parsed = JSON.parse(backupRes.data.asset.value);
    } catch {
      return NextResponse.json(
        { error: "הגיבוי לא תקין (לא JSON)" },
        { status: 500 }
      );
    }
    if (!parsed.original_value) {
      return NextResponse.json(
        { error: "בגיבוי חסר original_value" },
        { status: 500 }
      );
    }

    const writeRes = await adminFetch(
      shop,
      token,
      `/themes/${main.id}/assets.json`,
      {
        method: "PUT",
        body: {
          asset: {
            key: "templates/index.json",
            value: parsed.original_value,
          },
        },
      }
    );
    if (!writeRes.ok) {
      return NextResponse.json(
        {
          error: `נכשל שחזור (${writeRes.status}). ${
            writeRes.text?.slice(0, 200) || ""
          }`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
