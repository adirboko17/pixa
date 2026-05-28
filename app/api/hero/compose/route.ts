// יצירת באנר Hero מאפס המבוסס על:
// - Brand DNA של החנות (צבעים, פונטים, שפה, og:image כתמונת ייחוס)
// - 1+ תמונות מוצרים שנבחרו
// - Brief של המשתמש (headline / subheadline / CTA / mood / custom notes)
//
// אנחנו שולחים ל-gpt-image-2 את כל תמונות המוצרים + תמונת ייחוס מהאתר (og:image)
// כדי שהמודל "ירגיש" את הסגנון של המותג ויתאים את הקומפוזיציה. אנחנו מייצרים
// במקביל גרסה לדסקטופ (1536×1024 = ~16:9) וגרסה למובייל (1024×1536 = ~9:16),
// כאשר כל אחת מקבלת prompt עם הוראות סידור שונות.

import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { actualCostFromUsageUSD } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 300;

type Product = { title: string; imageUrl: string };

type Brief = {
  headline?: string;
  subheadline?: string;
  cta?: string;
  mood?:
    | "premium"
    | "playful"
    | "minimalist"
    | "bold"
    | "warm"
    | "tech"
    | "natural"
    | "festive";
  customNotes?: string;
  fonts?: { headline?: string; body?: string };
  /**
   * האם הטקסט (headline/sub/CTA) יוטמע על-ידי המודל. ברירת מחדל false:
   * המודל מייצר תמונה נקייה ללא טקסט, והטקסט מוטמע בצד הלקוח דרך Canvas
   * (הרבה יותר מדויק, פונט אמיתי, וזהה בין דסקטופ למובייל).
   * משאירים טקסט-בתמונה אופציונלי לאחור-תאימות אם תרצה.
   */
  textInImage?: boolean;
  /** באיזה צד הטקסט יישב – משפיע על הקומפוזיציה (איפה לשים את המוצרים). */
  textSide?: "right" | "left" | "center";
};

type Quality = "low" | "medium" | "high";

type BrandDna = {
  shop: string;
  brandName?: string;
  tagline?: string;
  language?: string;
  direction?: "rtl" | "ltr";
  colors: string[];
  buttonColor?: string;
  fonts: string[];
  ogImageUrl?: string;
  logoUrl?: string;
  vibeKeywords: string[];
  // ניתוח AI עמוק (זמין כשהסריקה כללה Vision)
  logoDescription?: string;
  brandPersonality?: string;
  designLanguage?: string;
  targetAudience?: string;
};

const MOOD_DESCRIPTIONS: Record<NonNullable<Brief["mood"]>, string> = {
  premium:
    "Premium / luxury. Editorial magazine-cover quality. Refined composition, sophisticated lighting, generous negative space. Restrained color palette. Think Net-a-Porter, Aesop, Apple's product photography.",
  playful:
    "Playful and energetic. Vibrant pops of color, dynamic asymmetric composition, slight tilt, optional confetti or organic doodles. Think MailChimp, Glossier, fun DTC brands.",
  minimalist:
    "Minimalist. Tons of negative space, single product hero, ultra-clean. Geometric simplicity. Almost-monochrome palette with one accent color. Think Muji, Apple.",
  bold:
    "Bold and high-contrast. Strong typography, saturated brand colors, confident composition. Big visual statement that grabs attention immediately. Think Nike, Supreme.",
  warm:
    "Warm and inviting. Natural light, soft shadows, earthy/warm color tones. Lifestyle context. Think Williams Sonoma, Le Creuset, artisan brands.",
  tech:
    "Tech-forward / clean. Subtle gradients, geometric accents, sharp focus, dark or near-black backgrounds with neon accents. Think Apple, Samsung, Anker.",
  natural:
    "Natural / organic. Botanical elements, soft daylight, raw textures (linen, wood, stone), green/earth tones. Think Aesop, The Body Shop natural lines.",
  festive:
    "Festive / promotional. Energetic but classy. Confetti, ribbons, sparkles or seasonal motifs as accents (not overwhelming). Strong CTA energy.",
};

