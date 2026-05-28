// יוצר הצעות איכותיות של headline / subheadline / CTA לבאנר Hero.
// משתמש ב-gpt-4o (איכות גבוהה לטקסט שיווקי).
// אכיפה קשוחה של שפה אחת בלבד + פוסט-ולידציה לתווים זרים.
// אם כל ההצעות נופלות בולידציה — מנסה שוב פעם אחת.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 45;

type BrandDna = {
  shop: string;
  brandName?: string;
  tagline?: string;
  language?: string;
  direction?: "rtl" | "ltr";
  colors?: string[];
  vibeKeywords?: string[];
  brandPersonality?: string;
  designLanguage?: string;
  targetAudience?: string;
};

type Product = { title: string };

type Suggestion = { headline: string; subheadline: string; cta: string };

// ----- CTA whitelists per language -----
// רשימה של CTA שגרתיים שטובים לאתרי איקומרס.
// המודל יקבל את הרשימה ויוכל לבחור או להציע משלו (אבל עם הקווים האדומים).
const CTA_BANK_HE = [
  "לרכישה",
  "לקולקציה",
  "לחנות",
  "להזמנה",
  "לפרטים",
  "גלו עכשיו",
  "לחוויה המלאה",
  "התחילו כאן",
  "אני רוצה",
  "עוד פרטים",
  "להצטרפות",
];

const CTA_BANK_EN = [
  "Shop now",
  "Discover",
  "Explore",
  "Browse",
  "Learn more",
  "Start here",
  "Get started",
  "View collection",
  "Find yours",
  "See more",
  "Join now",
];

const MOOD_VOICES: Record<string, string> = {
  premium:
    "elegant, refined, restrained, quietly confident. Editorial — like Aesop or Vogue. No exclamation marks. Whisper, don't shout.",
  playful:
    "warm, fun, energetic, friendly. Light wordplay welcome. Exclamation marks fine where natural.",
  minimalist:
    "very short, clean, factual. Strip every unnecessary word. Less is more. Almost haiku.",
  bold:
    "confident, punchy, declarative. Big claims. Active verbs. Like Nike or Supreme.",
  warm:
    "inviting, homey, conversational. Like a recommendation from a trusted friend.",
  tech:
    "precise, modern, slightly understated. Specs and benefits framed cleanly.",
  natural:
    "calm, organic, honest. Roots and simplicity. Speaks to wellness and conscious living.",
  festive:
    "celebratory, urgent, deal-driven. Highlight discount or special moment.",
};

// ----- Few-shot anchors per language -----
// דוגמאות לקופי טוב מול קופי רע, כדי לסמן למודל איפה הסטנדרט.
const HE_FEW_SHOT = `דוגמאות איכות (לימוד מהן):

✅ טוב — מותג טיפוח טבעי, mood: natural
   headline: "פשטות שעובדת"
   subheadline: "פורמולות נקיות, רכיבים אמיתיים, תוצאות שמרגישים"
   cta: "לקולקציה"

✅ טוב — מותג עיצוב לבית, mood: premium
   headline: "פחות, אבל נכון"
   subheadline: "כלים שנשארים אתכם שנים, בעיצוב שלא יוצא מהאופנה"
   cta: "לרכישה"

✅ טוב — מותג אופנה, mood: bold
   headline: "תהיו מעצמכם"
   subheadline: "קולקציית קיץ חדשה. עכשיו במלאי."
   cta: "לחנות"

❌ גרוע — סיבות:
   "השלם את האסתטיקה שלך" → תרגום מילולי מאנגלית, לא מתגלגל בעברית
   "מוצרים שמעבירים תחושת סדר ורוגע" → רחב מדי, לא ממוקד
   "קנייה الآن" → ערבוב שפות (الآن זה בערבית!) — אסור!

❌ גרוע: "גלה את המהות שבכל מוצר" → קלישאתי, לא ספציפי
❌ גרוע: "החוויה מתחילה כאן" → ריק תוכנית
❌ גרוע: "עיצוב חכם, חיים חכמים" → סלוגן ריק, חזרה לא מסייעת`;

