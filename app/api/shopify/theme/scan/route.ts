// סריקת ה-Hero של חנות Shopify מחוברת.
//
// השלבים:
// 1. שולפים את כל ה-themes ומאתרים את זה ש-role="main" (ה-theme הפעיל).
// 2. קוראים את `templates/index.json` של אותו theme (זה מבנה ה-JSON של עמוד הבית
//    ב-OS 2.0 – יש שם `sections` עם type, settings ו-blocks, ומערך `order`).
// 3. עוברים על הסקשנים ומחפשים hero/slideshow/banner/video. מתעלמים מ-disabled.
// 4. בכל סקשן עוברים על blocks ו-settings ושולפים שדות שנראים כמו תמונה
//    (image, image_picker, background_image, video, video_url).
// 5. מנסים לפתור URL לכל תמונה: תמונות מוצרים אצל Shopify יושבות ב-Files
//    (`/admin/api/.../files.json`) או כ-asset של ה-theme. אנחנו ממפים את שני
//    המקרים. אם לא הצלחנו לפתור URL, מחזירים את הערך הגולמי כדי שהמשתמש
//    יוכל לפחות לראות שיש שם משהו.
// 6. מחזירים גם את ה-section הראשון בעמוד אם לא זיהינו hero – לפעמים בונים
//    hero תחת שם לא סטנדרטי.

import { NextRequest, NextResponse } from "next/server";
import {
  HERO_SECTION_TYPES,
  isHeroLikeType,
  prettySectionName,
  type HeroScanResult,
  type HeroSection,
  type HeroSlide,
  type HeroSlideKind,
  type ThemeInfo,
} from "@/lib/shopify-theme";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_VERSION = "2025-01";

function normalizeShop(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
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
  } catch {
    // ייתכן שזו תגובה לא-JSON (HTML של דף שגיאה)
  }
  return { ok: res.ok, status: res.status, data, text };
}

/** GraphQL helper – נחוץ כדי לפתור MediaImage IDs ל-URL */
async function adminGraphQL<T = unknown>(
  shop: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "content-type": "application/json",
      accept: "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let parsed: { data?: T } | null = null;
  try {
    parsed = text ? (JSON.parse(text) as { data?: T }) : null;
  } catch {}
  return { ok: res.ok, status: res.status, data: parsed?.data || null };
}

// ---------- helpers על מבנה ה-section JSON ----------

type SectionJson = {
  type?: string;
  disabled?: boolean;
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
};

type IndexJson = {
  sections?: Record<string, SectionJson>;
  order?: string[];
};

const IMAGE_LIKE_KEYS = [
  "image",
  "background_image",
  "background",
  "hero_image",
  "banner_image",
  "media",
  "img",
  "picture",
  "photo",
];

/**
 * שדות תמונה המוקדשים למובייל (מסכים צרים). ה-theme בד"כ מציג אותם
 * במקום ה-image הראשי כשרוחב המסך < ~750px. בלי שלזהה אותם בנפרד,
 * המשתמש יראה רק את הגרסה הדסקטופ ויחשוב שהמובייל לא מנוהל.
 */
const MOBILE_IMAGE_LIKE_KEYS = [
  "image_mobile",
  "mobile_image",
  "image_picker_mobile",
  "image_small",
  "image_sm",
  "media_mobile",
  "background_mobile",
  "mobile_media",
  "mobile_background",
  "image_for_mobile",
  "responsive_image_mobile",
];

const VIDEO_LIKE_KEYS = [
  "video",
  "video_url",
  "video_link",
  "media_video",
];

const HEADING_LIKE_KEYS = ["heading", "title", "headline", "main_heading"];
const SUBHEADING_LIKE_KEYS = [
  "subheading",
  "subtitle",
  "text",
  "caption",
  "description",
];

function pickFirst(
  obj: Record<string, unknown> | undefined,
  keys: string[]
): { key: string; value: unknown } | null {
  if (!obj) return null;
  for (const k of keys) {
    if (k in obj && obj[k] != null && obj[k] !== "") {
      return { key: k, value: obj[k] };
    }
  }
  return null;
}

/**
 * שולף "ליבת שם קובץ" מ-URL של תמונה ב-Shopify CDN. הליבה מנקה סיומות גודל
 * (כמו `_1024x`, `_400x400_crop_center`) כדי שנוכל לעשות match מול ה-HTML
 * החי גם אם ה-theme מציג גרסה ב-resize שונה. דוגמאות:
 *   "banner_1024x.jpg?v=123"  → "banner"
 *   "hero-image_400x400.png"  → "hero-image"
 */