/**
 * תיאורים של פונטי Google Fonts פופולריים – המודל לא יכול לטעון פונט אמיתי
 * אבל תיאור מילולי מפורט של אופי הצורות מנחה אותו לסגנון מאוד דומה.
 */
const FONT_DESCRIPTIONS: Record<string, string> = {
  Heebo:
    "modern, clean, slightly geometric sans-serif. Crisp, even-weight Hebrew letterforms with squared terminals. Contemporary and professional — used widely by Israeli tech brands",
  Assistant:
    "rounded, friendly modern sans-serif. Soft curves, very readable, slightly humanist. Approachable and warm",
  Rubik:
    "geometric rounded sans-serif with soft corners on every letter. Contemporary, playful but still clean",
  Karantina:
    "condensed bold display sans. Narrow, tall, very impactful. Confident and graphic — great for big headlines",
  "Suez One":
    "heavy display serif with strong, confident strokes and slab-like terminals. Bold and editorial",
  "Secular One":
    "bold geometric sans with even, strong weight throughout. Modern and assertive",
  "Frank Ruhl Libre":
    "elegant traditional serif with refined Hebrew letterforms. Classical and editorial — like a respected magazine masthead",
  Bellefair:
    "elegant transitional serif with classical proportions and high contrast",
  "Noto Sans Hebrew":
    "neutral, highly readable sans-serif optimized for Hebrew. Modern and unopinionated",
  "Noto Serif Hebrew":
    "balanced, readable serif optimized for Hebrew. Traditional but clean",
  "Miriam Libre":
    "modern Hebrew display sans-serif with geometric character. Clean and confident",
  Alef:
    "humanist sans-serif with bilingual Hebrew/Latin support. Versatile and balanced",
  "Varela Round":
    "fully-rounded sans-serif. Soft and friendly, all corners rounded",
  "David Libre":
    "traditional Hebrew serif inspired by classic David typeface. Calligraphic and elegant",
  "Playfair Display":
    "high-contrast elegant serif with thin hairlines and bold strokes. Magazine-quality, sophisticated",
  "Cormorant Garamond":
    "refined Garamond-inspired serif with elegant proportions and old-style numerals",
  Inter:
    "neutral, highly-tuned modern sans-serif. Tech-forward, very readable on screens",
  Poppins:
    "geometric sans-serif with consistent character widths. Modern and friendly",
  Montserrat:
    "geometric sans-serif inspired by urban Buenos Aires signage. Modern, slightly condensed",
};

function fontDescription(name: string | undefined): string | null {
  if (!name) return null;
  return FONT_DESCRIPTIONS[name] || `a typography style similar to "${name}"`;
}

function buildTypographyBlock(brief: Brief): string {
  const headlineFont = fontDescription(brief.fonts?.headline);
  const bodyFont = fontDescription(brief.fonts?.body);
  return `
TYPOGRAPHY & TEXT RENDERING (CRITICAL):
- All text must be rendered crisply and legibly — like a real, professional Shopify hero banner.
- Hebrew text (right-to-left): pixel-faithful character shapes for ALL letters including final letters (ך ם ן ף ץ). The text reads RIGHT-TO-LEFT. Do NOT mirror, do NOT garble, do NOT replace characters with random shapes.
${
  headlineFont
    ? `- HEADLINE TYPOGRAPHY (must match this style closely): ${headlineFont}.`
    : "- HEADLINE: use a clean modern sans-serif appropriate for the language and mood."
}
${
  bodyFont
    ? `- SUBHEADLINE & CTA TYPOGRAPHY (must match this style closely): ${bodyFont}.`
    : "- SUBHEADLINE & CTA: use a typography style that pairs well with the headline (slightly lighter weight if the headline is bold, similar character if the headline is a serif)."
}
- TEXT ALIGNMENT (NON-NEGOTIABLE — VERY IMPORTANT):
  • All text elements (headline, subheadline, CTA button) MUST share the SAME horizontal alignment axis.
  • For RTL/Hebrew layouts where text sits on the RIGHT side of the banner: align all text elements RIGHT (right edges flush).
  • For LTR/English layouts where text sits on the LEFT side: align all text elements LEFT.
  • For text that sits in the CENTER of the composition: center-align ALL three elements (headline, subheadline, CTA button) on the SAME vertical center line. The headline's center, the subheadline's center, AND the button's horizontal center MUST all line up perfectly on one invisible vertical axis.
  • The CTA button's left/right edges OR center (depending on alignment) MUST line up exactly with the headline's edges/center. NEVER let the button drift left or right relative to the text above it.
  • Vertical spacing: consistent, generous gaps between headline → subheadline → CTA. Each element should "breathe" with equal spacing to the next.
- Headline must be the largest, clearly dominant element. Subheadline is ~40-60% of the headline size. CTA button has clear background contrast against the banner.
- Headline + subheadline + CTA must NEVER overlap with the products. They sit in the empty / negative space portion of the composition, as a tight, well-aligned text block.
- Do NOT add any text that wasn't explicitly requested. NO logos, NO brand watermarks, NO random taglines, NO extra "subtitle" lines.`;
}

