// "Brand DNA" – פרופיל ויזואלי של החנות. נחלץ אותו פעם אחת ממילוי הדף הציבורי
// ושומרים localStorage כדי לא לחזור על זה כל פעם. נעביר אותו בכל קריאת compose
// כדי שהמודל ייצר עיצוב שמתאים לסגנון של האתר.

const STORAGE_KEY_PREFIX = "photospro:brand-dna:";

export type BrandDna = {
  /** דומיין מנורמל (myshop.myshopify.com) */
  shop: string;
  /** שם המותג כפי שהופיע ב-<title> או og:site_name */
  brandName?: string;
  /** טאגליין/תיאור מ-meta description */
  tagline?: string;
  /** "he" / "en" / "ar" וכו' */
  language?: string;
  /** "rtl" אם זוהה */
  direction?: "rtl" | "ltr";
  /** רשימת צבעים שזיהינו, ממוינים מהבולט לפחות בולט. hex (#rrggbb) */
  colors: string[];
  /** הצבע הראשי לכפתורים אם זוהה */
  buttonColor?: string;
  /** רשימת font families שזוהו (בעיקר מ-Google Fonts links) */
  fonts: string[];
  /** URL של og:image – ישמש כתמונת רפרנס למודל */
  ogImageUrl?: string;
  /** URL של לוגו אם זוהה */
  logoUrl?: string;
  /** URL של favicon */
  faviconUrl?: string;
  /** vibe מילולי שזיהינו ע"פ ההיוריסטיקות */
  vibeKeywords: string[];
  /** ניתוח עמוק של AI – זמין כש-OPENAI_API_KEY מוגדר */
  logoDescription?: string;
  brandPersonality?: string;
  designLanguage?: string;
  targetAudience?: string;
  /** Mood מומלץ אוטומטית לפי הניתוח */
  suggestedMood?:
    | "premium"
    | "playful"
    | "minimalist"
    | "bold"
    | "warm"
    | "tech"
    | "natural"
    | "festive";
  /** האם בוצע ניתוח AI (false = רק סריקת HTML) */
  aiAnalyzed?: boolean;
  /** מתי בוצע החילוץ */
  scannedAt: number;
};

export function storageKey(shop: string): string {
  return STORAGE_KEY_PREFIX + shop;
}

export function loadBrandDna(shop: string): BrandDna | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(shop));
    if (!raw) return null;
    return JSON.parse(raw) as BrandDna;
  } catch {
    return null;
  }
}

export function saveBrandDna(dna: BrandDna): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(dna.shop), JSON.stringify(dna));
}

export function clearBrandDna(shop: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(shop));
}

// ---------- API ----------

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
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

/** מחלץ DNA מהאתר הציבורי. אין צורך ב-token. */
export async function extractBrandDna(shop: string): Promise<BrandDna> {
  return postJson<BrandDna>("/api/brand-dna", { shop });
}

// ---------- Hero composition ----------

export type HeroBrief = {
  /** טקסט ראשי שיופיע על הבאנר (לדוגמה "קולקציית סתיו") */
  headline?: string;
  /** טקסט משני (לדוגמה "30% הנחה לכל הקולקציה") */
  subheadline?: string;
  /** כיתוב על כפתור CTA (לדוגמה "לרכישה") */
  cta?: string;
  /** mood/vibe נבחר מהמשתמש */
  mood?:
    | "premium"
    | "playful"
    | "minimalist"
    | "bold"
    | "warm"
    | "tech"
    | "natural"
    | "festive";
  /** טקסט פרומפט חופשי שיוסף לפרומפט הסופי */
  customNotes?: string;
  /**
   * פונטים נבחרים מ-Google Fonts.
   * המודל לא יכול להטעין פונט קונקרטי, אבל תיאור מפורט שלו ב-prompt
   * (אופי הצורות, משקל, פרופורציות) מנחה אותו לסגנון דומה מאוד.
   */
  fonts?: {
    /** פונט לכותרת – display / headline */
    headline?: string;
    /** פונט לכותרת המשנית + CTA */
    body?: string;
  };
  /**
   * האם המודל ירנדר את הטקסט בתוך התמונה (legacy, לא מומלץ – המודל
   * מעוות אותיות בעברית). ברירת מחדל: false → המודל מייצר תמונה נקייה
   * והטקסט מוטמע ב-Canvas בצד הלקוח.
   */
  textInImage?: boolean;
  /** באיזה צד הטקסט יהיה. ברירת מחדל לפי כיוון השפה. */
  textSide?: "right" | "left" | "center";
};

export type HeroQuality = "low" | "medium" | "high";

export type ComposeProductInput = {
  title: string;
  imageUrl: string;
};

export type ComposeResult = {
  desktopDataUrl: string;
  mobileDataUrl: string;
  costUSD?: number;
};

// ---------- AI Copy Suggestions ----------

export type CopySuggestion = {
  headline: string;
  subheadline: string;
  cta: string;
};

export async function suggestHeroCopy(args: {
  brandDna: BrandDna;
  products: Array<{ title: string }>;
  mood?: string;
  n?: number;
}): Promise<CopySuggestion[]> {
  const res = await fetch("/api/hero/suggest-copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await res.json()) as {
    suggestions?: CopySuggestion[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data.suggestions || [];
}

export async function composeHero(args: {
  brandDna: BrandDna;
  products: ComposeProductInput[];
  brief: HeroBrief;
  quality?: HeroQuality;
}): Promise<ComposeResult> {
  const res = await fetch("/api/hero/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      brandDna: args.brandDna,
      products: args.products,
      brief: args.brief,
      quality: args.quality || "high",
    }),
  });
  const data = (await res.json()) as ComposeResult & { error?: string };
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
