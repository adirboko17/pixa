// החלפת תמונה של סלייד ב-Hero של theme פעיל.
//
// השלבים:
// 1. גיבוי של templates/index.json הנוכחי כ-`config/photospro-hero-backup-{ts}.json`.
//    (משתמשים ב-config/ ולא בתיקייה אחרת כי ב-Shopify רק כמה תיקיות מותרות:
//    assets, config, layout, locales, sections, snippets, templates).
// 2. העלאת התמונה החדשה כ-asset של ה-theme: `assets/photospro-hero-{ts}.png`.
//    זה יוצר URL ציבורי דרך Shopify CDN שאפשר להשתמש בו ב-image setting.
// 3. עדכון ה-section ב-index.json: שמים את ה-CDN URL במקום הערך הקודם.
//    תומך גם בערכי image_picker מסוג string וגם באובייקט {url, alt}.
//
// הערה: רוב themes מבוססי OS 2.0 שומרים ערך image_picker כמחרוזת
// "shopify://shop_images/{filename}" שמצביעה לקובץ ב-Files. אנחנו מחליפים
// את הערך הזה במחרוזת CDN ישירה. ב-runtime, Liquid מסוגל לטפל גם בכזו (השורה
// `{{ section.settings.image | image_url }}` עובדת על שניהם). ב-themes מסוימים
// שמשתמשים ב-image-tag עם פורמט ספציפי – ייתכן שיהיה צורך לעדכן ידנית. במקרה
// כזה, יש לנו את הגיבוי לשחזור.

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

type AdminFetchInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