const PRODUCT_FIDELITY_BLOCK = `
PRODUCT FIDELITY (ABSOLUTE — THIS IS THE #1 RULE):
- Treat every product reference image as a PHOTOGRAPHIC INSERT. Place it into the scene as if it were a high-quality cut-out of the original photo. DO NOT redraw, redesign, restyle, recolor, or "improve" the product.
- The product's SHAPE, PROPORTIONS, MATERIALS, and COLORS must be IDENTICAL to the reference. Bottle shape, cap color, trigger spray, label cut — every detail.
- LABELS / PACKAGING TEXT: every word, every letter, every glyph on the product packaging MUST appear EXACTLY as in the reference. This applies to:
  • Brand names printed on the bottle/box
  • Product names (in Hebrew, Arabic, English, or ANY other language)
  • Hebrew text including final letters (ך ם ן ף ץ) — preserve character-by-character
  • Numbers, percentages, weights, measurements
  • Logos, icons, symbols, certification badges
  • Color stripes, decorative patterns
- DO NOT translate label text. DO NOT replace foreign text with Latin/English. DO NOT regenerate text "in the spirit of" the original — copy it pixel-faithful.
- DO NOT remove items, parts, or accessories from the product. DO NOT add fictional products that weren't in the references.
- If you can't render a label perfectly, render it slightly out-of-focus rather than guessing — but do NOT change what's written.
- Allowed adjustments: lighting on the product (to match the scene), subtle shadow on the surface, very minor rotation/scale to fit the layout. NOTHING ELSE.`;

const NO_TEXT_BLOCK = `
NO TEXT IN THIS IMAGE:
- DO NOT render any headline, subheadline, marketing copy, or CTA button on this image. The text overlay is added later in code, on top of this image, using a real font.
- DO NOT add any decorative text, taglines, brand names, watermarks, or labels that weren't already on the product packaging.
- The ONLY text that may appear in the image is the existing pixel-faithful product packaging (preserve as-is — see PRODUCT FIDELITY).
- Leave clean, empty negative space in the area reserved for the text overlay (see LAYOUT). This space should be a soft, uniform, uncluttered surface that text can sit on top of cleanly.`;

function moodPrompt(mood: Brief["mood"] | undefined): string {
  if (!mood) return MOOD_DESCRIPTIONS.premium;
  return MOOD_DESCRIPTIONS[mood] || MOOD_DESCRIPTIONS.premium;
}

