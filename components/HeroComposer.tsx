"use client";

// HeroComposer – יצירת באנר Hero חדש מאפס.
// מובנה ב-4 שלבים:
// 1. Brand DNA – חילוץ אוטומטי / רענון של פרופיל המותג מהאתר.
// 2. בחירת מוצרים – פיק מהקטלוג של החנות (Admin API).
// 3. Brief – כותרת, סאב, CTA, mood, custom notes.
// 4. צור & החלף – מפיק desktop+mobile, מציג preview, מאפשר להחליף סלייד קיים.

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  type ShopifyConnection,
  type ShopifyProduct,
  getConnection,
  listProducts,
} from "@/lib/shopify-client";
import {
  type BrandDna,
  type CopySuggestion,
  type HeroBrief,
  type HeroQuality,
  composeHero,
  extractBrandDna,
  loadBrandDna,
  saveBrandDna,
  suggestHeroCopy,
} from "@/lib/brand-dna";
import {
  type HeroSection,
  type HeroSlide,
  type PushHeroMode,
  pushHero,
  type HeroScanResult,
} from "@/lib/shopify-theme";
import {
  GOOGLE_FONTS,
  ensureGoogleFontsLoaded,
  isFontSuitableFor,
  type GoogleFont,
} from "@/lib/google-fonts";
import {
  estimateCostPerImageUSD,
  fmtILS,
  fmtUSD,
  usdToIls,
} from "@/lib/pricing";
import {
  composeImageWithText,
  type OverlayConfig,
  type TextSide,
} from "@/lib/text-overlay";

type Step = "dna" | "products" | "brief" | "review";

type MoodOption = {
  v: NonNullable<HeroBrief["mood"]>;
  label: string;
  desc: string;
  /** רקע התצוגה הדמה (CSS) */
  bg: string;
  /** צבע הטקסט */
  textColor: string;
  /** צבע הכפתור בדמה */
  ctaBg: string;
  ctaText: string;
  /** פונט לתצוגה */
  fontFamily: string;
  /** משקל לכותרת */
  headlineWeight: number;
  /** דקורציה ויזואלית בתוך התצוגה (CSS overlay) */
  decoration?: string;
};

const MOOD_OPTIONS: MoodOption[] = [
  {
    v: "premium",
    label: "פרימיום",
    desc: "מגזיני, נקי, פרופורציות עדינות. כמו Aesop או Net-a-Porter.",
    bg: "linear-gradient(135deg, #f5f0e8 0%, #ece4d4 100%)",
    textColor: "#1c1917",
    ctaBg: "#1c1917",
    ctaText: "#fafaf9",
    fontFamily: "'Cormorant Garamond', 'Frank Ruhl Libre', serif",
    headlineWeight: 600,
  },
  {
    v: "playful",
    label: "שובב",
    desc: "צבעוני ואנרגטי, פופים של צבע, קומפוזיציה דינמית. כמו Glossier.",
    bg: "linear-gradient(135deg, #fbcfe8 0%, #fde68a 50%, #a7f3d0 100%)",
    textColor: "#831843",
    ctaBg: "#db2777",
    ctaText: "#ffffff",
    fontFamily: "'Rubik', 'Assistant', sans-serif",
    headlineWeight: 800,
    decoration: "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.55), transparent 35%)",
  },
  {
    v: "minimalist",
    label: "מינימליסטי",
    desc: "הרבה נשימה, רקע נקי, אלמנט יחיד. כמו Muji ו-Apple.",
    bg: "#ffffff",
    textColor: "#0f172a",
    ctaBg: "#0f172a",
    ctaText: "#ffffff",
    fontFamily: "'Inter', 'Heebo', sans-serif",
    headlineWeight: 300,
    decoration: "linear-gradient(90deg, transparent 0%, transparent 60%, #f1f5f9 60%, #f1f5f9 100%)",
  },
  {
    v: "bold",
    label: "נועז",
    desc: "ניגוד חזק, טיפוגרפיה ענקית, צבעים רוויים. כמו Nike או Supreme.",
    bg: "linear-gradient(135deg, #18181b 0%, #27272a 100%)",
    textColor: "#fafafa",
    ctaBg: "#ef4444",
    ctaText: "#ffffff",
    fontFamily: "'Karantina', 'Suez One', sans-serif",
    headlineWeight: 900,
  },
  {
    v: "warm",
    label: "חמים",
    desc: "אור טבעי, גוונים אדמתיים, lifestyle. כמו Williams Sonoma.",
    bg: "linear-gradient(135deg, #fde6cc 0%, #d4a574 100%)",
    textColor: "#3f2305",
    ctaBg: "#9a3412",
    ctaText: "#fef3c7",
    fontFamily: "'Frank Ruhl Libre', 'Bellefair', serif",
    headlineWeight: 700,
    decoration: "radial-gradient(ellipse at 30% 100%, rgba(255,255,255,0.4), transparent 60%)",
  },
  {
    v: "tech",
    label: "טכנו",
    desc: "כהה, חד, גרדיאנטים, מבטא נאון. כמו Apple או Anker.",
    bg: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%)",
    textColor: "#e2e8f0",
    ctaBg: "#6366f1",
    ctaText: "#ffffff",
    fontFamily: "'Inter', 'Heebo', sans-serif",
    headlineWeight: 700,
    decoration: "radial-gradient(circle at 80% 30%, rgba(99,102,241,0.45), transparent 50%)",
  },
  {
    v: "natural",
    label: "טבעי",
    desc: "אורגני, ירוקים, מרקמי טבע. כמו The Body Shop.",
    bg: "linear-gradient(135deg, #ecfccb 0%, #84cc16 50%, #166534 100%)",
    textColor: "#14532d",
    ctaBg: "#166534",
    ctaText: "#f0fdf4",
    fontFamily: "'Frank Ruhl Libre', 'Heebo', serif",
    headlineWeight: 600,
    decoration: "radial-gradient(circle at 20% 80%, rgba(255,255,255,0.35), transparent 50%)",
  },
  {
    v: "festive",
    label: "חגיגי",
    desc: "מבצעים, אנרגיה, פתיתי קונפטי. CTA חזק.",
    bg: "linear-gradient(135deg, #fff1f2 0%, #fecaca 50%, #fde68a 100%)",
    textColor: "#991b1b",
    ctaBg: "#dc2626",
    ctaText: "#ffffff",
    fontFamily: "'Suez One', 'Secular One', sans-serif",
    headlineWeight: 800,
    decoration:
      "radial-gradient(circle at 15% 25%, #fbbf24 1px, transparent 2px), radial-gradient(circle at 85% 75%, #f87171 1px, transparent 2px), radial-gradient(circle at 50% 90%, #34d399 1px, transparent 2px)",
  },
];

/** סליידר חי לשליטה על גודל של אלמנט טקסט (כותרת/סאב/CTA). */
function SizeSlider({
  label,
  value,
  onChange,
  min = 0.5,
  max = 2,
  step = 0.05,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const pct = Math.round(value * 100);
  const isDefault = Math.abs(value - 1) < 0.001;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-700">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(Math.max(min, value - step))}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[12px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-violet-50 hover:text-violet-700"
            aria-label="הקטן"
          >
            −
          </button>
          <span
            className={clsx(
              "min-w-[42px] rounded-md px-1.5 py-0.5 text-center font-mono text-[10px]",
              isDefault
                ? "bg-slate-100 text-slate-600"
                : "bg-violet-600 text-white"
            )}
          >
            {pct}%
          </span>
          <button
            type="button"
            onClick={() => onChange(Math.min(max, value + step))}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[12px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-violet-50 hover:text-violet-700"
            aria-label="הגדל"
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-600"
      />
    </div>
  );
}

/** תצוגה דמה (mini hero) שמראה איך המוד יראה ויזואלית. */
function MoodPreview({
  option,
  selected,
  isRTL,
}: {
  option: MoodOption;
  selected: boolean;
  isRTL: boolean;
}) {
  return (
    <div
      className={clsx(
        "relative h-20 w-full overflow-hidden rounded-md ring-2 transition",
        selected ? "ring-violet-600" : "ring-transparent"
      )}
      style={{
        background: option.bg,
        direction: isRTL ? "rtl" : "ltr",
      }}
    >
      {option.decoration && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: option.decoration }}
        />
      )}
      <div
        className={clsx(
          "absolute inset-0 flex flex-col justify-center px-2.5",
          isRTL ? "items-end text-right" : "items-start text-left"
        )}
      >
        <div
          className="leading-tight"
          style={{
            color: option.textColor,
            fontFamily: option.fontFamily,
            fontWeight: option.headlineWeight,
            fontSize: "0.75rem",
          }}
        >
          {isRTL ? "כותרת ראשית" : "Headline"}
        </div>
        <div
          className="opacity-80"
          style={{
            color: option.textColor,
            fontFamily: option.fontFamily,
            fontSize: "0.55rem",
          }}
        >
          {isRTL ? "תיאור קצר" : "Subheadline"}
        </div>
        <div
          className="mt-1 rounded-sm px-1.5 py-0.5"
          style={{
            background: option.ctaBg,
            color: option.ctaText,
            fontFamily: option.fontFamily,
            fontSize: "0.55rem",
            fontWeight: 700,
          }}
        >
          {isRTL ? "לרכישה" : "Shop"}
        </div>
      </div>
    </div>
  );
}

