import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_VERSION = "2025-01";

function normalizeShop(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

function stripBase64Prefix(b64: string): string {
  return b64.startsWith("data:") ? b64.split(",", 2)[1] || "" : b64;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shop?: string;
      token?: string;
      productId?: number | string;
      base64?: string;
      filename?: string;
      alt?: string;
      replaceOriginal?: boolean;
    };
    if (!body.shop || !body.token || !body.productId || !body.base64) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }
    const host = normalizeShop(body.shop);
    const productId = String(body.productId);
    const base64 = stripBase64Prefix(body.base64);
    // שמירת תווי Unicode (עברית/ערבית) בשם הקובץ; מסירים רק תווים בעיתיים ל-URL.
    // (Shopify CDN ידאג להצפנת percent-encoding ל-UTF-8 בכתובת הסופית.)
    const filename =
      (body.filename || `main-${Date.now()}.png`)
        .replace(/[\\/:*?"<>|]/g, "-")
        .slice(0, 200) || "main.png";
    const alt = (body.alt || "").toString().slice(0, 512).trim();

    const headers = {
      "X-Shopify-Access-Token": body.token,
      "content-type": "application/json",
      accept: "application/json",
    };

    // שלב 1: לקרוא את המוצר הנוכחי כדי לדעת מה ה-featured image הקיים (גם לזיהוי, גם למחיקה אם צריך).
    let oldFeaturedId: number | undefined;
    try {
      const pRes = await fetch(
        `https://${host}/admin/api/${API_VERSION}/products/${productId}.json?fields=id,image,images`,
        { headers, cache: "no-store" }
      );
      if (pRes.ok) {
        const pData = (await pRes.json()) as {
          product?: { image?: { id?: number } };
        };
        oldFeaturedId = pData.product?.image?.id;
      }
    } catch {
      // לא חוסם, נמשיך
    }

    // שלב 2: העלאת התמונה החדשה. שמים position: 1 כדי שתהיה הראשונה,
    // ומעבירים alt text – זהו אחד הסיגנלים החזקים ביותר ל-SEO לתמונות מוצר.
    const uploadRes = await fetch(
      `https://${host}/admin/api/${API_VERSION}/products/${productId}/images.json`,
      {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          image: {
            attachment: base64,
            filename,
            position: 1,
            ...(alt ? { alt } : {}),
          },
        }),
      }
    );

    if (uploadRes.status === 401 || uploadRes.status === 403) {
      return NextResponse.json(
        {
          error:
            "אין הרשאת כתיבה. בדוק שלאפליקציה יש הרשאת write_products.",
        },
        { status: 401 }
      );
    }
    if (uploadRes.status === 422) {
      const t = await uploadRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify דחה את התמונה: ${t.slice(0, 300)}` },
        { status: 422 }
      );
    }
    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => "");
      return NextResponse.json(
        { error: `שגיאה ${uploadRes.status} ${t.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await uploadRes.json()) as {
      image?: {
        id: number;
        src: string;
        position: number;
        width?: number;
        height?: number;
      };
    };
    if (!data.image) {
      return NextResponse.json(
        { error: "Shopify לא החזיר תמונה" },
        { status: 502 }
      );
    }
    const newImageId = data.image.id;

    // שלב 3: לקדם את התמונה החדשה להיות ה-featured image של המוצר.
    // Shopify לא עושה את זה אוטומטית רק בגלל position: 1; חייבים PUT מפורש.
    try {
      await fetch(
        `https://${host}/admin/api/${API_VERSION}/products/${productId}.json`,
        {
          method: "PUT",
          headers,
          cache: "no-store",
          body: JSON.stringify({
            product: {
              id: Number(productId),
              image: { id: newImageId },
            },
          }),
        }
      );
    } catch (e) {
      console.warn("[shopify/upload-image] failed to set featured", e);
    }

    // שלב 4: אם המשתמש ביקש – למחוק את הישנה. אחרת היא נשארת כמשנית.
    let oldDeleted = false;
    if (body.replaceOriginal && oldFeaturedId && oldFeaturedId !== newImageId) {
      try {
        const delRes = await fetch(
          `https://${host}/admin/api/${API_VERSION}/products/${productId}/images/${oldFeaturedId}.json`,
          { method: "DELETE", headers, cache: "no-store" }
        );
        oldDeleted = delRes.ok;
      } catch (e) {
        console.warn("[shopify/upload-image] delete old failed", e);
      }
    }

    return NextResponse.json({
      success: true,
      image: data.image,
      oldImageKeptAsSecondary:
        !body.replaceOriginal && !!oldFeaturedId && oldFeaturedId !== newImageId,
      oldDeleted,
    });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
