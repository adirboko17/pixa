// חילוץ "Brand DNA" עמוק של חנות.
//
// שלבים:
// 1. סריקת HTML של עמוד הבית – שליפת metadata, וניסיון ראשוני לזהות צבעים
//    ופונטים (היוריסטיקות).
// 2. הורדה של og:image, לוגו ו-favicon אם זוהו.
// 3. שליחה ל-GPT-4o (Vision) של הלוגו + og:image + טקסט הסיכום של ה-HTML.
//    המודל מחזיר ניתוח מובנה: צבעי המותג האמיתיים (לא רנדומליים מ-CSS),
//    תיאור הלוגו, אישיות המותג, שפה עיצובית, קהל יעד, ו-mood מוצע.
// 4. מיזוג: התוצאות של ה-AI מחליפות את הצבעים מההיוריסטיקה (איכות גבוהה
//    בהרבה), ומוסיפות שדות חדשים (logoDescription, brandPersonality, וכו').
// 5. אם אין OPENAI_API_KEY או שהאתר לא נגיש לתמונות – נופל בחזרה לסריקת
//    HTML בלבד (שעובדת אבל פחות מדויקת).

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeShop(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

function abs(src: string, base: string): string {
  if (!src) return src;
  src = src.trim();
  if (src.startsWith("//")) return "https:" + src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return base.replace(/\/$/, "") + src;
  return base.replace(/\/$/, "") + "/" + src;
}

function dedupePreserve<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function normalizeHexColor(c: string): string | null {
  if (!c) return null;
  c = c.trim().toLowerCase();
  const rgbM = c.match(
    /^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
  );
  if (rgbM) {
    const r = +rgbM[1],
      g = +rgbM[2],
      b = +rgbM[3];
    return (
      "#" +
      [r, g, b]
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  const hexM = c.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexM) {
    let v = hexM[1];
    if (v.length === 3) v = v.split("").map((x) => x + x).join("");
    return "#" + v;
  }
  return null;
}

function isInterestingColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (r > 245 && g > 245 && b > 245) return false;
  if (r < 10 && g < 10 && b < 10) return false;
  return true;
}

function extractColorsHeuristic(html: string): string[] {
  const found = new Map<string, number>();
  const bump = (h: string | null, weight = 1) => {
    if (!h) return;
    const cur = found.get(h) || 0;
    found.set(h, cur + weight);
  };
  for (const m of html.matchAll(
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/gi
  )) {
    bump(normalizeHexColor(m[1]), 10);
  }
  const cssVarPatterns =
    /--color-(?:button|primary|brand|accent|link|secondary|highlight|cta|button-bg)\s*:\s*([^;]+);/gi;
  for (const m of html.matchAll(cssVarPatterns)) {
    bump(normalizeHexColor(m[1]), 5);
  }
  for (const m of html.matchAll(
    /(?:background-color|background|^|;)\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/gi
  )) {
    bump(normalizeHexColor(m[1]), 1);
  }
  for (const m of html.matchAll(
    /(?:^|[\s;{])color\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/gi
  )) {
    bump(normalizeHexColor(m[1]), 1);
  }
  const sorted = Array.from(found.entries())
    .filter(([h]) => isInterestingColor(h))
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => h);
  return dedupePreserve(sorted).slice(0, 8);
}

function extractFonts(html: string): string[] {
  const fonts = new Set<string>();
  for (const m of html.matchAll(
    /<link[^>]+href=["']([^"']*fonts\.googleapis\.com[^"']+)["']/gi
  )) {
    const href = m[1];
    const familyM = href.match(/family=([^&]+)/);
    if (familyM) {
      const families = decodeURIComponent(familyM[1])
        .replace(/\+/g, " ")
        .split("|");
      for (const f of families) {
        const name = f.split(":")[0].trim();
        if (name) fonts.add(name);
      }
    }
  }
  for (const m of html.matchAll(
    /use\.typekit\.net\/([a-z0-9]+)\.css/gi
  )) {
    fonts.add(`typekit:${m[1]}`);
  }
  for (const m of html.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    const list = m[1]
      .split(",")
      .map((s) =>
        s
          .replace(/["']/g, "")
          .replace(/!important/gi, "")
          .trim()
      )
      .filter(
        (s) =>
          s &&
          !/^(inherit|initial|unset|sans-serif|serif|monospace|cursive|fantasy|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Oxygen|Ubuntu|Cantarell|Open Sans|Helvetica( Neue)?|Arial|var\(.+\))$/i.test(
            s
          )
      );
    list.forEach((f) => fonts.add(f));
  }
  return Array.from(fonts).slice(0, 6);
}

function extractMeta(html: string, key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m?.[1]?.trim();
}

/** מוצא URL של לוגו עם כמה אסטרטגיות (header img, link icon, json-ld). */
function findLogoUrl(html: string, baseUrl: string): string | undefined {
  // אסטרטגיה 1: img עם alt/class/id שמכיל "logo"
  const logoM = html.match(
    /<img[^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i
  );
  if (logoM) return abs(logoM[1], baseUrl);
  // אסטרטגיה 2: img בתוך header
  const headerM = html.match(
    /<header[^>]*>[\s\S]{0,3000}?<img[^>]+src=["']([^"']+)["']/i
  );
  if (headerM) return abs(headerM[1], baseUrl);
  // אסטרטגיה 3: schema.org/Organization JSON-LD
  const ldM = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (ldM) {
    try {
      const data = JSON.parse(ldM[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        const logo =
          obj?.logo?.url ||
          (typeof obj?.logo === "string" ? obj.logo : null);
        if (logo) return abs(logo, baseUrl);
      }
    } catch {}
  }
  return undefined;
}

/** מוריד תמונה ומחזיר אותה כ-data URL (base64) – מתאים ל-Vision API. */
async function fetchImageAsDataUrl(
  url: string,
  maxSizeBytes = 4 * 1024 * 1024
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; PhotosProBot/1.0) Chrome/120 Safari/537.36",
        accept: "image/*",
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxSizeBytes) return null;
    let mime = res.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
    if (!mime.startsWith("image/")) {
      const lower = url.toLowerCase();
      if (lower.endsWith(".png")) mime = "image/png";
      else if (lower.endsWith(".webp")) mime = "image/webp";
      else if (lower.endsWith(".svg")) mime = "image/svg+xml";
      else mime = "image/jpeg";
    }
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

type AiAnalysis = {
  brandColors: string[]; // hex
  ctaColor?: string;
  logoDescription?: string;
  brandPersonality?: string;
  designLanguage?: string;
  targetAudience?: string;
  vibeKeywords?: string[];
  suggestedMood?: string;
};

async function deepAnalyzeWithVision(args: {
  brandName?: string;
  tagline?: string;
  shop: string;
  language?: string;
  ogImageDataUrl?: string;
  logoDataUrl?: string;
  heuristicColors: string[];
  fonts: string[];
}): Promise<AiAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // אם אין שום תמונה לנתח – נשלח בכל זאת ל-LLM עם מטא-דאטה (עדיין שיפור)
  const hasImages = !!args.ogImageDataUrl || !!args.logoDataUrl;

  const client = new OpenAI({ apiKey });

  // שפת התצוגה לטקסט. כברירת מחדל – שפת המותג. אם לא ידועה – אנגלית.
  const langCode = (args.language || "").toLowerCase();
  const responseLang =
    langCode === "he"
      ? "Hebrew (עברית) — RIGHT-TO-LEFT, natural Hebrew, no English interspersed in the descriptive text"
      : langCode === "ar"
      ? "Arabic"
      : langCode === "fr"
      ? "French"
      : langCode === "es"
      ? "Spanish"
      : langCode === "de"
      ? "German"
      : "English";

  const systemPrompt = `You are a senior brand strategist analyzing an e-commerce store.
Your job: examine the visual references provided (logo, hero image) AND the metadata (brand name, tagline, language, fonts, heuristically-detected colors), then output a structured brand DNA analysis.

LANGUAGE RULE — VERY IMPORTANT:
All descriptive text fields (logoDescription, brandPersonality, designLanguage, targetAudience) MUST be written in: ${responseLang}.
Keep vibeKeywords as short LOWERCASE English tags (they're technical labels, e.g. "minimalist", "hebrew-modern").
Keep suggestedMood as one of the fixed English values listed below.

CRITICAL RULES:
1. brandColors: pick 3-5 colors that ACTUALLY define this brand visually. ONLY include colors you can see prominently in the logo or og:image. Ignore the heuristic colors if they don't match the actual visual brand. Each color is a hex string like "#a1b2c3". Order them most→least important.
2. ctaColor: pick the single best color for a primary CTA button. Should be one that contrasts well and grabs attention.
3. logoDescription: 2-3 sentences describing what the logo looks like AND what feeling it conveys. Be VIVID and specific — not generic. Mention shapes, weight, character.
4. brandPersonality: 2-3 sentences capturing WHO this brand is — the human-feeling personality traits, the tone of voice. Write like you're describing a person.
5. designLanguage: 2-3 sentences about the visual identity (typography choices, photography style, layout patterns, mood, what makes this brand recognizable visually).
6. targetAudience: 1-2 sentences describing the target customer — their lifestyle, age range, what they value.
7. vibeKeywords: 4-6 short ENGLISH tags (1-2 words each, lowercase, hyphen-separated like "premium-minimalist") that capture the brand essence.
8. suggestedMood: pick exactly ONE of: "premium", "playful", "minimalist", "bold", "warm", "tech", "natural", "festive".

If you cannot see images and only have metadata, do your best with the text but be honest about limitations.

Return STRICT JSON only, no markdown, no commentary, exactly this shape:
{
  "brandColors": ["#hex", ...],
  "ctaColor": "#hex",
  "logoDescription": "...",
  "brandPersonality": "...",
  "designLanguage": "...",
  "targetAudience": "...",
  "vibeKeywords": ["...", "..."],
  "suggestedMood": "..."
}`;

  const userText = `Brand metadata:
- Shop domain: ${args.shop}
- Brand name: ${args.brandName || "(unknown)"}
- Tagline: ${args.tagline || "(none)"}
- Language: ${args.language || "(unknown)"}
- Fonts detected on site: ${args.fonts.join(", ") || "(none detected)"}
- Heuristically-detected colors (USE WITH SUSPICION — many are random CSS values, not real brand colors): ${args.heuristicColors.join(", ") || "(none)"}

${
  args.logoDataUrl
    ? "I'm attaching the brand's LOGO."
    : "Logo image not available."
}
${
  args.ogImageDataUrl
    ? " I'm attaching the homepage og:image (their main visual)."
    : " og:image not available."
}

Analyze the brand DNA based on what you can SEE and reason from the metadata. Output the structured JSON exactly.`;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
  > = [{ type: "text", text: userText }];

  if (args.logoDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: args.logoDataUrl, detail: "high" },
    });
  }
  if (args.ogImageDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: args.ogImageDataUrl, detail: "high" },
    });
  }

  try {
    // gpt-4o – הכי מדויק לניתוח חזותי. עלות: ~$0.01-0.03 לסריקה.
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        // אם אין תמונות, נשלח רק טקסט; אחרת ה-content הוא array
        {
          role: "user",
          content: hasImages ? content : userText,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1000,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiAnalysis;
    // ניקוי – וידוא שהצבעים תקינים
    if (Array.isArray(parsed.brandColors)) {
      parsed.brandColors = parsed.brandColors
        .map((c) => normalizeHexColor(c))
        .filter((c): c is string => c !== null);
    }
    if (parsed.ctaColor) {
      parsed.ctaColor = normalizeHexColor(parsed.ctaColor) || undefined;
    }
    return parsed;
  } catch (e) {
    console.warn("[brand-dna] vision analysis failed:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { shop?: string };
    if (!body.shop) {
      return NextResponse.json({ error: "חסר shop" }, { status: 400 });
    }
    const shop = normalizeShop(body.shop);
    const baseUrl = `https://${shop}`;

    // 1. סריקת HTML של עמוד הבית
    let res: Response;
    try {
      res = await fetch(baseUrl, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; PhotosProBot/1.0) Chrome/120 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e: unknown) {
      return NextResponse.json(
        {
          error: `לא הצלחנו לגשת ל-${baseUrl}: ${
            e instanceof Error ? e.message : "תקלה"
          }`,
        },
        { status: 502 }
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `האתר החזיר ${res.status}. ייתכן שהוא מוגן בסיסמה.` },
        { status: res.status }
      );
    }
    const html = await res.text();

    // שם מותג
    const brandName =
      extractMeta(html, "og:site_name") ||
      (() => {
        const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        if (!t) return undefined;
        const cleaned = t.replace(/\s+/g, " ").trim();
        const parts = cleaned.split(/\s[-–—|•]\s|::/);
        if (parts.length > 1) {
          parts.sort((a, b) => a.length - b.length);
          return parts[0].trim();
        }
        return cleaned;
      })();

    const tagline =
      extractMeta(html, "og:description") ||
      extractMeta(html, "description");

    // שפה + כיוון
    const langM = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
    const dirM = html.match(/<html[^>]+dir=["']([^"']+)["']/i);
    const language = langM?.[1]?.split("-")[0];
    const direction =
      dirM?.[1]?.toLowerCase() === "rtl"
        ? "rtl"
        : dirM?.[1]?.toLowerCase() === "ltr"
        ? "ltr"
        : language === "he" || language === "ar" || language === "fa"
        ? "rtl"
        : undefined;

    const heuristicColors = extractColorsHeuristic(html);
    const fonts = extractFonts(html);

    const ogImageRel = extractMeta(html, "og:image");
    const ogImageUrl = ogImageRel ? abs(ogImageRel, baseUrl) : undefined;
    const faviconM = html.match(
      /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i
    );
    const faviconUrl = faviconM ? abs(faviconM[1], baseUrl) : undefined;
    const logoUrl = findLogoUrl(html, baseUrl);

    // 2. הורדת התמונות במקביל
    const [ogImageDataUrl, logoDataUrl] = await Promise.all([
      ogImageUrl
        ? fetchImageAsDataUrl(ogImageUrl).catch(() => null)
        : Promise.resolve(null),
      logoUrl
        ? fetchImageAsDataUrl(logoUrl).catch(() => null)
        : Promise.resolve(null),
    ]);

    // 3. ניתוח עמוק עם Vision
    const ai = await deepAnalyzeWithVision({
      brandName,
      tagline,
      shop,
      language,
      ogImageDataUrl: ogImageDataUrl || undefined,
      logoDataUrl: logoDataUrl || undefined,
      heuristicColors,
      fonts,
    });

    // 4. מיזוג: AI > heuristic
    const finalColors =
      ai?.brandColors && ai.brandColors.length > 0
        ? ai.brandColors
        : heuristicColors;

    const buttonColor =
      ai?.ctaColor ||
      ((): string | undefined => {
        const m = html.match(/--color-button(?:-bg)?\s*:\s*([^;]+);/i);
        return m ? normalizeHexColor(m[1]) || undefined : undefined;
      })();

    const vibeKeywords = ai?.vibeKeywords || [];
    if (vibeKeywords.length === 0) {
      // fallback: heuristic vibe
      if (language === "he") vibeKeywords.push("hebrew-modern");
      if (finalColors.length) {
        const r = parseInt(finalColors[0].slice(1, 3), 16);
        const g = parseInt(finalColors[0].slice(3, 5), 16);
        const b = parseInt(finalColors[0].slice(5, 7), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum < 0.35) vibeKeywords.push("dark-moody");
        else if (lum > 0.75) vibeKeywords.push("light-airy");
        else vibeKeywords.push("balanced");
      }
    }

    const validMoods = [
      "premium",
      "playful",
      "minimalist",
      "bold",
      "warm",
      "tech",
      "natural",
      "festive",
    ] as const;
    const suggestedMood =
      ai?.suggestedMood &&
      (validMoods as readonly string[]).includes(ai.suggestedMood)
        ? (ai.suggestedMood as (typeof validMoods)[number])
        : undefined;

    const dna = {
      shop,
      brandName,
      tagline,
      language,
      direction,
      colors: finalColors,
      buttonColor,
      fonts,
      ogImageUrl,
      logoUrl,
      faviconUrl,
      vibeKeywords,
      logoDescription: ai?.logoDescription,
      brandPersonality: ai?.brandPersonality,
      designLanguage: ai?.designLanguage,
      targetAudience: ai?.targetAudience,
      suggestedMood,
      aiAnalyzed: !!ai,
      scannedAt: Date.now(),
    };

    return NextResponse.json(dna);
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