function imageCoreFilename(url: string): string | null {
  try {
    const u = url.split("?")[0].split("#")[0];
    const last = decodeURIComponent(u.split("/").pop() || "");
    if (!last) return null;
    let stem = last.replace(/\.[a-z0-9]{2,5}$/i, "");
    // מסיר סיומות resize של Shopify CDN
    stem = stem.replace(
      /_(pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x\d*(_crop_[a-z]+)?|\d+x|x\d+)$/i,
      ""
    );
    return stem.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * מורידים את ה-HTML של עמוד הבית של החנות, מחלצים את כל ה-image URLs (כולל
 * srcset). מחזיר Set של "core filenames" שמופיעים בעמוד. מאפשר אימות אילו
 * סלייד׳ים באמת מוצגים בלייב.
 */
async function fetchLiveHomeImages(
  shop: string
): Promise<Set<string> | null> {
  try {
    const res = await fetch(`https://${shop}/`, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; PhotosProBot/1.0) Chrome/120 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();
    const cores = new Set<string>();
    // src + data-src + srcset
    const re =
      /(?:src|data-src|data-original|data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      // srcset יכול להכיל כמה URLs מופרדים בפסיקים
      const parts = m[1].split(",");
      for (const part of parts) {
        const url = part.trim().split(/\s+/)[0];
        if (!url) continue;
        // התעלם מ-data: URIs ומ-svg
        if (url.startsWith("data:")) continue;
        if (/\.svg(\?|$|#)/i.test(url)) continue;
        const core = imageCoreFilename(url);
        if (core) cores.add(core);
      }
    }
    // og:image
    const ogRe =
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi;
    while ((m = ogRe.exec(html)) !== null) {
      const core = imageCoreFilename(m[1]);
      if (core) cores.add(core);
    }
    return cores;
  } catch {
    return null;
  }
}

function detectSlideKind(
  section: SectionJson,
  block?: { type?: string; settings?: Record<string, unknown> }
): HeroSlideKind {
  const t = (block?.type || section.type || "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("image-with-text") || t === "image_with_text")
    return "image-with-text";
  const settings = block?.settings || section.settings;
  if (settings) {
    if (pickFirst(settings, VIDEO_LIKE_KEYS)) return "video";
    if (pickFirst(settings, IMAGE_LIKE_KEYS)) return "image";
  }
  return "unknown";
}

/**
 * הופך ערך של setting (שיכול להיות string URL, "shopify://shop_images/...", מספר
 * MediaImage ID, או אובייקט עם {url, alt}) למערך של { url?, fileId? }.
 */
function resolveImageRef(value: unknown): {
  url?: string;
  fileId?: string;
  filename?: string;
  alt?: string;
} | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return { url: s };
    if (s.startsWith("//")) return { url: "https:" + s };
    if (s.startsWith("shopify://shop_images/")) {
      return { filename: s.replace("shopify://shop_images/", "") };
    }
    if (/^gid:\/\/shopify\/MediaImage\//.test(s)) {
      return { fileId: s };
    }
    return null;
  }
  if (typeof value === "number") {
    return { fileId: `gid://shopify/MediaImage/${value}` };
  }
  if (typeof value === "object") {
    const o = value as {
      id?: string | number;
      src?: string;
      url?: string;
      alt?: string;
      filename?: string;
    };
    if (o.url) return { url: o.url, alt: o.alt };
    if (o.src) return { url: o.src, alt: o.alt };
    if (o.id != null) {
      const fid =
        typeof o.id === "number" || /^\d+$/.test(String(o.id))
          ? `gid://shopify/MediaImage/${o.id}`
          : String(o.id);
      return { fileId: fid, alt: o.alt, filename: o.filename };
    }
  }
  return null;
}

// ---------- handler ----------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { shop?: string; token?: string };
    if (!body.shop || !body.token) {
      return NextResponse.json(
        { error: "חסר shop או token" },
        { status: 400 }
      );
    }
    const shop = normalizeShop(body.shop);
    const token = body.token;

    // 1. רשימת themes
    const themesRes = await adminFetch<{ themes?: ThemeInfo[] }>(
      shop,
      token,
      "/themes.json"
    );
    if (themesRes.status === 401 || themesRes.status === 403) {
      return NextResponse.json(
        {
          error:
            "אין הרשאת קריאת theme. הוסף לאפליקציה את הגישה read_themes (Admin API access scopes ב-Shopify Develop apps).",
        },
        { status: 401 }
      );
    }
    if (!themesRes.ok || !themesRes.data?.themes) {
      return NextResponse.json(
        {
          error: `שגיאה בטעינת רשימת ה-themes (${themesRes.status}). ${
            themesRes.text?.slice(0, 200) || ""
          }`,
        },
        { status: 502 }
      );
    }
    const main = themesRes.data.themes.find((t) => t.role === "main");
    if (!main) {
      return NextResponse.json(
        { error: "לא נמצא theme פעיל בחנות" },
        { status: 404 }
      );
    }

    // 2. templates/index.json
    const indexRes = await adminFetch<{
      asset?: { value?: string; key?: string };
    }>(
      shop,
      token,
      `/themes/${main.id}/assets.json?asset[key]=templates/index.json`
    );
    if (indexRes.status === 404) {
      return NextResponse.json(
        {
          error:
            "לא נמצא templates/index.json. ה-theme לא מבוסס OS 2.0 או שעמוד הבית משתמש בתבנית אחרת.",
        },
        { status: 404 }
      );
    }
    if (!indexRes.ok || !indexRes.data?.asset?.value) {
      return NextResponse.json(
        {
          error: `שגיאה בטעינת templates/index.json (${indexRes.status})`,
        },
        { status: 502 }
      );
    }

    let indexJson: IndexJson;
    try {
      indexJson = JSON.parse(indexRes.data.asset.value);
    } catch {
      return NextResponse.json(
        { error: "templates/index.json אינו JSON תקין" },
        { status: 502 }
      );
    }

    const sectionsMap = indexJson.sections || {};
    const order = indexJson.order || Object.keys(sectionsMap);

    // 3. בניית רשימת sections מועמדים
    const candidates: { id: string; section: SectionJson; order: number }[] =
      [];
    order.forEach((id, idx) => {
      const sec = sectionsMap[id];
      if (!sec || sec.disabled) return;
      candidates.push({ id, section: sec, order: idx });
    });

    const heroSections: HeroSection[] = [];
    const fileIdsToResolve = new Set<string>();
    const filenamesToResolve = new Set<string>();

    // נכלול כל סקשן שזוהה כ-hero. נכלול את הסקשן הראשון גם אם אינו "hero-like"
    // אם הוא כולל תמונה – זה יתפוס מקרים של theme עם hero בשם לא תקני.
    const considered = candidates.filter((c, idx) => {
      if (isHeroLikeType(c.section.type)) return true;
      // אם זה הסקשן הראשון (idx==0 בקנדידטים), נצרף אותו רק אם יש לו תמונה
      if (idx === 0) {
        const hasImg =
          !!pickFirst(c.section.settings, IMAGE_LIKE_KEYS) ||
          Object.values(c.section.blocks || {}).some(
            (b) => !!pickFirst(b?.settings, IMAGE_LIKE_KEYS)
          );
        return hasImg;
      }
      return false;
    });

    for (const c of considered) {
      const slides: HeroSlide[] = [];
      const sectionSettings = c.section.settings || {};

      const buildSlide = (
        scope: "section" | "block",
        blockId: string | null,
        rawSettings: Record<string, unknown>,
        blockType?: string
      ): HeroSlide | null => {
        const imgRef = pickFirst(rawSettings, IMAGE_LIKE_KEYS);
        const mobileImgRef = pickFirst(rawSettings, MOBILE_IMAGE_LIKE_KEYS);
        const vidRef = pickFirst(rawSettings, VIDEO_LIKE_KEYS);
        if (!imgRef && !vidRef && !mobileImgRef) return null;

        const headingRef = pickFirst(rawSettings, HEADING_LIKE_KEYS);
        const subRef = pickFirst(rawSettings, SUBHEADING_LIKE_KEYS);

        const resolved = imgRef ? resolveImageRef(imgRef.value) : null;
        let imageUrl: string | undefined;
        if (resolved?.url) imageUrl = resolved.url;
        if (resolved?.fileId) fileIdsToResolve.add(resolved.fileId);
        if (resolved?.filename) filenamesToResolve.add(resolved.filename);

        // מובייל
        const resolvedMobile = mobileImgRef
          ? resolveImageRef(mobileImgRef.value)
          : null;
        let mobileImageUrl: string | undefined;
        if (resolvedMobile?.url) mobileImageUrl = resolvedMobile.url;
        if (resolvedMobile?.fileId)
          fileIdsToResolve.add(resolvedMobile.fileId);
        if (resolvedMobile?.filename)
          filenamesToResolve.add(resolvedMobile.filename);

        const kind: HeroSlideKind = vidRef
          ? "video"
          : detectSlideKind(c.section, { type: blockType, settings: rawSettings });

        const basePath =
          scope === "section"
            ? `sections.${c.id}.settings`
            : `sections.${c.id}.blocks.${blockId}.settings`;
        const path = `${basePath}.${imgRef?.key || vidRef?.key || mobileImgRef?.key || ""}`;
        const mobilePath = mobileImgRef
          ? `${basePath}.${mobileImgRef.key}`
          : undefined;

        return {
          path,
          kind,
          imageUrl,
          rawValue: imgRef ? imgRef.value : vidRef?.value,
          mobilePath,
          mobileImageUrl,
          mobileRawValue: mobileImgRef?.value,
          alt:
            (typeof resolved?.alt === "string" && resolved.alt) ||
            (typeof rawSettings.alt === "string" && rawSettings.alt) ||
            undefined,
          heading:
            typeof headingRef?.value === "string"
              ? headingRef.value
              : undefined,
          subheading:
            typeof subRef?.value === "string" ? subRef.value : undefined,
          videoUrl:
            vidRef && typeof vidRef.value === "string"
              ? vidRef.value
              : undefined,
          hasVideo: !!vidRef,
        };
      };

      // עיבוד blocks קודם – אם יש blocks פעילים, לא נצרף slide ברמת ה-section.
      // (ב-slideshow למשל, ה-section עצמו אמנם יכול להחזיק image בתור placeholder
      // אבל בפועל מה שמוצג זה ה-blocks. אם נוסיף את שניהם, נציג כפילות.)
      const blocks = c.section.blocks || {};
      const blockOrder = c.section.block_order || Object.keys(blocks);
      let activeBlocksCount = 0;
      for (const bid of blockOrder) {
        const b = blocks[bid];
        if (!b) continue;
        // *** סינון critical: דלג על blocks שמסומנים כ-disabled ***
        // אלה blocks שיושבים ב-JSON אבל ה-theme לא מציג אותם בלייב.
        if (b.disabled === true) continue;
        const slide = buildSlide("block", bid, b.settings || {}, b.type);
        if (slide) {
          slides.push(slide);
          activeBlocksCount++;
        }
      }

      // section-level slide – רק אם אין blocks פעילים שמספקים תמונה
      // (ב-image-banner או hero בלי blocks – ה-image יושב על ה-section עצמו)
      if (activeBlocksCount === 0) {
        const sectionSlide = buildSlide(
          "section",
          null,
          sectionSettings,
          c.section.type
        );
        if (sectionSlide) slides.push(sectionSlide);
      }

      if (slides.length === 0) continue;

      heroSections.push({
        id: c.id,
        type: c.section.type || "unknown",
        displayName: prettySectionName(c.section.type || "unknown"),
        order: c.order,
        slides,
        raw: c.section as unknown as Record<string, unknown>,
      });
    }

    heroSections.sort((a, b) => a.order - b.order);

    // 4. נסה לפתור MediaImage IDs ל-URLs דרך GraphQL files
    if (fileIdsToResolve.size > 0) {
      const ids = Array.from(fileIdsToResolve);
      const query = `
        query ResolveFiles($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on MediaImage {
              id
              alt
              image { url width height altText }
            }
            ... on Video {
              id
              alt
              sources { url mimeType }
            }
          }
        }`;
      const gql = await adminGraphQL<{
        nodes: Array<{
          id?: string;
          image?: { url?: string };
          sources?: { url?: string }[];
        } | null>;
      }>(shop, token, query, { ids });
      const idToUrl = new Map<string, string>();
      gql.data?.nodes?.forEach((n) => {
        if (!n?.id) return;
        const url = n.image?.url || n.sources?.[0]?.url;
        if (url) idToUrl.set(n.id, url);
      });
      for (const sec of heroSections) {
        for (const slide of sec.slides) {
          if (!slide.imageUrl) {
            const ref = resolveImageRef(slide.rawValue);
            if (ref?.fileId && idToUrl.has(ref.fileId)) {
              slide.imageUrl = idToUrl.get(ref.fileId);
            }
          }
          if (!slide.mobileImageUrl && slide.mobileRawValue) {
            const ref = resolveImageRef(slide.mobileRawValue);
            if (ref?.fileId && idToUrl.has(ref.fileId)) {
              slide.mobileImageUrl = idToUrl.get(ref.fileId);
            }
          }
        }
      }
    }

    // 5. נסה לפתור filenames של shopify://shop_images/* דרך REST files (אם זמין)
    //    הערה: ב-API החדש זה GraphQL בלבד – ננסה לפתור גם דרך GraphQL files(query)
    if (filenamesToResolve.size > 0) {
      const filenames = Array.from(filenamesToResolve).slice(0, 50);
      // shopify://shop_images/foo.png → אנחנו לא יכולים לדעת את ה-CDN URL בלי לשאול
      // את Shopify. ננסה לחפש דרך GraphQL files שאילתת חיפוש לפי filename.
      const queries = filenames.map((f) => `filename:'${f.replace(/'/g, "")}'`);
      const fullQuery = queries.join(" OR ");
      const query = `
        query LookupFilesByFilename($q: String!) {
          files(first: 50, query: $q) {
            edges {
              node {
                ... on MediaImage {
                  id
                  alt
                  image { url }
                }
              }
            }
          }
        }`;
      try {
        const gql = await adminGraphQL<{
          files?: {
            edges?: Array<{
              node?: { id?: string; image?: { url?: string } };
            }>;
          };
        }>(shop, token, query, { q: fullQuery });
        const urls: string[] =
          gql.data?.files?.edges
            ?.map((e) => e?.node?.image?.url)
            .filter((u): u is string => !!u) || [];
        // ממפה filename -> URL לפי החיפוש בקובץ ה-URL עצמו
        const findUrlForFilename = (filename: string): string | undefined =>
          urls.find(
            (u) =>
              u.includes(encodeURIComponent(filename)) || u.includes(filename)
          );
        for (const sec of heroSections) {
          for (const slide of sec.slides) {
            if (!slide.imageUrl) {
              const ref = resolveImageRef(slide.rawValue);
              if (ref?.filename) {
                const match = findUrlForFilename(ref.filename);
                if (match) slide.imageUrl = match;
              }
            }
            if (!slide.mobileImageUrl && slide.mobileRawValue) {
              const ref = resolveImageRef(slide.mobileRawValue);
              if (ref?.filename) {
                const match = findUrlForFilename(ref.filename);
                if (match) slide.mobileImageUrl = match;
              }
            }
          }
        }
      } catch {
        // עדיין נחזיר את התוצאה גם בלי resolve מלא של URL
      }
    }

    // 5.5. אימות מול ה-HTML של האתר החי – אילו סלייד׳ים באמת מוצגים?
    //      גם אם block לא מסומן disabled, יכול להיות שה-theme לא מציג אותו
    //      (תאריכי תפוגה, תנאי visibility מותאמים, וכו'). הדרך היחידה לדעת
    //      בוודאות היא לקרוא את ה-HTML של עמוד הבית.
    let liveVerified = false;
    const liveCores = await fetchLiveHomeImages(shop);
    if (liveCores && liveCores.size > 0) {
      liveVerified = true;
      for (const sec of heroSections) {
        for (const slide of sec.slides) {
          const checkUrls: string[] = [];
          if (slide.imageUrl) checkUrls.push(slide.imageUrl);
          if (slide.mobileImageUrl) checkUrls.push(slide.mobileImageUrl);
          if (typeof slide.rawValue === "string")
            checkUrls.push(slide.rawValue);
          if (typeof slide.mobileRawValue === "string")
            checkUrls.push(slide.mobileRawValue);
          let displayed = false;
          for (const u of checkUrls) {
            const core = imageCoreFilename(u);
            if (core && liveCores.has(core)) {
              displayed = true;
              break;
            }
          }
          slide.displayedOnLive = displayed;
        }
      }
    }

    // 6. בדיקה אם יש גיבויים קיימים של templates/index.json
    let backups: { key: string; updatedAt: string }[] = [];
    try {
      const allAssets = await adminFetch<{
        assets?: Array<{ key: string; updated_at: string }>;
      }>(
        shop,
        token,
        `/themes/${main.id}/assets.json?fields=key,updated_at`
      );
      if (allAssets.ok && allAssets.data?.assets) {
        const found = allAssets.data.assets.filter((a) =>
          a.key.startsWith("config/photospro-hero-backup-")
        );
        found.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        backups = found.map((b) => ({ key: b.key, updatedAt: b.updated_at }));
      }
    } catch {}

    const result: HeroScanResult = {
      theme: main,
      backups,
      liveVerified,
      sections: heroSections,
      totalSectionsInIndex: candidates.length,
      notes:
        heroSections.length === 0
          ? [
              "לא זוהה Hero בעמוד הבית. ייתכן שה-theme שלך מבוסס Liquid ישן (לא OS 2.0) או שה-Hero תחת שם לא סטנדרטי. תוכל לעבור ל-Shopify Admin → Online Store → Customize ולראות איך נקרא הסקשן הראשון.",
            ]
          : undefined,
    };
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
