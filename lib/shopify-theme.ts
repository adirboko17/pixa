// טיפוסים + helpers צד-לקוח לעבודה מול Theme API של Shopify (Hero / Slideshow / Banner).
//
// אופן העבודה: האפליקציה אף פעם לא משנה את ה-theme הראשי בלי גיבוי. לפני כל
// שינוי אנחנו שומרים את `templates/index.json` המקורי כ-asset נפרד עם תאריך,
// וניתן לשחזר ממנו בלחיצה אחת. זו "מצב Draft" פרקטי – הכל קורה על ה-theme
// הראשי, אבל עם backup מובנה ושחזור (Shopify לא תומך בשכפול theme שלם דרך
// REST API, ושכפול ידני של מאות assets זה איטי ושביר).

import type { ShopifyConnection } from "./shopify-client";

// ---------- types ----------

/** סוג של סלייד/בלוק זוהה בתוך section של hero. */
export type HeroSlideKind = "image" | "video" | "image-with-text" | "unknown";

export type HeroSlide = {
  /** מפתח ייחודי בתוך index.json – למשל "blocks.slide_1.settings.image" */
  path: string;
  kind: HeroSlideKind;
  /** ה-URL של התמונה הנוכחית – אם הצלחנו לפתור אותו */
  imageUrl?: string;
  /** מקור הערך הגולמי (string / number / object) – נחוץ לשמירה ולעדכון */
  rawValue?: unknown;
  /** alt text קיים, אם יש */
  alt?: string;
  /** טקסט heading שמופיע על הסלייד (אם זוהה) */
  heading?: string;
  /** subheading / כיתוב משני */
  subheading?: string;
  /** במקרה של וידאו – ה-URL החיצוני (YouTube/Vimeo) או file reference */
  videoUrl?: string;
  /** האם הסלייד כולל וידאו (ולא רק תמונה) */
  hasVideo?: boolean;

  // --- מובייל ---
  /** מסלול ה-setting של תמונת המובייל, אם קיים בנפרד */
  mobilePath?: string;
  /** ה-URL של תמונת המובייל הנוכחית */
  mobileImageUrl?: string;
  /** raw value של setting המובייל */
  mobileRawValue?: unknown;

  // --- אימות מול האתר החי ---
  /**
   * האם זיהינו את התמונה הזאת ב-HTML של עמוד הבית בלייב?
   * - true  = נראתה ב-HTML (כנראה מוצגת)
   * - false = לא נראתה (כנראה disabled/לא רלוונטית)
   * - undefined = לא הצלחנו לבצע את הבדיקה (למשל כי האתר עם password)
   */
  displayedOnLive?: boolean;
};

export type HeroSection = {
  /** ה-id של ה-section בתוך index.json (key במפת sections) */
  id: string;
  /** ה-type של ה-section (slideshow / image-banner / hero / video / וכו') */
  type: string;
  /** שם נראה למשתמש */
  displayName: string;
  /** המיקום של הסקשן בעמוד (לפי order) – 0 = ראשון */
  order: number;
  /** הסלייד/ים שזיהינו בתוך הסקשן */
  slides: HeroSlide[];
  /** raw section JSON – לאיתור שדות נוספים בעת עדכון */
  raw: Record<string, unknown>;
};

export type ThemeInfo = {
  id: number;
  name: string;
  role: "main" | "unpublished" | "demo" | "development";
  themeStoreId?: number | null;
  previewable?: boolean;
  processing?: boolean;
  updatedAt?: string;
};

export type HeroBackup = {
  key: string;
  updatedAt: string;
};

export type HeroScanResult = {
  theme: ThemeInfo;
  /** רשימת כל הגיבויים הקיימים של templates/index.json, ממוינים מהחדש לישן */
  backups: HeroBackup[];
  /** סקשנים שזיהינו כ-hero/slideshow/banner/video, ממוינים לפי סדר הופעה */
  sections: HeroSection[];
  /** סה"כ סקשנים בעמוד הבית – לעזרה ב-debug אם לא זיהינו hero */
  totalSectionsInIndex: number;
  /** האם הצלחנו לאמת מול ה-HTML של האתר החי */
  liveVerified?: boolean;
  notes?: string[];
};

// ---------- helpers ----------