export default function HeroComposer({
  scan,
  scanning,
  onRequestScan,
  onAfterReplace,
}: {
  /** ה-scan של ה-Hero הנוכחי (כדי לאפשר החלפה לתוך סלייד קיים) */
  scan: HeroScanResult | null;
  /** האם הסריקה רצה כרגע */
  scanning?: boolean;
  /** קולבק לסריקה ידנית של עמוד הבית */
  onRequestScan?: () => void;
  /** קולבק שנקרא אחרי החלפה מוצלחת – ל-HeroPanel לבצע re-scan */
  onAfterReplace?: () => void;
}) {
  const [conn, setConn] = useState<ShopifyConnection | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [step, setStep] = useState<Step>("dna");

  // --- Brand DNA ---
  const [dna, setDna] = useState<BrandDna | null>(null);
  const [dnaLoading, setDnaLoading] = useState(false);
  const [dnaError, setDnaError] = useState<string | null>(null);

  // --- Products ---
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<
    Set<number | string>
  >(new Set());

  // --- Brief ---
  const [brief, setBrief] = useState<HeroBrief>({
    headline: "",
    subheadline: "",
    cta: "",
    mood: "premium",
    customNotes: "",
    fonts: { headline: undefined, body: undefined },
  });
  const [quality, setQuality] = useState<HeroQuality>("high");

  // --- Generation result ---
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  // raw = פלט המודל בלי טקסט (תמונה נקייה)
  const [rawComposed, setRawComposed] = useState<{
    desktopDataUrl: string;
    mobileDataUrl: string;
    costUSD?: number;
  } | null>(null);
  // composed = אחרי overlay של הטקסט בצד הלקוח. זה מה שדוחפים לאתר.
  const [composed, setComposed] = useState<{
    desktopDataUrl: string;
    mobileDataUrl: string;
    costUSD?: number;
  } | null>(null);
  const [overlayingText, setOverlayingText] = useState(false);

  // הגדרות ה-overlay (מה שנשלט מהמשתמש במסך התצוגה)
  const [textSide, setTextSide] = useState<"right" | "left" | "center">(
    "right"
  );
  const [verticalShift, setVerticalShift] = useState(0);
  const [textColorMode, setTextColorMode] = useState<"auto" | "white" | "dark">(
    "auto"
  );
  const [ctaBgColor, setCtaBgColor] = useState<string>("");
  const [textShadow, setTextShadow] = useState(true);
  // מקדמי גודל חיים לכל אחד מהשלושה (1 = ברירת מחדל)
  const [headlineScale, setHeadlineScale] = useState(1);
  const [subScale, setSubScale] = useState(1);
  const [ctaScale, setCtaScale] = useState(1);

  // --- Push to store ---
  const [pushMode, setPushMode] = useState<PushHeroMode>("replace");
  const [targetSlideKey, setTargetSlideKey] = useState<string | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState(false);

  // --- hydrate connection + cached DNA ---
  useEffect(() => {
    setHydrated(true);
    const c = getConnection();
    setConn(c);
    if (c) {
      const cached = loadBrandDna(c.shop);
      if (cached) setDna(cached);
    }
  }, []);

  const runDnaScan = useCallback(async () => {
    if (!conn) return;
    setDnaLoading(true);
    setDnaError(null);
    try {
      const res = await extractBrandDna(conn.shop);
      setDna(res);
      saveBrandDna(res);
    } catch (e: unknown) {
      setDnaError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setDnaLoading(false);
    }
  }, [conn]);

  // טעינת מוצרים (lazy בשלב Products)
  const loadProductsList = useCallback(async () => {
    if (!conn) return;
    setProductsLoading(true);
    setProductsError(null);
    try {
      const res = await listProducts(conn, { fetchAll: true });
      setProducts(res.products);
    } catch (e: unknown) {
      setProductsError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setProductsLoading(false);
    }
  }, [conn]);

  useEffect(() => {
    if (step === "products" && conn && products.length === 0 && !productsLoading) {
      loadProductsList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => p.title.toLowerCase().includes(q));
  }, [products, productSearch]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedProductIds.has(p.id)),
    [products, selectedProductIds]
  );

  const toggleProduct = (id: number | string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= 5) return prev;
      else next.add(id);
      return next;
    });
  };

  const handleCompose = async () => {
    if (!dna) return;
    if (selectedProducts.length === 0) return;
    setComposing(true);
    setComposeError(null);
    setComposed(null);
    try {
      const productsInput = selectedProducts.map((p) => {
        const main =
          (p.featuredImageId &&
            p.images.find((i) => i.id === p.featuredImageId)) ||
          p.images[0];
        return { title: p.title, imageUrl: main?.src || "" };
      });
      if (productsInput.some((x) => !x.imageUrl)) {
        throw new Error(
          "לאחד המוצרים שנבחרו אין תמונה ראשית. הסר אותו ובחר אחר."
        );
      }
      const isRTL = dna.direction === "rtl" || dna.language === "he";
      const initialSide: TextSide = isRTL ? "right" : "left";
      setTextSide(initialSide);
      const res = await composeHero({
        brandDna: dna,
        products: productsInput,
        brief: { ...brief, textInImage: false, textSide: initialSide },
        quality,
      });
      setRawComposed(res);
      setComposed(null);
      setStep("review");
    } catch (e: unknown) {
      setComposeError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setComposing(false);
    }
  };

  // ---- Text overlay (Canvas, client-side) ----
  // ברגע שיש תמונות נקיות מהמודל או שהקונפיג השתנה – מחילים מחדש overlay.
  // התוצאה תמיד דטרמיניסטית: אותו טקסט, אותו פונט, אותם מיקומים בדיוק
  // ב-desktop וב-mobile (כל אחד בגודל שלו).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rawComposed) {
        setComposed(null);
        return;
      }
      const isRTL = !!dna && (dna.direction === "rtl" || dna.language === "he");
      const baseColors = dna?.colors || [];
      const ctaColor =
        ctaBgColor ||
        dna?.buttonColor ||
        baseColors.find((c) => c.toLowerCase() !== "#ffffff") ||
        "#0f172a";
      const textColor =
        textColorMode === "white"
          ? "#ffffff"
          : textColorMode === "dark"
          ? "#0f172a"
          : undefined; // auto

      const cfg: OverlayConfig = {
        headline: brief.headline,
        subheadline: brief.subheadline,
        cta: brief.cta,
        isRTL,
        side: textSide,
        verticalShift,
        headlineFont: brief.fonts?.headline,
        bodyFont: brief.fonts?.body || brief.fonts?.headline,
        textColor,
        ctaBgColor: ctaColor,
        ctaTextColor: "#ffffff",
        headlineWeight: 900,
        bodyWeight: 400,
        textShadow,
        headlineScale,
        subScale,
        ctaScale,
      };
      try {
        setOverlayingText(true);
        const [desktopOut, mobileOut] = await Promise.all([
          composeImageWithText(rawComposed.desktopDataUrl, cfg),
          composeImageWithText(rawComposed.mobileDataUrl, cfg),
        ]);
        if (cancelled) return;
        setComposed({
          desktopDataUrl: desktopOut,
          mobileDataUrl: mobileOut,
          costUSD: rawComposed.costUSD,
        });
      } catch (e) {
        console.warn("[hero/overlay] failed", e);
        if (!cancelled) {
          // נחזור לתמונה הנקייה אם ה-overlay נכשל
          setComposed({
            desktopDataUrl: rawComposed.desktopDataUrl,
            mobileDataUrl: rawComposed.mobileDataUrl,
            costUSD: rawComposed.costUSD,
          });
        }
      } finally {
        if (!cancelled) setOverlayingText(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    rawComposed,
    brief.headline,
    brief.subheadline,
    brief.cta,
    brief.fonts?.headline,
    brief.fonts?.body,
    textSide,
    verticalShift,
    textColorMode,
    ctaBgColor,
    textShadow,
    headlineScale,
    subScale,
    ctaScale,
    dna,
  ]);

  const heroSlides = useMemo(() => {
    if (!scan) return [] as Array<{ section: HeroSection; slide: HeroSlide }>;
    const out: Array<{ section: HeroSection; slide: HeroSlide }> = [];
    for (const sec of scan.sections) {
      for (const s of sec.slides) {
        if (s.displayedOnLive === false) continue;
        out.push({ section: sec, slide: s });
      }
    }
    return out;
  }, [scan]);

  const slideKey = (sectionId: string, slidePath: string) =>
    `${sectionId}::${slidePath}`;

  const handlePush = async () => {
    if (!conn || !composed) return;
    let sectionId: string | undefined;
    let slidePath: string | undefined;
    if (pushMode === "replace") {
      if (!targetSlideKey) return;
      [sectionId, slidePath] = targetSlideKey.split("::");
    } else {
      if (!targetSectionId) return;
      sectionId = targetSectionId;
    }
    if (!sectionId) return;

    const messages: Record<PushHeroMode, string> = {
      replace:
        "הבאנר החדש יחליף את הסלייד הנבחר (desktop + mobile אם קיים). גיבוי יישמר.",
      prepend:
        "הבאנר החדש יתווסף כסלייד ראשון בסקשן. כל הסלייד׳ים הקיימים נשמרים אחריו.",
      append:
        "הבאנר החדש יתווסף כסלייד אחרון בסקשן. כל הסלייד׳ים הקיימים נשמרים לפניו.",
      solo: "⚠️ הבאנר החדש יוצג לבד. כל הסלייד׳ים הקיימים יושבתו (לא יימחקו) כך שרק שלך יופיע. ניתן לחזור מהגיבוי.",
    };
    if (!confirm(messages[pushMode] + "\n\nלהמשיך?")) return;

    setApplying(true);
    setApplyError(null);
    setApplyDone(false);
    try {
      const ts = Date.now();
      await pushHero(conn, {
        mode: pushMode,
        sectionId,
        slidePath,
        base64: composed.desktopDataUrl,
        mobileBase64: composed.mobileDataUrl,
        filename: `photospro-composed-${sectionId}-${ts}.png`,
        mobileFilename: `photospro-composed-${sectionId}-${ts}-mobile.png`,
        heading: brief.headline,
        subheadline: brief.subheadline,
        cta: brief.cta,
        buttonLink: "/",
      });
      setApplyDone(true);
      onAfterReplace?.();
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setApplying(false);
    }
  };

  if (!hydrated) {
    return <div className="p-6 text-center text-sm text-slate-400">טוען...</div>;
  }
  if (!conn) {
    return (
      <div className="p-5">
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          התחבר ל-Shopify קודם בטאב "חיבור ישיר ל-Shopify".
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* Stepper */}
      <Stepper step={step} onChange={setStep} dna={dna} selectedCount={selectedProductIds.size} hasComposed={!!composed} />

      <div className="mt-4">
        {step === "dna" && (
          <DnaStep
            dna={dna}
            loading={dnaLoading}
            error={dnaError}
            onScan={runDnaScan}
            onUpdate={(updated) => {
              setDna(updated);
              saveBrandDna(updated);
            }}
            onContinue={() => setStep("products")}
          />
        )}
        {step === "products" && (
          <ProductsStep
            products={filteredProducts}
            allProducts={products}
            loading={productsLoading}
            error={productsError}
            search={productSearch}
            onSearchChange={setProductSearch}
            selectedIds={selectedProductIds}
            onToggle={toggleProduct}
            onClear={() => setSelectedProductIds(new Set())}
            onBack={() => setStep("dna")}
            onContinue={() => setStep("brief")}
          />
        )}
        {step === "brief" && (
          <BriefStep
            brief={brief}
            onChange={setBrief}
            quality={quality}
            onQualityChange={setQuality}
            isRTL={dna?.direction === "rtl" || dna?.language === "he"}
            language={dna?.language}
            dna={dna}
            selectedProducts={selectedProducts}
            composing={composing}
            composeError={composeError}
            onBack={() => setStep("products")}
            onCompose={handleCompose}
          />
        )}
        {step === "review" && composed && (
          <ReviewStep
            composed={composed}
            overlaying={overlayingText}
            isRTL={!!dna && (dna.direction === "rtl" || dna.language === "he")}
            brandColors={dna?.colors || []}
            textSide={textSide}
            onTextSideChange={setTextSide}
            verticalShift={verticalShift}
            onVerticalShiftChange={setVerticalShift}
            textColorMode={textColorMode}
            onTextColorModeChange={setTextColorMode}
            ctaBgColor={ctaBgColor}
            onCtaBgColorChange={setCtaBgColor}
            textShadow={textShadow}
            onTextShadowChange={setTextShadow}
            headlineScale={headlineScale}
            onHeadlineScaleChange={setHeadlineScale}
            subScale={subScale}
            onSubScaleChange={setSubScale}
            ctaScale={ctaScale}
            onCtaScaleChange={setCtaScale}
            scan={scan}
            scanning={!!scanning}
            onRequestScan={onRequestScan}
            heroSlides={heroSlides}
            pushMode={pushMode}
            onPushModeChange={setPushMode}
            targetSlideKey={targetSlideKey}
            onTargetSlideChange={setTargetSlideKey}
            targetSectionId={targetSectionId}
            onTargetSectionChange={setTargetSectionId}
            slideKey={slideKey}
            applying={applying}
            applyError={applyError}
            applyDone={applyDone}
            onApply={handlePush}
            onBack={() => setStep("brief")}
            onRegenerate={handleCompose}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Stepper
// ============================================================================

function Stepper({
  step,
  onChange,
  dna,
  selectedCount,
  hasComposed,
}: {
  step: Step;
  onChange: (s: Step) => void;
  dna: BrandDna | null;
  selectedCount: number;
  hasComposed: boolean;
}) {
  const steps: Array<{ id: Step; label: string; ready: boolean }> = [
    { id: "dna", label: "1. זיהוי מותג", ready: !!dna },
    { id: "products", label: "2. בחירת מוצרים", ready: selectedCount > 0 },
    { id: "brief", label: "3. Brief", ready: hasComposed },
    { id: "review", label: "4. תצוגה והחלפה", ready: false },
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-50 p-1.5 ring-1 ring-slate-200">
      {steps.map((s, idx) => {
        const isActive = step === s.id;
        const canGo = idx === 0 || s.ready || steps[idx - 1].ready;
        return (
          <button
            key={s.id}
            onClick={() => canGo && onChange(s.id)}
            disabled={!canGo}
            className={clsx(
              "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              isActive
                ? "bg-violet-600 text-white shadow-soft"
                : s.ready
                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                : "bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            )}
          >
            {s.ready && !isActive ? "✓ " : ""}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1: Brand DNA
// ============================================================================

const SCANNER_STAGES: Array<{ icon: string; label: string; durMs: number }> = [
  { icon: "🌐", label: "מתחבר לעמוד הבית הציבורי", durMs: 1800 },
  { icon: "📄", label: "סורק את ה-HTML ומחלץ metadata", durMs: 2200 },
  { icon: "🎨", label: "מאתר את הלוגו ותמונת השער", durMs: 2400 },
  { icon: "👁️", label: "מנתח את הלוגו עם GPT-4 Vision", durMs: 4500 },
  { icon: "🎯", label: "מחלץ את צבעי המותג האמיתיים", durMs: 3500 },
  { icon: "🧠", label: "בונה את פרופיל האישיות והעיצוב", durMs: 4000 },
  { icon: "✨", label: "מסיים — מאמת ומעדן", durMs: 2000 },
];

function ReportSection({
  icon,
  title,
  content,
  logoUrl,
}: {
  icon: string;
  title: string;
  content: string;
  logoUrl?: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3 ring-1 ring-violet-800/40 transition hover:bg-white/10">
      <div className="mb-1.5 flex items-center gap-1.5">
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt="logo"
            className="h-5 w-5 rounded bg-white object-contain p-0.5"
          />
        ) : (
          <span className="text-sm">{icon}</span>
        )}
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-violet-300">
          {title}
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-violet-50/95">{content}</p>
    </div>
  );
}

function ScannerAnimation() {
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let mounted = true;
    let acc = 0;
    SCANNER_STAGES.forEach((s, i) => {
      acc += s.durMs;
      const at = acc;
      setTimeout(() => {
        if (!mounted) return;
        setStageIdx((curr) => Math.max(curr, i + 1));
      }, at);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const totalDur = SCANNER_STAGES.reduce((s, x) => s + x.durMs, 0);
  const progress = Math.min(100, (elapsed / totalDur) * 100);

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 p-5 text-white shadow-soft">
      {/* Header עם אנימציית radar */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="h-10 w-10 rounded-full bg-violet-500/30">
            <span className="absolute inset-0 flex animate-ping items-center justify-center rounded-full bg-violet-400/40" />
            <span className="absolute inset-0 flex items-center justify-center text-lg">
              🔬
            </span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
            BRAND DNA SCANNER
          </p>
          <p className="text-sm font-semibold">סריקה עמוקה בעיבוד...</p>
        </div>
        <div className="text-left">
          <div className="font-mono text-xs text-violet-200">
            {Math.round(progress)}%
          </div>
          <div className="text-[9px] text-violet-300/70">
            ~{Math.max(1, Math.ceil((totalDur - elapsed) / 1000))}s נותרו
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-violet-900/50">
        <div
          className="h-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 transition-all duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* רשימת שלבים */}
      <div className="mt-4 space-y-1.5">
        {SCANNER_STAGES.map((s, i) => {
          const isDone = i < stageIdx;
          const isActive = i === stageIdx;
          return (
            <div
              key={i}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition",
                isActive && "bg-violet-500/20 ring-1 ring-violet-400/40",
                isDone && "opacity-60"
              )}
            >
              <div className="w-5 text-center text-base">
                {isDone ? (
                  <span className="text-emerald-400">✓</span>
                ) : isActive ? (
                  <span className="inline-block animate-spin">⟳</span>
                ) : (
                  <span className="text-violet-300/50">{s.icon}</span>
                )}
              </div>
              <span
                className={clsx(
                  "flex-1 text-[11px]",
                  isActive
                    ? "font-semibold text-white"
                    : isDone
                    ? "text-violet-200/70 line-through decoration-emerald-400/40"
                    : "text-violet-300/50"
                )}
              >
                {s.label}
              </span>
              {isActive && (
                <div className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
                    style={{ animationDelay: "200ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
                    style={{ animationDelay: "400ms" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[10px] text-violet-300/60">
        🤖 GPT-4 Vision מנתח את האתר שלך עכשיו — זמן ממוצע: 15-30 שניות
      </p>
    </div>
  );
}

function DnaStep({
  dna,
  loading,
  error,
  onScan,
  onUpdate,
  onContinue,
}: {
  dna: BrandDna | null;
  loading: boolean;
  error: string | null;
  onScan: () => void;
  onUpdate: (updated: BrandDna) => void;
  onContinue: () => void;
}) {
  const [newColor, setNewColor] = useState("#000000");
  const removeColor = (c: string) => {
    if (!dna) return;
    onUpdate({
      ...dna,
      colors: dna.colors.filter((x) => x.toLowerCase() !== c.toLowerCase()),
      buttonColor:
        dna.buttonColor?.toLowerCase() === c.toLowerCase()
          ? undefined
          : dna.buttonColor,
    });
  };
  const setPrimary = (c: string) => {
    if (!dna) return;
    const others = dna.colors.filter(
      (x) => x.toLowerCase() !== c.toLowerCase()
    );
    onUpdate({ ...dna, colors: [c, ...others] });
  };
  const setButtonColor = (c: string | undefined) => {
    if (!dna) return;
    onUpdate({ ...dna, buttonColor: c });
  };
  const addColor = (c: string) => {
    if (!dna) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
    const exists = dna.colors.some(
      (x) => x.toLowerCase() === c.toLowerCase()
    );
    if (exists) return;
    onUpdate({ ...dna, colors: [...dna.colors, c] });
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-violet-50 p-4 text-xs text-violet-900 ring-1 ring-violet-200">
        <p className="font-semibold">סריקה עמוקה של האתר שלך 🔬</p>
        <p className="mt-1 text-violet-800">
          אנחנו לא רק קוראים את ה-HTML. אנחנו מורידים את הלוגו ואת תמונת
          העמוד הראשי, מנתחים אותם דרך GPT-4 Vision, ומחלצים את ה-DNA
          האמיתי של המותג: צבעים שבאמת שייכים לך, אישיות המותג, שפה
          עיצובית, וקהל היעד. כל זה הופך לקריאייטיב מותאם.
        </p>
      </div>

      {!dna && !loading && (
        <button
          onClick={onScan}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-violet-700"
        >
          🔬 סריקה עמוקה של ה-DNA
        </button>
      )}

      {loading && <ScannerAnimation />}

      {error && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {dna && (
        <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Brand Profile
              </p>
              <h4 className="text-base font-bold text-slate-900">
                {dna.brandName || dna.shop}
              </h4>
              {dna.tagline && (
                <p className="mt-0.5 text-xs text-slate-600">{dna.tagline}</p>
              )}
            </div>
            <button
              onClick={onScan}
              className="btn-ghost !py-1 text-xs"
              disabled={loading}
            >
              סרוק שוב
            </button>
          </div>

          {/* פלטת צבעים – ניתנת לעריכה */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-600">
                פלטת צבעים{" "}
                <span className="text-[10px] font-normal text-slate-400">
                  (הראשון = ראשי, הצבעים האלה משפיעים על הרקע ועל הכפתור)
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {dna.colors.map((c, idx) => {
                const isPrimary = idx === 0;
                const isButton =
                  dna.buttonColor?.toLowerCase() === c.toLowerCase();
                return (
                  <div
                    key={c}
                    className={clsx(
                      "group relative flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] ring-1 transition",
                      isPrimary
                        ? "bg-violet-50 ring-violet-300"
                        : "bg-slate-50 ring-slate-200"
                    )}
                    title={c}
                  >
                    <span
                      className="h-4 w-4 rounded border border-slate-300"
                      style={{ background: c }}
                    />
                    <code className="font-mono">{c}</code>
                    {isPrimary && (
                      <span className="text-[9px] font-bold text-violet-700">
                        ★ ראשי
                      </span>
                    )}
                    {isButton && (
                      <span className="text-[9px] font-bold text-emerald-700">
                        CTA
                      </span>
                    )}
                    <div className="ml-1 flex items-center gap-1">
                      {!isPrimary && (
                        <button
                          type="button"
                          onClick={() => setPrimary(c)}
                          title="הפוך לראשי"
                          className="rounded text-[10px] text-slate-400 hover:text-violet-700"
                        >
                          ★
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setButtonColor(isButton ? undefined : c)
                        }
                        title={isButton ? "הסר מ-CTA" : "הגדר כצבע כפתור"}
                        className={clsx(
                          "rounded px-1 text-[9px] font-bold transition",
                          isButton
                            ? "text-emerald-700"
                            : "text-slate-400 hover:text-emerald-700"
                        )}
                      >
                        CTA
                      </button>
                      <button
                        type="button"
                        onClick={() => removeColor(c)}
                        title="מחק"
                        className="rounded px-1 text-rose-400 hover:text-rose-700"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 ring-1 ring-dashed ring-slate-300">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-5 w-7 cursor-pointer rounded border border-slate-200"
                />
                <button
                  type="button"
                  onClick={() => addColor(newColor)}
                  className="text-[10px] font-semibold text-violet-700 hover:underline"
                >
                  + הוסף
                </button>
              </div>
            </div>
            {dna.colors.length === 0 && (
              <p className="mt-1 text-[10px] text-rose-600">
                אין צבעים – הוסף לפחות צבע אחד.
              </p>
            )}
            <p className="mt-1.5 text-[10px] text-slate-500">
              💡 טיפ: אם המערכת זיהתה צבע שלא משקף את המותג שלך (לדוגמה צבע
              שמופיע באתר רק במקרה), פשוט מחק אותו. הצבע הראשון בפלטה הוא הצבע
              שהכי משפיע על הרקע של הבאנר.
            </p>
          </div>

          {dna.fonts.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-slate-600">
                פונטים
              </p>
              <div className="flex flex-wrap gap-1.5">
                {dna.fonts.map((f) => (
                  <span
                    key={f}
                    className="chip bg-slate-100 text-slate-700"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dna.vibeKeywords.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-slate-600">
                Vibe
              </p>
              <div className="flex flex-wrap gap-1.5">
                {dna.vibeKeywords.map((k) => (
                  <span
                    key={k}
                    className="chip bg-violet-100 text-violet-700"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ניתוח עמוק של AI – Brand Audit Report */}
          {dna.aiAnalyzed && (
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 text-white shadow-soft">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-violet-800/50 bg-violet-950/40 px-4 py-3">
                <span className="text-xl">🔬</span>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                    BRAND DNA REPORT
                  </p>
                  <p className="text-sm font-bold">
                    {dna.brandName || dna.shop}
                  </p>
                </div>
                <div className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                  ✓ ANALYZED
                </div>
              </div>

              <div className="space-y-3 p-4">
                {/* רשת של 4 קטעים */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {dna.logoDescription && (
                    <ReportSection
                      icon="🎨"
                      title="הלוגו"
                      logoUrl={dna.logoUrl}
                      content={dna.logoDescription}
                    />
                  )}
                  {dna.brandPersonality && (
                    <ReportSection
                      icon="🧠"
                      title="אישיות המותג"
                      content={dna.brandPersonality}
                    />
                  )}
                  {dna.designLanguage && (
                    <ReportSection
                      icon="✨"
                      title="שפה עיצובית"
                      content={dna.designLanguage}
                    />
                  )}
                  {dna.targetAudience && (
                    <ReportSection
                      icon="🎯"
                      title="קהל יעד"
                      content={dna.targetAudience}
                    />
                  )}
                </div>

                {/* פלטה ויזואלית מהזיהוי + סגנון */}
                {(dna.colors.length > 0 || dna.suggestedMood) && (
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-violet-800/40">
                    {dna.colors.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">
                          BRAND PALETTE (top {Math.min(dna.colors.length, 5)})
                        </p>
                        <div className="flex h-7 overflow-hidden rounded-md ring-1 ring-violet-700/40">
                          {dna.colors.slice(0, 5).map((c) => (
                            <div
                              key={c}
                              className="flex-1 transition hover:flex-[2]"
                              style={{ background: c }}
                              title={c}
                            />
                          ))}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {dna.colors.slice(0, 5).map((c) => (
                            <span
                              key={c}
                              className="font-mono text-[9px] text-violet-200/80"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {dna.suggestedMood && (
                      <div className="mt-2 flex items-center gap-2 border-t border-violet-800/40 pt-2">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-violet-300">
                          SUGGESTED MOOD
                        </p>
                        <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          {dna.suggestedMood}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer עם metadata */}
                <div className="flex flex-wrap items-center gap-2 border-t border-violet-800/40 pt-2 text-[9px] text-violet-300/80">
                  <span className="rounded bg-violet-500/20 px-1.5 py-0.5 font-mono">
                    GPT-4 Vision
                  </span>
                  {dna.logoUrl && <span>✓ logo detected</span>}
                  {dna.ogImageUrl && <span>✓ og:image detected</span>}
                  <span className="ml-auto opacity-60">
                    {new Date(dna.scannedAt).toLocaleString("he-IL", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {!dna.aiAnalyzed && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-800 ring-1 ring-amber-200">
              ⚠️ לא בוצע ניתוח AI עמוק (חסר OPENAI_API_KEY בשרת או שלא הצלחנו
              להוריד את הלוגו). הצבעים שמוצגים מבוססים על סריקת CSS בלבד —
              ייתכן שהם פחות מדויקים.
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            {dna.language && <span>שפה: {dna.language}</span>}
            {dna.direction && <span>כיוון: {dna.direction.toUpperCase()}</span>}
            {dna.ogImageUrl && (
              <span className="text-emerald-700">✓ תמונת ייחוס נמצאה</span>
            )}
            {dna.logoUrl && (
              <span className="text-emerald-700">✓ לוגו זוהה</span>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-violet-700"
            >
              המשך לבחירת מוצרים →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step 2: Products
// ============================================================================

function ProductsStep({
  products,
  allProducts,
  loading,
  error,
  search,
  onSearchChange,
  selectedIds,
  onToggle,
  onClear,
  onBack,
  onContinue,
}: {
  products: ShopifyProduct[];
  allProducts: ShopifyProduct[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (s: string) => void;
  selectedIds: Set<number | string>;
  onToggle: (id: number | string) => void;
  onClear: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        בחר 1-5 מוצרים שיופיעו בבאנר. אם בחרת יותר ממוצר אחד, המערכת תחבר אותם
        לקומפוזיציה אחת מאוזנת.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="חיפוש לפי שם מוצר..."
          className="flex-1 rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <span className="chip bg-slate-100 text-slate-700">
          {selectedIds.size}/5 נבחרו
        </span>
        {selectedIds.size > 0 && (
          <button onClick={onClear} className="btn-ghost !py-1 text-xs text-rose-600">
            נקה בחירה
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {loading && allProducts.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">טוען מוצרים...</div>
      ) : products.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          לא נמצאו מוצרים.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {products.map((p) => {
              const main =
                (p.featuredImageId &&
                  p.images.find((i) => i.id === p.featuredImageId)) ||
                p.images[0];
              const isSel = selectedIds.has(p.id);
              const reachedLimit = !isSel && selectedIds.size >= 5;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={reachedLimit}
                  onClick={() => onToggle(p.id)}
                  className={clsx(
                    "group relative overflow-hidden rounded-lg bg-white p-1.5 text-right ring-2 transition",
                    isSel
                      ? "ring-violet-600"
                      : reachedLimit
                      ? "ring-slate-200 opacity-40"
                      : "ring-slate-200 hover:ring-violet-300"
                  )}
                  title={p.title}
                >
                  <div className="aspect-square overflow-hidden rounded bg-slate-100">
                    {main ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={main.src}
                        alt={main.alt || p.title}
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                        אין תמונה
                      </div>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[2.4em] text-[10px] leading-tight text-slate-700">
                    {p.title}
                  </p>
                  {isSel && (
                    <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="h-3 w-3"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <button onClick={onBack} className="btn-ghost text-xs">
          ← חזור
        </button>
        <button
          onClick={onContinue}
          disabled={selectedIds.size === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
        >
          המשך ל-Brief →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: Brief
// ============================================================================

function BriefStep({
  brief,
  onChange,
  quality,
  onQualityChange,
  isRTL,
  language,
  dna,
  selectedProducts,
  composing,
  composeError,
  onBack,
  onCompose,
}: {
  brief: HeroBrief;
  onChange: (b: HeroBrief) => void;
  quality: HeroQuality;
  onQualityChange: (q: HeroQuality) => void;
  isRTL?: boolean;
  language?: string;
  dna: BrandDna | null;
  selectedProducts: ShopifyProduct[];
  composing: boolean;
  composeError: string | null;
  onBack: () => void;
  onCompose: () => void;
}) {
  const selectedCount = selectedProducts.length;
  const setField = (k: keyof HeroBrief, v: HeroBrief[keyof HeroBrief]) =>
    onChange({ ...brief, [k]: v });

  // ----- AI Copy Suggestions -----
  const [suggestions, setSuggestions] = useState<CopySuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const canSuggest = !!dna && selectedCount > 0 && !composing;

  const handleSuggest = async () => {
    if (!dna || selectedCount === 0) return;
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const list = await suggestHeroCopy({
        brandDna: dna,
        products: selectedProducts.map((p) => ({ title: p.title })),
        mood: brief.mood,
        n: 3,
      });
      setSuggestions(list);
    } catch (e) {
      setSuggestError(
        e instanceof Error ? e.message : "שגיאה בייצור הצעות"
      );
    } finally {
      setSuggestLoading(false);
    }
  };

  const applySuggestion = (s: CopySuggestion) => {
    onChange({
      ...brief,
      headline: s.headline,
      subheadline: s.subheadline,
      cta: s.cta,
    });
  };

  // עלות משוערת = desktop (1536x1024) + mobile (1024x1536) באותה איכות
  const estCost =
    estimateCostPerImageUSD("1536x1024", quality) +
    estimateCostPerImageUSD("1024x1536", quality);

  return (
    <div className="space-y-4">
      {/* Selected products + AI suggest */}
      {selectedCount > 0 && (
        <div className="rounded-xl bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-3 ring-1 ring-violet-200">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                {selectedCount}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                מוצרים נבחרים לבאנר
              </span>
            </div>
            <button
              type="button"
              onClick={handleSuggest}
              disabled={!canSuggest || suggestLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-soft transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-50"
              title="AI יציע לך כותרת, כותרת משנית ו-CTA לפי המוצרים והמותג"
            >
              {suggestLoading ? (
                <>
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  חושב...
                </>
              ) : (
                <>
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2l1.8 5.5L19 9.3l-5.2 1.8L12 16.6l-1.8-5.5L5 9.3l5.2-1.8L12 2zM5 16l.9 2.7L8.6 20l-2.7.9L5 24l-.9-3.1L1.4 20l2.7-1.3L5 16zM19 14l1.1 3 3 1.1-3 1.1L19 22l-1.1-2.8-3-1.1 3-1.1L19 14z" />
                  </svg>
                  AI מציע טקסטים
                </>
              )}
            </button>
          </div>

          {/* Product chips */}
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ direction: isRTL ? "rtl" : "ltr" }}
          >
            {selectedProducts.map((p) => {
              const main =
                (p.featuredImageId &&
                  p.images.find((i) => i.id === p.featuredImageId)) ||
                p.images[0];
              return (
                <div
                  key={p.id}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200"
                  style={{ maxWidth: 220 }}
                >
                  {main?.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={main.src}
                      alt={p.title}
                      className="h-9 w-9 rounded object-cover ring-1 ring-slate-200"
                    />
                  )}
                  <span
                    className="truncate text-[11px] font-medium text-slate-700"
                    title={p.title}
                  >
                    {p.title}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Suggestion error */}
          {suggestError && (
            <div className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700 ring-1 ring-rose-200">
              {suggestError}
            </div>
          )}

          {/* Suggestions list */}
          {suggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-violet-800">
                  ✨ {suggestions.length} הצעות מ-AI — לחץ "השתמש" כדי למלא את השדות
                </span>
                <button
                  type="button"
                  onClick={handleSuggest}
                  disabled={suggestLoading}
                  className="text-[10px] font-semibold text-violet-700 underline hover:text-violet-900 disabled:opacity-50"
                >
                  {suggestLoading ? "..." : "הצעות נוספות"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="group rounded-lg bg-white p-2.5 text-right ring-1 ring-slate-200 transition hover:bg-violet-50 hover:ring-violet-400"
                    dir={isRTL ? "rtl" : "ltr"}
                  >
                    <p className="truncate text-sm font-bold text-slate-900">
                      {s.headline}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                      {s.subheadline}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {s.cta}
                      </span>
                      <span className="text-[10px] font-semibold text-violet-700 opacity-0 transition group-hover:opacity-100">
                        השתמש ←
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state hint */}
          {suggestions.length === 0 && !suggestLoading && !suggestError && (
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              💡 לחץ "AI מציע טקסטים" כדי לקבל 3 רעיונות לכותרת + כותרת משנית +
              CTA, מבוססים על המוצרים שבחרת ועל המיתוג שזוהה.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            כותרת ראשית (Headline)
          </label>
          <input
            type="text"
            value={brief.headline || ""}
            onChange={(e) => setField("headline", e.target.value)}
            placeholder={isRTL ? "לדוגמה: קולקציית סתיו" : "e.g. New Arrivals"}
            dir={isRTL ? "rtl" : "ltr"}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            כותרת משנית (Subheadline)
          </label>
          <input
            type="text"
            value={brief.subheadline || ""}
            onChange={(e) => setField("subheadline", e.target.value)}
            placeholder={isRTL ? "30% הנחה לכל הקולקציה" : "30% off all season"}
            dir={isRTL ? "rtl" : "ltr"}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            CTA על כפתור
          </label>
          <input
            type="text"
            value={brief.cta || ""}
            onChange={(e) => setField("cta", e.target.value)}
            placeholder={isRTL ? "לרכישה" : "Shop now"}
            dir={isRTL ? "rtl" : "ltr"}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* Mood picker – ויזואלי */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">
          סגנון ויזואלי{" "}
          <span className="text-[10px] font-normal text-slate-400">
            (לחץ על כרטיס שמדבר אליך — זה מה שיכוון את המראה הכללי של הבאנר)
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MOOD_OPTIONS.map((m) => {
            const sel = brief.mood === m.v;
            return (
              <button
                key={m.v}
                type="button"
                onClick={() => setField("mood", m.v)}
                className={clsx(
                  "overflow-hidden rounded-lg ring-2 transition",
                  sel
                    ? "ring-violet-600 shadow-soft"
                    : "ring-slate-200 hover:ring-violet-300"
                )}
              >
                <MoodPreview option={m} selected={sel} isRTL={!!isRTL} />
                <div
                  className={clsx(
                    "px-2 py-1.5 text-right",
                    sel ? "bg-violet-50" : "bg-white"
                  )}
                >
                  <p
                    className={clsx(
                      "text-[11px] font-bold",
                      sel ? "text-violet-700" : "text-slate-800"
                    )}
                  >
                    {m.label}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-tight text-slate-500">
                    {m.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* פונטים – Google Fonts */}
      <FontPicker
        headline={brief.headline}
        subheadline={brief.subheadline}
        cta={brief.cta}
        isRTL={isRTL}
        language={language}
        selectedHeadlineFont={brief.fonts?.headline}
        selectedBodyFont={brief.fonts?.body}
        onChange={(headlineFont, bodyFont) =>
          onChange({
            ...brief,
            fonts: { headline: headlineFont, body: bodyFont },
          })
        }
      />

      {/* Custom notes */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">
          הוראות נוספות (אופציונלי)
        </label>
        <textarea
          value={brief.customNotes || ""}
          onChange={(e) => setField("customNotes", e.target.value)}
          rows={3}
          placeholder="לדוגמה: רקע בגוון פסטל ורוד, כל המוצרים מוטים בזווית של 15 מעלות, הוסף ענן עדין מאחור..."
          className="w-full rounded-lg bg-white px-3 py-2 text-xs leading-relaxed ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {/* Quality selector */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">
          איכות יצירה
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              {
                v: "low",
                label: "נמוכה",
                desc: "מהיר וזול, איכות פחותה לטסטים",
              },
              {
                v: "medium",
                label: "בינונית",
                desc: "איזון טוב בין איכות לעלות",
              },
              {
                v: "high",
                label: "גבוהה",
                desc: "פרודקשן רטיל, מומלץ לסופי",
              },
            ] as const
          ).map((opt) => {
            const sel = quality === opt.v;
            const c =
              estimateCostPerImageUSD("1536x1024", opt.v) +
              estimateCostPerImageUSD("1024x1536", opt.v);
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => onQualityChange(opt.v)}
                className={clsx(
                  "rounded-lg p-2 text-right ring-2 transition",
                  sel
                    ? "bg-amber-50 ring-amber-500"
                    : "bg-white ring-slate-200 hover:ring-amber-300"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {opt.label}
                  </span>
                  <span
                    className={clsx(
                      "text-[10px] font-mono",
                      sel ? "text-amber-700" : "text-slate-500"
                    )}
                  >
                    {fmtUSD(c)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500">{opt.desc}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-200">
          עלות צפויה לבאנר שלם (desktop + mobile):{" "}
          <b>{fmtUSD(estCost)}</b>{" "}
          <span className="text-amber-700">
            ({fmtILS(usdToIls(estCost))})
          </span>
        </div>
      </div>

      {composeError && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {composeError}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <button onClick={onBack} className="btn-ghost text-xs">
          ← חזור
        </button>
        <button
          onClick={onCompose}
          disabled={composing || selectedCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
        >
          {composing ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              מייצר desktop + mobile (~30 שניות)...
            </>
          ) : (
            <>✨ צור באנר ({fmtUSD(estCost)})</>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Font Picker
// ============================================================================

function FontPicker({
  headline,
  subheadline,
  cta,
  isRTL,
  language,
  selectedHeadlineFont,
  selectedBodyFont,
  onChange,
}: {
  headline?: string;
  subheadline?: string;
  cta?: string;
  isRTL?: boolean;
  language?: string;
  selectedHeadlineFont?: string;
  selectedBodyFont?: string;
  onChange: (headline: string | undefined, body: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filterCat, setFilterCat] = useState<
    "all" | "display" | "sans" | "serif" | "rounded"
  >("all");
  const [target, setTarget] = useState<"headline" | "body">("headline");

  // טוענים את כל הפונטים שמוצגים בפיקר ברגע שהוא נפתח (כדי לראות תצוגה אמיתית)
  useEffect(() => {
    if (!expanded) return;
    const eligible = GOOGLE_FONTS.filter((f) =>
      isFontSuitableFor(f, language)
    );
    ensureGoogleFontsLoaded(eligible.map((f) => f.family));
  }, [expanded, language]);

  // וידוא שהפונטים הנבחרים תמיד טעונים, גם אם הפיקר סגור
  useEffect(() => {
    const list: string[] = [];
    if (selectedHeadlineFont) list.push(selectedHeadlineFont);
    if (selectedBodyFont) list.push(selectedBodyFont);
    if (list.length) ensureGoogleFontsLoaded(list);
  }, [selectedHeadlineFont, selectedBodyFont]);

  const eligibleFonts = useMemo(
    () =>
      GOOGLE_FONTS.filter((f) => isFontSuitableFor(f, language)).filter(
        (f) => filterCat === "all" || f.category === filterCat
      ),
    [language, filterCat]
  );

  const previewHeadline = headline || (isRTL ? "כותרת לדוגמה" : "Sample Headline");
  const previewSub =
    subheadline ||
    cta ||
    (isRTL ? "טקסט לדוגמה לתת־כותרת" : "Sample subheadline text");

  const renderPreview = (font: GoogleFont, isHeadline: boolean) => (
    <div
      className="text-center"
      style={{
        fontFamily: `"${font.family}", sans-serif`,
        direction: isRTL ? "rtl" : "ltr",
      }}
    >
      <div
        className="truncate"
        style={{
          fontWeight: isHeadline
            ? font.weights.includes(900)
              ? 900
              : font.weights[font.weights.length - 1]
            : font.weights.includes(400)
            ? 400
            : font.weights[0],
          fontSize: isHeadline ? "1.05rem" : "0.75rem",
          lineHeight: 1.1,
        }}
      >
        {isHeadline ? previewHeadline : previewSub}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right"
      >
        <div>
          <p className="text-xs font-semibold text-slate-700">
            פונטים (Google Fonts)
          </p>
          <p className="text-[10px] text-slate-500">
            {selectedHeadlineFont || selectedBodyFont
              ? `כותרת: ${selectedHeadlineFont || "—"} | משנה: ${
                  selectedBodyFont || "—"
                }`
              : "ברירת מחדל אוטומטית של המודל"}
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          {/* הסבר + Target picker */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">בוחר עכשיו ל-</span>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTarget("headline")}
                className={clsx(
                  "rounded-md px-2 py-1 text-[11px] font-semibold transition",
                  target === "headline"
                    ? "bg-white text-violet-700 shadow-soft"
                    : "text-slate-600"
                )}
              >
                כותרת ראשית
              </button>
              <button
                type="button"
                onClick={() => setTarget("body")}
                className={clsx(
                  "rounded-md px-2 py-1 text-[11px] font-semibold transition",
                  target === "body"
                    ? "bg-white text-violet-700 shadow-soft"
                    : "text-slate-600"
                )}
              >
                כותרת משנה / CTA
              </button>
            </div>
            {(selectedHeadlineFont || selectedBodyFont) && (
              <button
                type="button"
                onClick={() => onChange(undefined, undefined)}
                className="ml-auto text-[11px] text-rose-600 underline-offset-2 hover:underline"
              >
                נקה בחירה
              </button>
            )}
          </div>

          {/* Filter cats */}
          <div className="flex flex-wrap gap-1">
            {(
              [
                { v: "all", l: "הכל" },
                { v: "display", l: "Display" },
                { v: "sans", l: "Sans" },
                { v: "serif", l: "Serif" },
                { v: "rounded", l: "מעוגל" },
              ] as const
            ).map((c) => (
              <button
                key={c.v}
                type="button"
                onClick={() => setFilterCat(c.v)}
                className={clsx(
                  "rounded-md px-2 py-1 text-[10px] font-semibold transition",
                  filterCat === c.v
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {c.l}
              </button>
            ))}
            {language === "he" && (
              <span className="ml-auto text-[10px] text-emerald-700">
                ✓ מציג רק פונטים עם תמיכה בעברית
              </span>
            )}
          </div>

          {/* Fonts grid */}
          <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {eligibleFonts.map((font) => {
              const isSelected =
                target === "headline"
                  ? selectedHeadlineFont === font.family
                  : selectedBodyFont === font.family;
              return (
                <button
                  key={font.family}
                  type="button"
                  onClick={() => {
                    if (target === "headline") {
                      onChange(
                        selectedHeadlineFont === font.family
                          ? undefined
                          : font.family,
                        selectedBodyFont
                      );
                    } else {
                      onChange(
                        selectedHeadlineFont,
                        selectedBodyFont === font.family
                          ? undefined
                          : font.family
                      );
                    }
                  }}
                  className={clsx(
                    "rounded-lg p-2 text-right ring-2 transition",
                    isSelected
                      ? "bg-violet-50 ring-violet-500"
                      : "bg-white ring-slate-200 hover:ring-violet-300"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-700">
                      {font.family}
                    </span>
                    <span className="chip bg-slate-100 text-[9px] text-slate-600">
                      {font.vibe}
                    </span>
                  </div>
                  {renderPreview(font, target === "headline")}
                </button>
              );
            })}
          </div>

          {/* תצוגה מקדימה משולבת של הבחירה הסופית */}
          {(selectedHeadlineFont || selectedBodyFont) && (
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                תצוגה מקדימה משולבת
              </p>
              <div
                style={{
                  direction: isRTL ? "rtl" : "ltr",
                  textAlign: isRTL ? "right" : "left",
                }}
              >
                {selectedHeadlineFont && (
                  <div
                    style={{
                      fontFamily: `"${selectedHeadlineFont}", sans-serif`,
                      fontWeight: 900,
                      fontSize: "1.5rem",
                      lineHeight: 1.1,
                    }}
                  >
                    {previewHeadline}
                  </div>
                )}
                {selectedBodyFont && (
                  <div
                    style={{
                      fontFamily: `"${selectedBodyFont}", sans-serif`,
                      fontWeight: 400,
                      fontSize: "0.9rem",
                      marginTop: "0.5rem",
                      lineHeight: 1.3,
                    }}
                  >
                    {previewSub}
                  </div>
                )}
                {selectedBodyFont && cta && (
                  <button
                    type="button"
                    style={{
                      fontFamily: `"${selectedBodyFont}", sans-serif`,
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      marginTop: "0.75rem",
                      padding: "0.5rem 1rem",
                      background: "#7c3aed",
                      color: "white",
                      borderRadius: "0.4rem",
                    }}
                  >
                    {cta}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step 4: Review & Replace
// ============================================================================

function ReviewStep({
  composed,
  overlaying,
  isRTL,
  brandColors,
  textSide,
  onTextSideChange,
  verticalShift,
  onVerticalShiftChange,
  textColorMode,
  onTextColorModeChange,
  ctaBgColor,
  onCtaBgColorChange,
  textShadow,
  onTextShadowChange,
  headlineScale,
  onHeadlineScaleChange,
  subScale,
  onSubScaleChange,
  ctaScale,
  onCtaScaleChange,
  scan,
  scanning,
  onRequestScan,
  heroSlides,
  pushMode,
  onPushModeChange,
  targetSlideKey,
  onTargetSlideChange,
  targetSectionId,
  onTargetSectionChange,
  slideKey,
  applying,
  applyError,
  applyDone,
  onApply,
  onBack,
  onRegenerate,
}: {
  composed: { desktopDataUrl: string; mobileDataUrl: string; costUSD?: number };
  overlaying: boolean;
  isRTL: boolean;
  brandColors: string[];
  textSide: TextSide;
  onTextSideChange: (s: TextSide) => void;
  verticalShift: number;
  onVerticalShiftChange: (v: number) => void;
  textColorMode: "auto" | "white" | "dark";
  onTextColorModeChange: (m: "auto" | "white" | "dark") => void;
  ctaBgColor: string;
  onCtaBgColorChange: (c: string) => void;
  textShadow: boolean;
  onTextShadowChange: (v: boolean) => void;
  headlineScale: number;
  onHeadlineScaleChange: (v: number) => void;
  subScale: number;
  onSubScaleChange: (v: number) => void;
  ctaScale: number;
  onCtaScaleChange: (v: number) => void;
  scan: HeroScanResult | null;
  scanning: boolean;
  onRequestScan?: () => void;
  heroSlides: Array<{ section: HeroSection; slide: HeroSlide }>;
  pushMode: PushHeroMode;
  onPushModeChange: (m: PushHeroMode) => void;
  targetSlideKey: string | null;
  onTargetSlideChange: (k: string | null) => void;
  targetSectionId: string | null;
  onTargetSectionChange: (id: string | null) => void;
  slideKey: (sectionId: string, slidePath: string) => string;
  applying: boolean;
  applyError: string | null;
  applyDone: boolean;
  onApply: () => void;
  onBack: () => void;
  onRegenerate: () => void;
}) {
  const downloadFile = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  // סקשנים שיכולים לתמוך בהוספת סלייד חדש (יש להם blocks)
  const sectionsWithBlocks = useMemo(() => {
    if (!scan) return [];
    return scan.sections.filter((s) => {
      const r = s.raw as { blocks?: Record<string, unknown> };
      return r.blocks && Object.keys(r.blocks).length > 0;
    });
  }, [scan]);

  // אוטו־בחירה ראשונית כשמצב משתנה
  useEffect(() => {
    if (pushMode === "replace") {
      if (!targetSlideKey && heroSlides[0]) {
        onTargetSlideChange(
          slideKey(heroSlides[0].section.id, heroSlides[0].slide.path)
        );
      }
    } else if (
      pushMode === "prepend" ||
      pushMode === "append" ||
      pushMode === "solo"
    ) {
      if (!targetSectionId && sectionsWithBlocks[0]) {
        onTargetSectionChange(sectionsWithBlocks[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushMode]);

  const scanHasSlides = !!scan && heroSlides.length > 0;
  const canPush =
    pushMode === "replace"
      ? !!targetSlideKey
      : !!targetSectionId && sectionsWithBlocks.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Desktop (16:9)
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={composed.desktopDataUrl}
            alt="Composed hero - desktop"
            className="w-full rounded-xl ring-1 ring-slate-200"
          />
          <button
            onClick={() => downloadFile(composed.desktopDataUrl, "hero-desktop.png")}
            className="mt-1 text-[10px] text-violet-700 underline"
          >
            הורד PNG
          </button>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            📱 Mobile (9:16)
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={composed.mobileDataUrl}
            alt="Composed hero - mobile"
            className="mx-auto max-h-96 rounded-xl ring-1 ring-slate-200"
          />
          <button
            onClick={() => downloadFile(composed.mobileDataUrl, "hero-mobile.png")}
            className="mt-1 block text-[10px] text-violet-700 underline"
          >
            הורד PNG
          </button>
        </div>
      </div>

      {composed.costUSD != null && (
        <p className="text-[10px] text-slate-400">
          עלות יצירה: ${composed.costUSD.toFixed(3)} (desktop + mobile)
          {overlaying && " · משלב טקסט..."}
        </p>
      )}

      {/* Text overlay controls */}
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className="mb-2 text-xs font-semibold text-slate-700">
          🎨 כיוונון הטקסט (תצוגה חיה)
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold text-slate-500">
              צד הטקסט בדסקטופ
            </label>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { v: "right" as TextSide, l: "ימין" },
                  { v: "center" as TextSide, l: "מרכז" },
                  { v: "left" as TextSide, l: "שמאל" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onTextSideChange(o.v)}
                  className={clsx(
                    "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition",
                    textSide === o.v
                      ? "bg-white text-violet-700 shadow-soft"
                      : "text-slate-600"
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[9px] text-slate-400">
              במובייל הטקסט תמיד למעלה ולמטה.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold text-slate-500">
              צבע טקסט
            </label>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { v: "auto", l: "אוטומטי" },
                  { v: "white", l: "לבן" },
                  { v: "dark", l: "כהה" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onTextColorModeChange(o.v)}
                  className={clsx(
                    "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition",
                    textColorMode === o.v
                      ? "bg-white text-violet-700 shadow-soft"
                      : "text-slate-600"
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold text-slate-500">
              הזזה אנכית
            </label>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={verticalShift}
              onChange={(e) =>
                onVerticalShiftChange(parseFloat(e.target.value))
              }
              className="w-full accent-violet-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold text-slate-500">
              צבע כפתור CTA
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="color"
                value={ctaBgColor || "#0f172a"}
                onChange={(e) => onCtaBgColorChange(e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-slate-200"
              />
              {brandColors.slice(0, 5).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onCtaBgColorChange(c)}
                  title={c}
                  className={clsx(
                    "h-6 w-6 rounded-full ring-2 transition",
                    (ctaBgColor || "").toLowerCase() === c.toLowerCase()
                      ? "ring-violet-600"
                      : "ring-slate-200"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              {ctaBgColor && (
                <button
                  type="button"
                  onClick={() => onCtaBgColorChange("")}
                  className="text-[10px] text-rose-600 underline"
                >
                  אוטומטי
                </button>
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={textShadow}
              onChange={(e) => onTextShadowChange(e.target.checked)}
              className="rounded text-violet-600"
            />
            הצללה רכה לטקסט (עוזר על רקעים בהירים/צבעוניים)
          </label>
        </div>

        {/* Live size sliders — שולטים בגודל של כל אלמנט בנפרד, עם תצוגה חיה */}
        <div className="mt-3 rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3 ring-1 ring-violet-200">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-violet-900">
              גודל הטקסט (חי)
            </span>
            <button
              type="button"
              onClick={() => {
                onHeadlineScaleChange(1);
                onSubScaleChange(1);
                onCtaScaleChange(1);
              }}
              className="text-[10px] font-semibold text-violet-700 underline hover:text-violet-900"
            >
              איפוס לברירת מחדל
            </button>
          </div>
          <div className="space-y-2.5">
            <SizeSlider
              label="כותרת ראשית"
              value={headlineScale}
              onChange={onHeadlineScaleChange}
            />
            <SizeSlider
              label="כותרת משנית"
              value={subScale}
              onChange={onSubScaleChange}
            />
            <SizeSlider
              label="כפתור CTA"
              value={ctaScale}
              onChange={onCtaScaleChange}
            />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-violet-700">
            💡 כל סליידר משנה את הגודל באופן יחסי. לחיצה על "איפוס" מחזירה הכל
            לגדלים שמותאמים לפי הפונט והרזולוציה.
          </p>
        </div>

        <p className="mt-2 text-[10px] text-emerald-700">
          ✓ הטקסט מוטמע על-ידי הדפדפן ב-Canvas — הכותרת בדיוק מה שכתבת, הפונט
          בדיוק שבחרת, וזהה לחלוטין בין דסקטופ למובייל.
        </p>
      </div>

      {/* Push to store */}
      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="mb-3 text-xs font-semibold text-slate-700">
          איך לדחוף לאתר?
        </p>

        {!scanHasSlides ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-600">
              {scanning
                ? "סורק את עמוד הבית כדי לזהות את סקשני ה-Hero..."
                : "לא זוהו עדיין סלייד׳י Hero. נסרוק את עמוד הבית עכשיו כדי שאוכל להציע לך לאיזה סקשן לדחוף."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRequestScan?.()}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
              >
                {scanning ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    סורק...
                  </>
                ) : (
                  <>🔍 סרוק את עמוד הבית עכשיו</>
                )}
              </button>
              <span className="text-[10px] text-slate-400">
                או הורד את הקבצים ידנית מלמעלה והעלה ב-Shopify Admin
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  {
                    v: "replace",
                    icon: "🔁",
                    label: "החלף סלייד קיים",
                    desc: "במקום אחת התמונות שיש כרגע",
                    available: heroSlides.length > 0,
                  },
                  {
                    v: "prepend",
                    icon: "⬆️",
                    label: "הוסף בתחילת המצגת",
                    desc: "סלייד חדש לפני כל השאר",
                    available: sectionsWithBlocks.length > 0,
                  },
                  {
                    v: "append",
                    icon: "⬇️",
                    label: "הוסף בסוף המצגת",
                    desc: "סלייד חדש אחרי כל השאר",
                    available: sectionsWithBlocks.length > 0,
                  },
                  {
                    v: "solo",
                    icon: "⭐",
                    label: "רק שלי בלייב",
                    desc: "כבה את כל השאר זמנית",
                    available: sectionsWithBlocks.length > 0,
                  },
                ] as const
              ).map((opt) => {
                const sel = pushMode === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    disabled={!opt.available}
                    onClick={() => onPushModeChange(opt.v)}
                    className={clsx(
                      "rounded-lg p-2 text-right ring-2 transition",
                      sel
                        ? "bg-emerald-600 text-white ring-emerald-600"
                        : "bg-white text-slate-700 ring-slate-200 hover:ring-emerald-300",
                      !opt.available && "opacity-40"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{opt.icon}</span>
                      <span className="text-[11px] font-bold">{opt.label}</span>
                    </div>
                    <p
                      className={clsx(
                        "mt-0.5 text-[10px]",
                        sel ? "text-white/80" : "text-slate-500"
                      )}
                    >
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* בחירת יעד לפי מצב */}
            <div className="mt-3">
              {pushMode === "replace" && (
                <>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                    איזה סלייד להחליף?
                  </label>
                  <select
                    value={targetSlideKey || ""}
                    onChange={(e) =>
                      onTargetSlideChange(e.target.value || null)
                    }
                    className="w-full rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">בחר סלייד...</option>
                    {heroSlides.map((x) => (
                      <option
                        key={slideKey(x.section.id, x.slide.path)}
                        value={slideKey(x.section.id, x.slide.path)}
                      >
                        {x.section.displayName} — סלייד{" "}
                        {x.section.slides.indexOf(x.slide) + 1}
                        {x.slide.heading
                          ? ` ("${x.slide.heading.slice(0, 30)}")`
                          : ""}
                        {x.slide.mobilePath ? " [+mobile]" : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {(pushMode === "prepend" ||
                pushMode === "append" ||
                pushMode === "solo") && (
                <>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                    לאיזה סקשן?
                  </label>
                  <select
                    value={targetSectionId || ""}
                    onChange={(e) =>
                      onTargetSectionChange(e.target.value || null)
                    }
                    className="w-full rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">בחר סקשן...</option>
                    {sectionsWithBlocks.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName} — {s.slides.length} סלייד׳ים קיימים
                      </option>
                    ))}
                  </select>
                  {pushMode === "solo" && (
                    <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900 ring-1 ring-amber-200">
                      ⚠️ במצב "רק שלי" כל הסלייד׳ים האחרים יושבתו (לא יימחקו).
                      לחזור: שחזר מהגיבוי או הפעל אותם ידנית ב-Shopify Admin →
                      Customize.
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              onClick={onApply}
              disabled={applying || !canPush || applyDone}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying
                ? "דוחף לחנות..."
                : applyDone
                ? "✓ הוחל בחנות"
                : "🚀 דחף לחנות"}
            </button>
          </>
        )}

        {applyError && (
          <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700 ring-1 ring-rose-200">
            {applyError}
          </div>
        )}
        {applyDone && (
          <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
            ✓ הוחל בחנות. גיבוי נשמר אוטומטית – אפשר לשחזר מתפריט "שחזר מגיבוי".
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <button onClick={onBack} className="btn-ghost text-xs">
          ← חזור ל-Brief
        </button>
        <button
          onClick={onRegenerate}
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          🔄 ייצר וריאציה חדשה
        </button>
      </div>
    </div>
  );
}