const EN_FEW_SHOT = `Quality examples:

✅ GOOD — natural skincare, mood: natural
   headline: "Simple. That works."
   subheadline: "Clean formulas, real ingredients, results you feel"
   cta: "Shop the line"

✅ GOOD — homeware, mood: premium
   headline: "Less, done right"
   subheadline: "Pieces that last for years. Design that doesn't go out of style."
   cta: "Discover"

❌ BAD — vague clichés:
   "Complete your aesthetic" → translated-feel, generic
   "Smart design, smart life" → empty slogan
   "The experience starts here" → meaningless filler`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "לא הוגדר OPENAI_API_KEY בשרת" },
        { status: 500 }
      );
    }
    const body = (await req.json()) as {
      brandDna?: BrandDna;
      products?: Product[];
      mood?: string;
      n?: number;
    };
    if (!body.brandDna) {
      return NextResponse.json({ error: "חסר brandDna" }, { status: 400 });
    }
    if (!body.products || body.products.length === 0) {
      return NextResponse.json(
        { error: "צריך לפחות מוצר אחד" },
        { status: 400 }
      );
    }
    const n = Math.max(1, Math.min(5, body.n || 3));
    const dna = body.brandDna;
    const langCode = (dna.language || "").toLowerCase();
    const isHebrew = langCode === "he";

    const ctaBank = isHebrew ? CTA_BANK_HE : CTA_BANK_EN;
    const fewShot = isHebrew ? HE_FEW_SHOT : EN_FEW_SHOT;

    const moodVoice =
      MOOD_VOICES[body.mood || "premium"] || MOOD_VOICES.premium;

    const productList = body.products
      .slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.title}`)
      .join("\n");

    // --- Language enforcement block ---
    const languageRules = isHebrew
      ? `*** עברית בלבד — חוק ברזל ***
- כל הטקסט (כותרת, סאב, CTA) חייב להיות בעברית טבעית בלבד.
- אסור לחלוטין לערבב ערבית — מילים כמו "الآن", "اشتري", "اليوم" אסורות לחלוטין.
- אסור לחלוטין לערבב אנגלית — מילים כמו "now", "shop", "buy" אסורות.
- אסור תעתיק — לא לכתוב מילה אנגלית באותיות עבריות (למשל "שופ", "באי", "נאו").
- מותר: ספרות (123), סימן אחוז (%), פיסוק רגיל (.,!?-).
- חשוב על דובר עברית עם דוקטורט בכתיבה שיווקית — איך הוא היה כותב?
- כתוב בעברית עכשווית, יומיומית, לא תרגום מאנגלית.
- בלי סלנג זול ובלי תרגומים מילוליים מאנגלית.`
      : `*** ENGLISH ONLY — STRICT RULE ***
- All text must be natural, native English. No Hebrew/Arabic/other.`;

    // --- Diversity mandate: 3 distinct angles ---
    const angleMandate = isHebrew
      ? `שלוש ההצעות חייבות לתפוס זוויות שונות לחלוטין:
1) **תועלת/שינוי** — מה המוצר משנה אצל הלקוח ("ככה השולחן שלך נראה אחרת")
2) **רגש/אספירציה** — איך הלקוח מרגיש ("בית שמרגיש בית")
3) **הצעה/מוצר ישיר** — מה זה ("קולקציית קרמיקה לבית, חדש")
לא לחזור על אותו רעיון בשלוש ניסוחים שונים. כל הצעה — עולם משלה.`
      : `Three suggestions must take three distinct angles:
1) Benefit/transformation
2) Emotion/aspiration
3) Direct/product/offer
Don't paraphrase the same idea three times.`;

    const system = `You are a senior Hebrew/English copywriter for premium e-commerce hero banners.
Brand: "${dna.brandName || dna.shop}".

${languageRules}

VOICE & MOOD: ${moodVoice}

FORMAT PER SUGGESTION:
- HEADLINE (כותרת ראשית): 2-6 words. Punchy. Specific. Avoid clichés ("גלה", "הסוד", "החוויה" alone are weak).
- SUBHEADLINE: 4-12 words. Reason to care — concrete benefit, feature, or moment.
- CTA: 1-3 words. Action-oriented. ${
      isHebrew
        ? `*** Pick from this approved list when in doubt: ${ctaBank.join(
            ", "
          )} ***. ניתן להציע אחר אם הוא טבעי לחלוטין בעברית — אבל אם אתה מתלבט, השתמש מהרשימה.`
        : `Approved list: ${ctaBank.join(", ")}.`
    }

${angleMandate}

${fewShot}

Output STRICT JSON only, no markdown:
{
  "suggestions": [
    { "headline": "...", "subheadline": "...", "cta": "..." }
  ]
}`;

    const user = `Brand context:
- Name: ${dna.brandName || dna.shop}
- Tagline: ${dna.tagline || "(none)"}
${dna.brandPersonality ? `- Personality: ${dna.brandPersonality}` : ""}
${dna.targetAudience ? `- Target customer: ${dna.targetAudience}` : ""}
${dna.designLanguage ? `- Design language: ${dna.designLanguage}` : ""}
- Vibe: ${(dna.vibeKeywords || []).join(", ") || "(none)"}

Products selected for THIS specific banner:
${productList}

Mood requested: ${body.mood || "premium"}

Generate exactly ${n} diverse suggestions. ${
      isHebrew ? "כל הטקסט בעברית טהורה." : "All text in clean English."
    }`;

    const client = new OpenAI({ apiKey });

    // --- Validation function ---
    const validate = (s: Suggestion): boolean => {
      if (!s.headline?.trim() || !s.subheadline?.trim() || !s.cta?.trim())
        return false;
      const all = `${s.headline} ${s.subheadline} ${s.cta}`;
      if (isHebrew) {
        // לפסול תוויות ערבית (U+0600–U+06FF), אנגלית (a-z)
        if (/[\u0600-\u06FF]/.test(all)) return false; // ערבית
        if (/[a-zA-Z]/.test(all)) return false; // אותיות לטיניות
        if (!/[\u0590-\u05FF]/.test(s.headline)) return false; // חייב עברית
        if (!/[\u0590-\u05FF]/.test(s.subheadline)) return false;
        if (!/[\u0590-\u05FF]/.test(s.cta)) return false;
      } else {
        if (/[\u0590-\u05FF]/.test(all)) return false; // עברית
        if (/[\u0600-\u06FF]/.test(all)) return false; // ערבית
      }
      return true;
    };

    const callModel = async (extraNote = ""): Promise<Suggestion[]> => {
      const completion = await client.chat.completions.create({
        model: "gpt-4o", // איכות גבוהה — חשוב לטקסט שיווקי
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: extraNote ? `${user}\n\n${extraNote}` : user,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.85,
        max_tokens: 900,
      });
      const raw = completion.choices[0]?.message?.content;
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as { suggestions?: Suggestion[] };
        return (parsed.suggestions || []).filter(
          (s): s is Suggestion =>
            !!s &&
            typeof s.headline === "string" &&
            typeof s.subheadline === "string" &&
            typeof s.cta === "string"
        );
      } catch {
        return [];
      }
    };

    // ניסיון ראשון
    let raw = await callModel();
    let valid = raw.filter(validate);

    // אם פחות מ-n תוצאות תקפות — ננסה פעם נוספת עם הזכרה חדה יותר
    if (valid.length < n) {
      const retryNote = isHebrew
        ? `הניסיון הקודם הכיל תווים אסורים (ערבית/אנגלית) או היה בעייתי. נסה שוב — עברית טהורה בלבד, ${n} הצעות מגוונות, בלי שום מילה לא עברית.`
        : `Previous attempt had foreign characters. Retry — pure English only, ${n} diverse suggestions.`;
      const retry = await callModel(retryNote);
      const retryValid = retry.filter(validate);
      // ממזגים — מעדיפים את החדשות התקפות
      valid = [...retryValid, ...valid].slice(0, n);
    }

    valid = valid.slice(0, n);

    if (valid.length === 0) {
      return NextResponse.json(
        { error: "לא הצלחנו לייצר הצעות תקפות. נסה שוב." },
        { status: 502 }
      );
    }
    return NextResponse.json({ suggestions: valid });
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
