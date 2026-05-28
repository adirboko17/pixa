// דחיפת באנר Hero לעמוד הבית של Shopify – בארבעה מצבים:
//
// 1. "replace"  – החלפת תמונה של סלייד קיים (זהה ל-replace-hero הקיים).
// 2. "prepend"  – הוספה כסלייד ראשון בסקשן slideshow קיים (לפני כל השאר).
// 3. "append"   – הוספה כסלייד אחרון.
// 4. "solo"     – החלפה + השבתה של כל שאר ה-blocks ב-section (כדי שרק הבאנר
//                 החדש יוצג בלייב). הסלייד׳ים האחרים לא נמחקים – רק
//                 disabled:true – וניתן לשחזר אותם בקלות מהגיבוי או ידנית.
//
// בכל המצבים: גיבוי אוטומטי של templates/index.json לפני כל שינוי, העלאת
// התמונות (desktop + mobile אופציונלי) כ-theme assets, ואז עדכון index.json.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_VERSION = "2025-01";

type PushMode = "replace" | "prepend" | "append" | "solo";

function normalizeShop(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

function stripBase64Prefix(b64: string): string {
  return b64.startsWith("data:") ? b64.split(",", 2)[1] || "" : b64;
}

async function adminFetch<T = unknown>(
  shop: string,
  token: string,
  path: string,
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}
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

function themeAssetCdnUrl(shop: string, themeId: number, filename: string): string {
  return `https://${shop}/cdn/shop/t/${themeId}/assets/${filename}`;
}

/** יוצר block ID חדש בסגנון Shopify (24 hex characters). */
function newBlockId(prefix = "photospro"): string {
  const rand = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
  const ts = Date.now().toString(16).slice(-12).padEnd(12, "0");
  return `${prefix}_${ts}${rand}`.slice(0, 40);
}

/**
 * מזהה ב-section settings את שדות הטקסט (heading/subheading/button) ומחזיר
 * אותם. נשתמש בזה כדי "להזריק" את ה-brief לתוך block חדש בלי להמציא שדות
 * שאולי אין ב-schema של ה-theme.
 */
function findBlockTemplate(
  blocks: Record<
    string,
    {
      type?: string;
      disabled?: boolean;
      settings?: Record<string, unknown>;
    }
  >,
  blockOrder: string[]
): { type: string; settings: Record<string, unknown> } | null {
  for (const id of blockOrder) {
    const b = blocks[id];
    if (!b) continue;
    return {
      type: b.type || "slide",
      settings: { ...(b.settings || {}) },
    };
  }
  // fallback – אם אין block_order, ניקח כל אחד
  for (const id of Object.keys(blocks)) {
    const b = blocks[id];
    if (!b) continue;
    return { type: b.type || "slide", settings: { ...(b.settings || {}) } };
  }
  return null;
}

/** מעדכן (או יוצר) ערך תמונה ב-settings, תוך תמיכה ב-string/object. */
function setImageSetting(
  settings: Record<string, unknown>,
  candidates: string[],
  url: string
): boolean {
  for (const k of candidates) {
    if (k in settings) {
      const cur = settings[k];
      if (
        typeof cur === "object" &&
        cur !== null &&
        !Array.isArray(cur)
      ) {
        settings[k] = { ...(cur as Record<string, unknown>), url, src: url };
      } else {
        settings[k] = url;
      }
      return true;
    }
  }
  // לא קיים – ניצור עם המפתח הראשון מהרשימה
  if (candidates[0]) {
    settings[candidates[0]] = url;
    return true;
  }
  return false;
}

/** מעדכן שדה טקסט ב-settings (heading/subheading/button) אם קיים. */
function setTextSettingIfExists(
  settings: Record<string, unknown>,
  candidates: string[],
  value: string
): void {
  for (const k of candidates) {
    if (k in settings) {
      settings[k] = value;
      return;
    }
  }
  // אם אף שדה כזה לא קיים בתבנית – נוסיף בכל זאת בשם הראשון
  // (theme שלא מכיר את השדה פשוט יתעלם)
  if (candidates[0]) settings[candidates[0]] = value;
}

const IMAGE_KEYS = [
  "image",
  "background_image",
  "hero_image",
  "banner_image",
  "media",
];
const MOBILE_IMAGE_KEYS = [
  "image_mobile",
  "mobile_image",
  "image_picker_mobile",
  "media_mobile",
];
const HEADING_KEYS = ["heading", "title", "headline"];
const SUBHEADING_KEYS = ["subheading", "subtitle", "text", "caption"];
const BUTTON_LABEL_KEYS = ["button_label", "cta_label", "button_text"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shop?: string;
      token?: string;
      mode?: PushMode;
      sectionId?: string;
      slidePath?: string; // נדרש ב-mode=replace ו-mode=solo
      base64?: string;
      mobileBase64?: string;
      filename?: string;
      mobileFilename?: string;
      // טקסטים שייכנסו לבלוק חדש (ל-prepend/append/solo עם block חדש)
      heading?: string;
      subheadline?: string;
      cta?: string;
      buttonLink?: string;
    };

    const required: Array<keyof typeof body> = [
      "shop",
      "token",
      "mode",
      "sectionId",
      "base64",
    ];
    for (const k of required) {
      if (!body[k]) {
        return NextResponse.json(
          { error: `חסר פרמטר: ${k}` },
          { status: 400 }
        );
      }
    }
    const shop = normalizeShop(body.shop!);
    const token = body.token!;
    const mode = body.mode!;
    const sectionId = body.sectionId!;
    const base64 = stripBase64Prefix(body.base64!);
    const mobileBase64 = body.mobileBase64
      ? stripBase64Prefix(body.mobileBase64)
      : undefined;

    if (mode === "replace" && !body.slidePath) {
      return NextResponse.json(
        { error: "מצב replace דורש slidePath" },
        { status: 400 }
      );
    }

    // 1. theme פעיל
    const themesRes = await adminFetch<{
      themes?: Array<{ id: number; role: string; name: string }>;
    }>(shop, token, "/themes.json");
    if (themesRes.status === 401 || themesRes.status === 403) {
      return NextResponse.json(
        {
          error:
            "אין הרשאת theme. הוסף read_themes ו-write_themes לאפליקציה.",
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

    // 2. קריאת templates/index.json
    const indexRes = await adminFetch<{ asset?: { value?: string } }>(
      shop,
      token,
      `/themes/${main.id}/assets.json?asset[key]=templates/index.json`
    );
    if (!indexRes.ok || !indexRes.data?.asset?.value) {
      return NextResponse.json(
        { error: `שגיאה בקריאת templates/index.json (${indexRes.status})` },
        { status: 502 }
      );
    }
    const indexValue = indexRes.data.asset.value;
    let indexJson: {
      sections?: Record<
        string,
        {
          type?: string;
          settings?: Record<string, unknown>;
          blocks?: Record<
            string,
            {
              type?: string;
              disabled?: boolean;
              settings?: Record<string, unknown>;
            }
          >;
          block_order?: string[];
        }
      >;
      order?: string[];
    };
    try {
      indexJson = JSON.parse(indexValue);
    } catch {
      return NextResponse.json(
        { error: "templates/index.json אינו JSON תקין" },
        { status: 502 }
      );
    }
    const section = indexJson.sections?.[sectionId];
    if (!section) {
      return NextResponse.json(
        { error: `הסקשן ${sectionId} לא קיים בעמוד הבית` },
        { status: 404 }
      );
    }

    // 3. גיבוי
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const backupKey = `config/photospro-hero-backup-${ts}.json`;
    const backupRes = await adminFetch(
      shop,
      token,
      `/themes/${main.id}/assets.json`,
      {
        method: "PUT",
        body: {
          asset: {
            key: backupKey,
            value: JSON.stringify({
              __photospro_backup__: true,
              created_at: new Date().toISOString(),
              original_key: "templates/index.json",
              original_value: indexValue,
            }),
          },
        },
      }
    );
    if (!backupRes.ok) {
      return NextResponse.json(
        {
          error: `נכשל גיבוי (${backupRes.status}). ${
            backupRes.text?.slice(0, 200) || ""
          }`,
        },
        { status: 502 }
      );
    }

    // 4. העלאת תמונת desktop
    const safeName = (body.filename || `photospro-hero-${ts}.png`)
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80);
    const upRes = await adminFetch<{ asset?: { public_url?: string } }>(
      shop,
      token,
      `/themes/${main.id}/assets.json`,
      {
        method: "PUT",
        body: { asset: { key: `assets/${safeName}`, attachment: base64 } },
      }
    );
    if (!upRes.ok) {
      return NextResponse.json(
        { error: `נכשלה העלאה (${upRes.status})` },
        { status: 502 }
      );
    }
    const desktopUrl =
      upRes.data?.asset?.public_url ||
      themeAssetCdnUrl(shop, main.id, safeName);

    // 5. העלאת mobile (אופציונלי)
    let mobileUrl: string | undefined;
    if (mobileBase64) {
      const safeMob = (
        body.mobileFilename || `photospro-hero-${ts}-mobile.png`
      )
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .slice(0, 80);
      const upM = await adminFetch<{ asset?: { public_url?: string } }>(
        shop,
        token,
        `/themes/${main.id}/assets.json`,
        {
          method: "PUT",
          body: {
            asset: { key: `assets/${safeMob}`, attachment: mobileBase64 },
          },
        }
      );
      if (upM.ok) {
        mobileUrl =
          upM.data?.asset?.public_url ||
          themeAssetCdnUrl(shop, main.id, safeMob);
      }
    }

    // 6. עדכון index.json לפי המצב
    if (mode === "replace") {
      // ניתוח slidePath
      const m1 = body.slidePath!.match(
        /^sections\.([^.]+)\.blocks\.([^.]+)\.settings\.(.+)$/
      );
      const m2 = !m1
        ? body.slidePath!.match(/^sections\.([^.]+)\.settings\.(.+)$/)
        : null;
      let target: Record<string, unknown> | undefined;
      let fieldKey: string | undefined;
      if (m1) {
        if (m1[1] !== sectionId) {
          return NextResponse.json(
            { error: "slidePath לא תואם sectionId" },
            { status: 400 }
          );
        }
        target = section.blocks?.[m1[2]]?.settings;
        fieldKey = m1[3];
      } else if (m2) {
        if (m2[1] !== sectionId) {
          return NextResponse.json(
            { error: "slidePath לא תואם sectionId" },
            { status: 400 }
          );
        }
        if (!section.settings) section.settings = {};
        target = section.settings;
        fieldKey = m2[2];
      }
      if (!target || !fieldKey) {
        return NextResponse.json(
          { error: "slidePath לא תקין" },
          { status: 400 }
        );
      }
      target[fieldKey] = desktopUrl;
      // מובייל – אם יש פיצ'ר מובייל ב-settings, נעדכן את הראשון שמופיע
      if (mobileUrl) {
        for (const mk of MOBILE_IMAGE_KEYS) {
          if (mk in target) {
            target[mk] = mobileUrl;
            break;
          }
        }
      }
    } else if (
      mode === "prepend" ||
      mode === "append" ||
      mode === "solo"
    ) {
      // צריך לעבוד על blocks – הסקשן חייב לתמוך בזה
      if (!section.blocks) section.blocks = {};
      if (!section.block_order) section.block_order = [];

      // נמצא תבנית קיימת לבלוק (מבני settings) כדי לדעת איזה שדות לעדכן
      const template = findBlockTemplate(
        section.blocks,
        section.block_order
      );
      if (!template) {
        // אם הסקשן הוא image-banner חד-פעמי בלי blocks (מוד solo בלבד) –
        // נשלח אותו ל-replace ברמת ה-section settings.
        if (mode === "solo" && section.settings) {
          setImageSetting(section.settings, IMAGE_KEYS, desktopUrl);
          if (mobileUrl)
            setImageSetting(section.settings, MOBILE_IMAGE_KEYS, mobileUrl);
          if (body.heading)
            setTextSettingIfExists(
              section.settings,
              HEADING_KEYS,
              body.heading
            );
          if (body.subheadline)
            setTextSettingIfExists(
              section.settings,
              SUBHEADING_KEYS,
              body.subheadline
            );
          if (body.cta)
            setTextSettingIfExists(
              section.settings,
              BUTTON_LABEL_KEYS,
              body.cta
            );
        } else {
          return NextResponse.json(
            {
              error:
                "הסקשן הזה לא תומך ב-blocks (אין מסגרת לסלייד׳ים נוספים). נסה במצב 'החלפת סלייד קיים'.",
            },
            { status: 400 }
          );
        }
      } else {
        // יוצרים block חדש מבוסס תבנית
        const newId = newBlockId();
        const newSettings: Record<string, unknown> = { ...template.settings };

        setImageSetting(newSettings, IMAGE_KEYS, desktopUrl);
        if (mobileUrl) {
          setImageSetting(newSettings, MOBILE_IMAGE_KEYS, mobileUrl);
        }
        if (body.heading) {
          setTextSettingIfExists(newSettings, HEADING_KEYS, body.heading);
        }
        if (body.subheadline) {
          setTextSettingIfExists(
            newSettings,
            SUBHEADING_KEYS,
            body.subheadline
          );
        }
        if (body.cta) {
          setTextSettingIfExists(newSettings, BUTTON_LABEL_KEYS, body.cta);
        }
        if (body.buttonLink) {
          setTextSettingIfExists(
            newSettings,
            ["button_link", "link", "cta_link"],
            body.buttonLink
          );
        }

        section.blocks[newId] = {
          type: template.type,
          settings: newSettings,
          disabled: false,
        };

        if (mode === "prepend") {
          section.block_order = [newId, ...section.block_order];
        } else if (mode === "append") {
          section.block_order = [...section.block_order, newId];
        } else if (mode === "solo") {
          // disable כל השאר ושים את החדש כראשון
          for (const otherId of Object.keys(section.blocks)) {
            if (otherId === newId) continue;
            const b = section.blocks[otherId];
            if (b) b.disabled = true;
          }
          section.block_order = [newId, ...section.block_order];
        }
      }
    }

    // 7. PUT של index.json החדש
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
          error: `נכשל עדכון index.json (${writeRes.status}). הגיבוי שלך נשמר ב-${backupKey}.`,
          backupAssetKey: backupKey,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      mode,
      desktopUrl,
      mobileUrl,
      backupAssetKey: backupKey,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