function buildPrompt(args: {
  format: "desktop" | "mobile";
  brandDna: BrandDna;
  products: Product[];
  brief: Brief;
  productImagesCount: number;
  hasReference: boolean;
}): string {
  const { format, brandDna, products, brief, productImagesCount, hasReference } =
    args;
  const isRTL = brandDna.direction === "rtl";
  const renderText = !!brief.textInImage;

  // איפה הטקסט יושב – משפיע איפה המוצרים יושבים. ברירת מחדל: ימין ב-RTL, שמאל אחרת.
  const textSide: "right" | "left" | "center" =
    brief.textSide || (isRTL ? "right" : "left");

  // הסבר סדר התמונות שמועברות למודל:
  const imagesExplain: string[] = [];
  let i = 1;
  if (hasReference) {
    imagesExplain.push(
      `IMAGE ${i++} = BRAND REFERENCE (the homepage / og:image of "${
        brandDna.brandName || brandDna.shop
      }"). Use it ONLY to absorb the brand's visual style, color mood, and overall feel. Do NOT copy any product or scene from this image directly.`
    );
  }
  products.forEach((p, idx) => {
    imagesExplain.push(
      `IMAGE ${i++} = PRODUCT ${idx + 1}: "${p.title}". This is one of the products that MUST appear in the final hero banner — preserved exactly as the reference.`
    );
  });

  const colorsList =
    brandDna.colors.slice(0, 5).join(", ") || "(neutrals)";
  const buttonColor = brandDna.buttonColor
    ? `If a CTA button is rendered: button background must be ${brandDna.buttonColor}.`
    : "";

  // לאן ילך הטקסט והיכן יהיו המוצרים
  const productSide: "left" | "right" | "center" =
    textSide === "right" ? "left" : textSide === "left" ? "right" : "center";

  const composition =
    format === "desktop"
      ? `LAYOUT — DESKTOP HERO BANNER (16:9 wide, 1536×1024):
- Split composition: products occupy ≈58–65% of the width on the ${productSide.toUpperCase()} side. The OTHER side (≈35–42%) is reserved as CLEAN, UNCLUTTERED NEGATIVE SPACE for the text overlay (added later in code).
- The negative space side must be a soft, uniform background — gentle gradient or single brand color from the palette. NO objects, props, decorations, or competing elements there. NO splashes, NO sparkles, NO decorative text.
- Products on the ${productSide.toUpperCase()} side: arrange them like an editorial product photograph. They sit together on a tasteful surface (cream marble, soft warm beige, brushed concrete, brand-color paper, etc. — whatever fits the mood). The lighting is bright, soft, even — like Apple/Aesop product photography.
- Vertical balance: products vertically centered or slightly raised. Surface/podium grounds them.
- Camera angle: slight 3D perspective, products feel real and tangible. Catch subtle highlights and reflections.
- The composition must feel SCROLL-STOPPING — like a flagship hero banner from a leading e-commerce brand.`
      : `LAYOUT — MOBILE HERO BANNER (9:16 portrait, 1024×1536) — STRICT THREE-ZONE COMPOSITION:
This is CRITICAL. The mobile banner MUST be split into three vertical zones, with strict separation:

▣ TOP ZONE — pixels 0 to ~470 (top 30% of the 1536px height):
  ABSOLUTELY EMPTY of products. Pure background only — soft gradient, single brand color, soft texture (cream paper, blurred bokeh). No bottle silhouettes, no spray triggers, no labels, NO PART of any product may enter this zone, not even a tip or shadow. This zone will be covered by the text overlay later.

▣ MIDDLE ZONE — pixels ~470 to ~1080 (middle 40% of the height):
  This is the products zone. Group all products here, tightly arranged, large and clearly visible. They sit on a tasteful surface (marble, linen, brand-color paper). Products are the visual focus.

▣ BOTTOM ZONE — pixels ~1080 to 1536 (bottom 30% of the height):
  ABSOLUTELY EMPTY of products. Same kind of clean background as the top zone (you may show only the surface they sit on, but no product silhouettes, no labels, no logos, no decorative shapes). This zone will be covered by the CTA button overlay later.

ENFORCEMENT:
- If you cannot fit the products in the middle zone without crossing into top or bottom — make the products SMALLER. Do NOT crop the top or bottom zones. They are sacred negative space.
- Products may NOT extend their shadows into the top or bottom zones — keep all shadows confined to the middle zone.
- Do NOT add decorative props (leaves, ribbons, bottles of water, etc.) to the top or bottom zones.

OTHER:
- Generous side margins (don't touch the edges of the phone).
- Same lighting + photography style as the desktop version (so they feel like a matched SET).
- Backgrounds in top and bottom zones should match each other (continuous color/gradient, even if slightly different shade).`;

  const briefBlock = renderText
    ? `BRIEF / COPY (text rendered IN the image — only if explicitly asked):
- Language: ${brandDna.language || (isRTL ? "he" : "en")}${isRTL ? " (RTL)" : ""}.
${brief.headline ? `- HEADLINE: """${brief.headline}"""` : ""}
${brief.subheadline ? `- SUBHEADLINE: """${brief.subheadline}"""` : ""}
${brief.cta ? `- CTA BUTTON: """${brief.cta}"""` : ""}
${brief.customNotes ? `- ART DIRECTION: ${brief.customNotes}` : ""}`
    : `BRIEF / ART DIRECTION:
- The text overlay (headline + sub + CTA) will be added LATER in code. Do NOT render any of it inside this image. Just leave the negative-space area clean and inviting.
- Language hint (for mood only): ${brandDna.language || (isRTL ? "he" : "en")}${isRTL ? " (RTL)" : ""}.
${brief.customNotes ? `- ADDITIONAL USER ART DIRECTION: ${brief.customNotes}` : ""}`;

  return `You are a senior brand art director designing a brand-new e-commerce HERO BANNER for the Shopify storefront of "${
    brandDna.brandName || brandDna.shop
  }". This banner is the main top-of-page hero that customers see first when they land on the site. It must feel premium, on-brand, and convert visitors into buyers.

INPUT IMAGES (${productImagesCount + (hasReference ? 1 : 0)} total):
${imagesExplain.join("\n")}

BRAND DNA (must be respected — this is the heart of the brand):
- Brand name: ${brandDna.brandName || "(unknown)"}
- Tagline: ${brandDna.tagline || "(none)"}
- Color palette (most prominent first — use as the banner's color foundation, especially the background): ${colorsList}
- Vibe keywords: ${brandDna.vibeKeywords.join(", ") || "(none)"}${brandDna.logoDescription ? `\n- Logo essence: ${brandDna.logoDescription}` : ""}${brandDna.brandPersonality ? `\n- Brand personality: ${brandDna.brandPersonality}` : ""}${brandDna.designLanguage ? `\n- Design language to honor: ${brandDna.designLanguage}` : ""}${brandDna.targetAudience ? `\n- Target audience the visual must speak to: ${brandDna.targetAudience}` : ""}
- ${buttonColor}

REQUESTED MOOD: ${brief.mood || "premium"} → ${moodPrompt(brief.mood)}

${composition}

${briefBlock}

${renderText ? buildTypographyBlock(brief) : NO_TEXT_BLOCK}

${PRODUCT_FIDELITY_BLOCK}

OUTPUT REQUIREMENTS (production-grade hero banner):
- PHOTOREALISTIC, retail-ready, ULTRA-SHARP. This image will be displayed as the homepage hero of a real Shopify store on retina screens.
- LIGHTING: bright, soft, professional studio lighting. Even key light, gentle fill, soft natural shadows that ground the products.
- SURFACES & PROPS: refined and tasteful. Marble, brushed concrete, warm beige paper, cream linen, polished wood — whatever fits the mood. NO clutter.
- BACKGROUND: a tasteful color from the brand palette (or a clean off-white if minimalist mood). Smooth gradient is preferred to a flat single color. NEVER random saturated color.
- COMPOSITION: editorial, balanced, "magazine cover"-quality. Products grouped like a curated still-life.
- DEPTH: shallow but real depth-of-field. Products fully sharp; subtle background blur to add depth.
- COLOR HARMONY: dominant color = brand background. Accent color = small natural pops (a leaf, a fabric, a shadow tone). Not loud.
- NO additional text beyond exactly what is on the product packaging. NO logos overlaid. NO watermarks. NO captions.
- The final image must look like it could go LIVE on a successful brand's homepage right now.`;
}