async function adminFetch<T = unknown>(
  shop: string,
  token: string,
  path: string,
  init: AdminFetchInit = {}
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

/**
 * מקבל path בסגנון "sections.{sid}.blocks.{bid}.settings.{field}" או
 * "sections.{sid}.settings.{field}" ומחזיר את ה-key של השדה לערוך + מסלול
 * ה-walk לאובייקט ה-settings המכיל אותו.
 */
function parseSlidePath(path: string): {
  isBlock: boolean;
  sectionId: string;
  blockId?: string;
  fieldKey: string;
} | null {
  // sections.foo.blocks.bar.settings.image
  const blockMatch = path.match(
    /^sections\.([^.]+)\.blocks\.([^.]+)\.settings\.(.+)$/
  );
  if (blockMatch) {
    return {
      isBlock: true,
      sectionId: blockMatch[1],
      blockId: blockMatch[2],
      fieldKey: blockMatch[3],
    };
  }
  const sectionMatch = path.match(/^sections\.([^.]+)\.settings\.(.+)$/);
  if (sectionMatch) {
    return {
      isBlock: false,
      sectionId: sectionMatch[1],
      fieldKey: sectionMatch[2],
    };
  }
  return null;
}

/** בונה את ה-CDN URL הצפוי של theme asset שהועלה זה עתה. */
function themeAssetCdnUrl(
  shop: string,
  themeId: number,
  filename: string
): string {
  // השם הקנוני: https://{shop}/cdn/shop/t/{theme_id}/assets/{filename}
  // (גם יכול להיות /cdn.shopify.com/s/files/.../t/{theme_id}/assets/...).
  // שני הפורמטים תקפים. נשתמש בכתובת הקצרה דרך הדומיין של החנות שעובדת תמיד.
  return `https://${shop}/cdn/shop/t/${themeId}/assets/${filename}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shop?: string;
      token?: string;
      sectionId?: string;
      slidePath?: string;
      base64?: string;
      filename?: string;
      alt?: string;
      // מובייל אופציונלי – יוחלף באותה קריאה כדי להישאר מסונכרן
      mobileSlidePath?: string;
      mobileBase64?: string;
      mobileFilename?: string;
    };
    if (
      !body.shop ||
      !body.token ||
      !body.sectionId ||
      !body.slidePath ||
      !body.base64
    ) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }
    const shop = normalizeShop(body.shop);
    const token = body.token;
    const base64 = stripBase64Prefix(body.base64);
    const parsed = parseSlidePath(body.slidePath);
    if (!parsed) {
      return NextResponse.json({ error: "slidePath לא תקין" }, { status: 400 });
    }
    if (parsed.sectionId !== body.sectionId) {
      return NextResponse.json(
        { error: "סתירה בין sectionId ל-slidePath" },
        { status: 400 }
      );
    }
    let parsedMobile: ReturnType<typeof parseSlidePath> | null = null;
    if (body.mobileSlidePath) {
      parsedMobile = parseSlidePath(body.mobileSlidePath);
      if (!parsedMobile) {
        return NextResponse.json(
          { error: "mobileSlidePath לא תקין" },
          { status: 400 }
        );
      }
      if (parsedMobile.sectionId !== body.sectionId) {
        return NextResponse.json(
          { error: "mobileSlidePath חייב להיות תחת אותו sectionId" },
          { status: 400 }
        );
      }
    }

    // 1. מצא את ה-theme הראשי
    const themesRes = await adminFetch<{
      themes?: Array<{ id: number; role: string; name: string }>;
    }>(shop, token, "/themes.json");
    if (themesRes.status === 401 || themesRes.status === 403) {
      return NextResponse.json(
        {
          error:
            "אין הרשאת theme. הוסף read_themes ו-write_themes לאפליקציה ב-Shopify Develop apps.",
        },
        { status: 401 }
      );
    }
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

    // 2. קרא את templates/index.json
    const indexRes = await adminFetch<{
      asset?: { value?: string };
    }>(
      shop,
      token,
      `/themes/${main.id}/assets.json?asset[key]=templates/index.json`
    );
    if (!indexRes.ok || !indexRes.data?.asset?.value) {
      return NextResponse.json(
        {
          error: `שגיאה בקריאת templates/index.json (${indexRes.status})`,
        },
        { status: 502 }
      );
    }
    const indexValue = indexRes.data.asset.value;
    let indexJson: {
      sections?: Record<
        string,
        {
          settings?: Record<string, unknown>;
          blocks?: Record<string, { settings?: Record<string, unknown> }>;
        }
      >;
    };
    try {
      indexJson = JSON.parse(indexValue);
    } catch {
      return NextResponse.json(
        { error: "templates/index.json אינו JSON תקין" },
        { status: 502 }
      );
    }

    // 3. אמת שהסקשן וה-block קיימים
    const section = indexJson.sections?.[parsed.sectionId];
    if (!section) {
      return NextResponse.json(
        { error: `הסקשן ${parsed.sectionId} לא קיים בעמוד הבית` },
        { status: 404 }
      );
    }
    let targetSettings: Record<string, unknown> | undefined;
    if (parsed.isBlock && parsed.blockId) {
      const blk = section.blocks?.[parsed.blockId];
      if (!blk) {
        return NextResponse.json(
          { error: `הבלוק ${parsed.blockId} לא קיים בסקשן` },
          { status: 404 }
        );
      }
      if (!blk.settings) blk.settings = {};
      targetSettings = blk.settings;
    } else {
      if (!section.settings) section.settings = {};
      targetSettings = section.settings;
    }
    if (!targetSettings) {
      return NextResponse.json(
        { error: "לא נמצא אובייקט settings בסקשן" },
        { status: 500 }
      );
    }

    // 4. גיבוי – נשמור את index.json הנוכחי בשם config/photospro-hero-backup-{ts}.json
    //    אנחנו שומרים אותו תחת config/ עם סיומת .json כי Shopify מאפשר רק .json שם.
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const backupKey = `config/photospro-hero-backup-${ts}.json`;
    // התוכן של הגיבוי הוא JSON שעוטף את התוכן המקורי – כי config/*.json
    // חייב להיות JSON תקין כדי להישמר. נארוז עם מטא-דאטה.
    const backupPayload = JSON.stringify({
      __photospro_backup__: true,
      created_at: new Date().toISOString(),
      original_key: "templates/index.json",
      original_value: indexValue,
    });
    const backupRes = await adminFetch(
      shop,
      token,
      `/themes/${main.id}/assets.json`,
      {
        method: "PUT",
        body: { asset: { key: backupKey, value: backupPayload } },
      }
    );
    if (!backupRes.ok) {
      return NextResponse.json(
        {
          error: `נכשלה יצירת גיבוי (${backupRes.status}). השינוי לא בוצע. ${
            backupRes.text?.slice(0, 200) || ""
          }`,
        },
        { status: 502 }
      );
    }

    // 4.5 helper להעלאת asset + עדכון setting
    const uploadAndPatch = async (
      contents: string,
      filenameHint: string | undefined,
      pathParsed: NonNullable<ReturnType<typeof parseSlidePath>>,
      targetingSettings: Record<string, unknown>,
      suffix: string
    ): Promise<{ url: string } | { error: string; status: number }> => {
      const safeName = (filenameHint || `photospro-hero-${suffix}-${ts}.png`)
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .slice(0, 80);
      const assetKey = `assets/${safeName}`;
      const upRes = await adminFetch<{
        asset?: { key: string; public_url?: string };
      }>(shop, token, `/themes/${main.id}/assets.json`, {
        method: "PUT",
        body: { asset: { key: assetKey, attachment: contents } },
      });
      if (!upRes.ok) {
        return {
          error: `נכשלה העלאת ${suffix} (${upRes.status}). ${
            upRes.text?.slice(0, 200) || ""
          }`,
          status: 502,
        };
      }
      const url =
        upRes.data?.asset?.public_url ||
        themeAssetCdnUrl(shop, main.id, safeName);

      // עדכון ה-setting הרלוונטי
      const oldValue = targetingSettings[pathParsed.fieldKey];
      let newValue: unknown;
      if (
        typeof oldValue === "object" &&
        oldValue !== null &&
        !Array.isArray(oldValue)
      ) {
        newValue = {
          ...(oldValue as Record<string, unknown>),
          url,
          src: url,
          ...(body.alt ? { alt: body.alt } : {}),
        };
      } else {
        newValue = url;
      }
      targetingSettings[pathParsed.fieldKey] = newValue;
      return { url };
    };

    // 5. העלאת תמונת desktop ועדכון index.json בזיכרון
    const desktopRes = await uploadAndPatch(
      base64,
      body.filename,
      parsed,
      targetSettings,
      "desktop"
    );
    if ("error" in desktopRes) {
      return NextResponse.json(
        { error: desktopRes.error },
        { status: desktopRes.status }
      );
    }
    const newImageUrl = desktopRes.url;

    // עדכון aria/alt אם יש שדה כזה ברמת ה-section/block
    if (body.alt && targetSettings) {
      if ("alt" in targetSettings) targetSettings.alt = body.alt;
      if ("image_alt" in targetSettings) targetSettings.image_alt = body.alt;
    }

    // 5.5 העלאת תמונת mobile (אופציונלי) + עדכון
    let newMobileImageUrl: string | undefined;
    if (parsedMobile && body.mobileBase64) {
      // צריך לאתר את ה-settings אובייקט עבור המובייל. בדרך כלל זה אותו אובייקט,
      // אבל ייתכן (נדיר) שזה אובייקט אחר אם ה-path שונה מהותית.
      let mobileTargetSettings: Record<string, unknown> | undefined;
      if (parsedMobile.isBlock && parsedMobile.blockId) {
        mobileTargetSettings =
          section.blocks?.[parsedMobile.blockId]?.settings;
      } else {
        mobileTargetSettings = section.settings;
      }
      if (!mobileTargetSettings) {
        return NextResponse.json(
          {
            error:
              "לא נמצא אובייקט settings לתמונת המובייל (mobileSlidePath לא תואם את הסקשן).",
          },
          { status: 400 }
        );
      }
      const mobileBase64 = stripBase64Prefix(body.mobileBase64);
      const mobRes = await uploadAndPatch(
        mobileBase64,
        body.mobileFilename,
        parsedMobile,
        mobileTargetSettings,
        "mobile"
      );
      if ("error" in mobRes) {
        return NextResponse.json(
          { error: mobRes.error },
          { status: mobRes.status }
        );
      }
      newMobileImageUrl = mobRes.url;
    }

    // 7. PUT של templates/index.json החדש
    const writeRes = await adminFetch(
      shop,
      token,
      `/themes/${main.id}/assets.json`,
      {
        method: "PUT",
        body: {
          asset: {
            key: "templates/index.json",
            value: JSON.stringify(indexJson, null, 2),
          },
        },
      }
    );
    if (!writeRes.ok) {
      return NextResponse.json(
        {
          error: `נכשל עדכון index.json (${writeRes.status}). הגיבוי שלך נשמר בשם ${backupKey}. ${
            writeRes.text?.slice(0, 200) || ""
          }`,
          backupAssetKey: backupKey,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      newImageUrl,
      newMobileImageUrl,
      backupAssetKey: backupKey,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