/**
 * זיהוי סקשנים שיכולים להיות "hero". אנחנו לוקחים גם את הסקשן הראשון בעמוד אם
 * הוא כולל תמונה (כי לפעמים בנו hero מותאם תחת שם אחר), וגם כל סקשן שה-type שלו
 * תואם לאחת מהמילים המוכרות.
 */
export const HERO_SECTION_TYPES = [
  "slideshow",
  "image-banner",
  "hero",
  "image-with-text",
  "video",
  "main-video",
  "rich-text-banner",
  "banner",
  "featured-image",
  "header-banner",
  "image-hero",
  "video-hero",
];

export function isHeroLikeType(type: string | undefined | null): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  if (HERO_SECTION_TYPES.includes(t)) return true;
  return /banner|hero|slideshow|carousel|video|featured-image/.test(t);
}

export function prettySectionName(type: string): string {
  const map: Record<string, string> = {
    slideshow: "סליידשואו (Slideshow)",
    "image-banner": "באנר תמונה (Image Banner)",
    hero: "Hero",
    "image-with-text": "תמונה עם טקסט",
    video: "וידאו",
    banner: "באנר",
    "featured-image": "תמונה ראשית",
  };
  return map[type.toLowerCase()] || type;
}

// ---------- API client ----------

async function postJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

/** סורק את ה-theme הראשי ומחזיר את ה-hero sections שזוהו. */
export async function scanHero(
  conn: ShopifyConnection
): Promise<HeroScanResult> {
  return postJson<HeroScanResult>("/api/shopify/theme/scan", {
    shop: conn.shop,
    token: conn.token,
  });
}

/**
 * מחליף את התמונה של סלייד מסוים. שלבים בצד השרת:
 * 1. גיבוי של templates/index.json הנוכחי (אם זה הגיבוי הראשון של היום).
 * 2. העלאת התמונה החדשה כ-theme asset (assets/photospro-hero-...).
 * 3. עדכון index.json עם ה-URL החדש של ה-asset.
 *
 * אם מועברים גם פרמטרים של מובייל (mobileSlidePath + mobileBase64), הם
 * יוחלפו באותה הקריאה כדי לשמור על ה-Hero מסונכרן בין דסקטופ למובייל.
 */
export async function replaceHeroImage(
  conn: ShopifyConnection,
  args: {
    sectionId: string;
    slidePath: string;
    base64: string;
    filename?: string;
    alt?: string;
    mobileSlidePath?: string;
    mobileBase64?: string;
    mobileFilename?: string;
  }
): Promise<{
  success: true;
  newImageUrl: string;
  newMobileImageUrl?: string;
  backupAssetKey: string;
}> {
  return postJson("/api/shopify/theme/replace-hero", {
    shop: conn.shop,
    token: conn.token,
    sectionId: args.sectionId,
    slidePath: args.slidePath,
    base64: args.base64,
    filename: args.filename,
    alt: args.alt,
    mobileSlidePath: args.mobileSlidePath,
    mobileBase64: args.mobileBase64,
    mobileFilename: args.mobileFilename,
  });
}

/** משחזר את templates/index.json מגיבוי קיים. */
export async function restoreHeroBackup(
  conn: ShopifyConnection,
  backupAssetKey: string
): Promise<{ success: true }> {
  return postJson("/api/shopify/theme/restore-backup", {
    shop: conn.shop,
    token: conn.token,
    backupAssetKey,
  });
}

/**
 * דחיפת באנר Hero לחנות בארבעה מצבים:
 * - replace: החלפת תמונה של סלייד קיים (slidePath חובה)
 * - prepend: הוספה כסלייד ראשון בסקשן slideshow
 * - append:  הוספה כסלייד אחרון
 * - solo:    הוספה + השבתה של כל שאר ה-blocks (מציג רק את החדש)
 */
export type PushHeroMode = "replace" | "prepend" | "append" | "solo";

export async function pushHero(
  conn: ShopifyConnection,
  args: {
    mode: PushHeroMode;
    sectionId: string;
    slidePath?: string;
    base64: string;
    mobileBase64?: string;
    filename?: string;
    mobileFilename?: string;
    heading?: string;
    subheadline?: string;
    cta?: string;
    buttonLink?: string;
  }
): Promise<{
  success: true;
  mode: PushHeroMode;
  desktopUrl: string;
  mobileUrl?: string;
  backupAssetKey: string;
}> {
  return postJson("/api/shopify/theme/push-hero", {
    shop: conn.shop,
    token: conn.token,
    ...args,
  });
}