function pickMime(filename: string, fallback = "image/jpeg") {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return fallback;
}

async function fetchImageAsFile(
  url: string,
  filename: string
): Promise<Awaited<ReturnType<typeof toFile>>> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; PhotosProBot/1.0) Chrome/120 Safari/537.36",
      accept: "image/*",
    },
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return await toFile(buf, filename, { type: pickMime(filename) });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "לא הוגדר OPENAI_API_KEY ב-.env.local" },
        { status: 500 }
      );
    }
    const body = (await req.json()) as {
      brandDna?: BrandDna;
      products?: Product[];
      brief?: Brief;
      quality?: Quality;
    };
    if (!body.brandDna) {
      return NextResponse.json(
        { error: "חסר brandDna" },
        { status: 400 }
      );
    }
    if (!body.products || body.products.length === 0) {
      return NextResponse.json(
        { error: "חייב לבחור לפחות מוצר אחד" },
        { status: 400 }
      );
    }
    if (body.products.length > 5) {
      return NextResponse.json(
        { error: "מקסימום 5 מוצרים בבאנר אחד" },
        { status: 400 }
      );
    }
    const brief = body.brief || {};
    const quality: Quality =
      body.quality === "low" || body.quality === "medium" || body.quality === "high"
        ? body.quality
        : "high";

    const client = new OpenAI({ apiKey });

    // 1. הורדה של תמונות המוצרים + תמונת הייחוס במקביל
    const productFilesPromise = Promise.all(
      body.products.map((p, idx) =>
        fetchImageAsFile(
          p.imageUrl,
          `product-${idx + 1}.jpg`
        ).catch((e) => {
          console.warn(
            "[hero/compose] failed to fetch product image",
            p.imageUrl,
            e
          );
          return null;
        })
      )
    );
    const refFilePromise = body.brandDna.ogImageUrl
      ? fetchImageAsFile(body.brandDna.ogImageUrl, "brand-reference.jpg").catch(
          (e) => {
            console.warn(
              "[hero/compose] failed to fetch brand reference",
              e
            );
            return null;
          }
        )
      : Promise.resolve(null);

    const [productFiles, refFile] = await Promise.all([
      productFilesPromise,
      refFilePromise,
    ]);

    const validProductFiles = productFiles.filter(
      (f): f is Awaited<ReturnType<typeof toFile>> => f != null
    );
    if (validProductFiles.length === 0) {
      return NextResponse.json(
        {
          error:
            "לא הצלחנו להוריד אף תמונת מוצר. ייתכן שה-URLים לא נגישים – נסה מוצרים אחרים.",
        },
        { status: 502 }
      );
    }

    // סדר התמונות שמועבר למודל: [רפרנס, מוצר1, מוצר2, ...]
    const imageInputs: Awaited<ReturnType<typeof toFile>>[] = [];
    if (refFile) imageInputs.push(refFile);
    imageInputs.push(...validProductFiles);

    // 2. שני prompts (desktop + mobile) לקריאות מקבילות
    const promptDesktop = buildPrompt({
      format: "desktop",
      brandDna: body.brandDna,
      products: body.products.slice(0, validProductFiles.length),
      brief,
      productImagesCount: validProductFiles.length,
      hasReference: !!refFile,
    });
    const promptMobile = buildPrompt({
      format: "mobile",
      brandDna: body.brandDna,
      products: body.products.slice(0, validProductFiles.length),
      brief,
      productImagesCount: validProductFiles.length,
      hasReference: !!refFile,
    });

    // 3. קריאות מקבילות. אם אחת נכשלת – נחזיר שגיאה ברורה.
    const [deskRes, mobRes] = await Promise.all([
      client.images.edit({
        model: "gpt-image-2",
        image: imageInputs,
        prompt: promptDesktop,
        size: "1536x1024",
        quality,
        background: "opaque",
        n: 1,
      }),
      client.images.edit({
        model: "gpt-image-2",
        image: imageInputs,
        prompt: promptMobile,
        size: "1024x1536",
        quality,
        background: "opaque",
        n: 1,
      }),
    ]);

    const desktopB64 = deskRes.data?.[0]?.b64_json;
    const mobileB64 = mobRes.data?.[0]?.b64_json;
    if (!desktopB64 || !mobileB64) {
      return NextResponse.json(
        { error: "המודל לא החזיר תמונה. נסה שוב." },
        { status: 502 }
      );
    }
    const costDesktop = actualCostFromUsageUSD(deskRes.usage ?? null);
    const costMobile = actualCostFromUsageUSD(mobRes.usage ?? null);
    const costUSD = (costDesktop || 0) + (costMobile || 0);

    return NextResponse.json({
      desktopDataUrl: `data:image/png;base64,${desktopB64}`,
      mobileDataUrl: `data:image/png;base64,${mobileB64}`,
      costUSD,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "שגיאה לא ידועה ביצירת הבאנר";
    console.error("[hero/compose] error:", err);
    const status =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
