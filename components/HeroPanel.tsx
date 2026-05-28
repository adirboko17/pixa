"use client";

// פאנל ניהול ה-Hero של חנות Shopify מחוברת.
// סורק את עמוד הבית של ה-theme הפעיל, מציג את כל הסקשנים שזוהו כ-hero
// (slideshow / image-banner / video / image-with-text), ומאפשר לייצר תמונה
// חדשה לכל סלייד דרך gpt-image-2 ולהחליף ישירות בחנות.
//
// וידאו (Higgsfield) – V1 stub: כפתור שמסביר שהאינטגרציה תתווסף בהמשך, אבל
// כל מבנה ה-handlers כבר מוכן לקבל וידאו במקום תמונה.

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  type ShopifyConnection,
  getConnection,
} from "@/lib/shopify-client";
import {
  type HeroScanResult,
  type HeroSection,
  type HeroSlide,
  prettySectionName,
  scanHero,
  replaceHeroImage,
  restoreHeroBackup,
} from "@/lib/shopify-theme";
import HeroComposer from "@/components/HeroComposer";

type Mode = "replace" | "compose";

type GenStatus = "idle" | "fetching" | "generating" | "done" | "error";
type ApplyStatus = "idle" | "applying" | "done" | "error";

type SlideState = {
  prompt: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  /** האם לייצר גם תמונת מובייל (אם הסלייד יודע על קיומה) */
  alsoMobile: boolean;
  generated?: { dataUrl: string; costUSD?: number };
  generatedMobile?: { dataUrl: string; costUSD?: number };
  genStatus: GenStatus;
  genError?: string;
  applyStatus: ApplyStatus;
  applyError?: string;
  appliedUrl?: string;
};

const DEFAULT_HERO_PROMPT = `Create a clean, premium e-commerce hero banner image (wide 16:9 format).
The image should match the visual style of a modern Shopify storefront homepage:
- Photorealistic, sharp, professional product / lifestyle photography
- Bright, soft, even studio lighting
- Leave clear empty space on one side (typically the left for RTL stores) so the theme can overlay a heading and CTA button without clutter
- No watermarks, no text overlays inside the image, no logos
- Color palette: clean and neutral (whites, soft beiges, or the brand's natural palette)
- Composition: balanced, hero-style, magazine-cover quality

Use the input image as the visual reference for the product / scene to feature.`;

function makeInitialState(slide: HeroSlide): SlideState {
  return {
    prompt: DEFAULT_HERO_PROMPT,
    // ברירת מחדל ל-hero: 1536×1024 (16:9 בערך) – מתאים לבאנר רחב.
    // אם הסלייד הוא image-with-text או רבוע, נישאר עם 1024×1024.
    size: slide.kind === "image-with-text" ? "1024x1024" : "1536x1024",
    // אם זוהתה תמונת מובייל נפרדת, ברירת מחדל: לייצר אוטומטית גם אותה
    // (1024×1536 = 9:16 לאורך, מותאם למסכי טלפון)
    alsoMobile: !!slide.mobilePath,
    genStatus: "idle",
    applyStatus: "idle",
  };
}

/**
 * מוריד את התמונה הנוכחית של הסלייד ושולח ל-/api/process עם prompt מותאם
 * ל-hero. התוצאה: data URL של PNG.
 */
async function generateHeroImage(args: {
  imageUrl: string;
  prompt: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
}): Promise<{ dataUrl: string; costUSD?: number }> {
  // 1. מורידים את התמונה הנוכחית (דרך proxy פנימי כדי לעקוף CORS)
  const fetchRes = await fetch("/api/fetch-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: args.imageUrl }),
  });
  if (!fetchRes.ok) {
    const d = await fetchRes.json().catch(() => ({}));
    throw new Error(d?.error || `שגיאה בטעינת התמונה הנוכחית (${fetchRes.status})`);
  }
  const blob = await fetchRes.blob();
  const file = new File([blob], "hero-current.jpg", {
    type: blob.type || "image/jpeg",
  });

  // 2. שולחים ל-API שלנו עם prompt מותאם
  const form = new FormData();
  form.append("image", file);
  form.append("prompt", args.prompt);
  form.append("size", args.size);
  form.append("quality", "high");
  form.append("mode", "single");
  const procRes = await fetch("/api/process", { method: "POST", body: form });
  if (!procRes.ok) {
    const d = await procRes.json().catch(() => ({}));
    throw new Error(d?.error || `שגיאה ביצירת התמונה (${procRes.status})`);
  }
  const data = (await procRes.json()) as {
    image: string;
    costUSD?: number;
  };
  return { dataUrl: data.image, costUSD: data.costUSD };
}

export default function HeroPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [conn, setConn] = useState<ShopifyConnection | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scan, setScan] = useState<HeroScanResult | null>(null);

  // state per-slide (key = slide.path)
  const [slideStates, setSlideStates] = useState<Map<string, SlideState>>(
    new Map()
  );

  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);
  const [showBackups, setShowBackups] = useState(false);

  // פילטר: הצגת רק סלייד׳ים שאומתו כמוצגים בלייב. ברירת מחדל: ON אם הצליח האימות.
  const [onlyLive, setOnlyLive] = useState(true);

  // מצב פאנל: החלפה של סלייד קיים, או יצירת באנר חדש מאפס
  const [mode, setMode] = useState<Mode>("replace");

  useEffect(() => {
    setHydrated(true);
    setConn(getConnection());
  }, []);

  const runScan = useCallback(async () => {
    if (!conn || scanning) return;
    setScanning(true);
    setScanError(null);
    setRestoreDone(false);
    try {
      const res = await scanHero(conn);
      setScan(res);
      const next = new Map<string, SlideState>();
      for (const sec of res.sections) {
        for (const slide of sec.slides) {
          next.set(slide.path, makeInitialState(slide));
        }
      }
      setSlideStates(next);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setScanning(false);
    }
  }, [conn, scanning]);

  // סריקה אוטומטית פעם אחת כשמתחברים – כך ש-"צור באנר חדש" יוכל
  // להציג רשימת סקשנים/סלייד׳ים מיד בלי שהמשתמש יצטרך ללחוץ "סרוק" קודם.
  useEffect(() => {
    if (conn && !scan && !scanning && !scanError) {
      void runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  const updateSlide = (path: string, patch: Partial<SlideState>) => {
    setSlideStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(path) || ({} as SlideState);
      next.set(path, { ...cur, ...patch });
      return next;
    });
  };

  const handleGenerate = async (slide: HeroSlide) => {
    const refUrl = slide.imageUrl || slide.mobileImageUrl;
    if (!refUrl) {
      updateSlide(slide.path, {
        genStatus: "error",
        genError:
          "לא הצלחנו לפתור את ה-URL של התמונה הנוכחית. בדוק שהטוקן שלך כולל read_files / read_themes.",
      });
      return;
    }
    const state = slideStates.get(slide.path);
    if (!state) return;
    updateSlide(slide.path, {
      genStatus: "fetching",
      genError: undefined,
      generated: undefined,
      generatedMobile: undefined,
    });
    try {
      updateSlide(slide.path, { genStatus: "generating" });
      const desktopOut = await generateHeroImage({
        imageUrl: refUrl,
        prompt: state.prompt,
        size: state.size,
      });
      // אם יש תמונת מובייל בסלייד והמשתמש רוצה לייצר גם אותה,
      // נריץ עוד בקשה במקביל בפורמט 9:16 (1024x1536).
      let mobileOut: { dataUrl: string; costUSD?: number } | undefined;
      if (state.alsoMobile && slide.mobilePath) {
        const mobileRef = slide.mobileImageUrl || slide.imageUrl!;
        try {
          mobileOut = await generateHeroImage({
            imageUrl: mobileRef,
            prompt:
              state.prompt +
              "\n\nMOBILE / PORTRAIT FORMAT: This image is for a vertical phone screen. Compose the subject so it stays clearly visible in a 9:16 vertical crop. Leave space at the top OR bottom for a heading + CTA overlay (do not put the subject in the very center).",
            size: "1024x1536",
          });
        } catch (e: unknown) {
          // אם נכשלה תמונת המובייל, נמשיך עם דסקטופ בלבד עם הודעה
          console.warn("[hero] mobile generation failed", e);
        }
      }
      updateSlide(slide.path, {
        genStatus: "done",
        generated: desktopOut,
        generatedMobile: mobileOut,
      });
    } catch (e: unknown) {
      updateSlide(slide.path, {
        genStatus: "error",
        genError: e instanceof Error ? e.message : "שגיאה",
      });
    }
  };

  const handleApply = async (sectionId: string, slide: HeroSlide) => {
    if (!conn) return;
    const state = slideStates.get(slide.path);
    if (!state?.generated) return;
    const includeMobile =
      !!state.generatedMobile && !!slide.mobilePath;
    if (
      !confirm(
        includeMobile
          ? `החלפה כפולה: תמונת ה-desktop ותמונת ה-mobile יוחלפו יחד בעמוד הבית. גיבוי אוטומטי יישמר ויהיה ניתן לשחזור. להמשיך?`
          : `התמונה החדשה תחליף את הסלייד הנוכחי ב-Hero של עמוד הבית. גיבוי אוטומטי של ה-theme יישמר ויהיה ניתן לשחזור. להמשיך?`
      )
    )
      return;
    updateSlide(slide.path, {
      applyStatus: "applying",
      applyError: undefined,
    });
    try {
      const ts = Date.now();
      const filename = `photospro-hero-${sectionId}-${ts}.png`;
      const res = await replaceHeroImage(conn, {
        sectionId,
        slidePath: slide.path,
        base64: state.generated.dataUrl,
        filename,
        alt: slide.heading || slide.alt,
        ...(includeMobile && state.generatedMobile && slide.mobilePath
          ? {
              mobileSlidePath: slide.mobilePath,
              mobileBase64: state.generatedMobile.dataUrl,
              mobileFilename: `photospro-hero-${sectionId}-${ts}-mobile.png`,
            }
          : {}),
      });
      updateSlide(slide.path, {
        applyStatus: "done",
        appliedUrl: res.newImageUrl,
      });
      // נטען מחדש את ה-scan כדי להציג את הגיבוי החדש
      runScan();
    } catch (e: unknown) {
      updateSlide(slide.path, {
        applyStatus: "error",
        applyError: e instanceof Error ? e.message : "שגיאה",
      });
    }
  };

  const handleRestoreFromKey = async (backupKey: string) => {
    if (!conn) return;
    if (
      !confirm(
        `לשחזר את עמוד הבית מהגיבוי הזה?\n${backupKey}\n\nזה יחליף את ה-templates/index.json הנוכחי בגיבוי. הסקשנים החדשים יעלמו.`
      )
    )
      return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreDone(false);
    setShowBackups(false);
    try {
      await restoreHeroBackup(conn, backupKey);
      setRestoreDone(true);
      runScan();
    } catch (e: unknown) {
      setRestoreError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setRestoring(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">טוען...</div>
    );
  }

  if (!conn) {
    return (
      <div className="p-5">
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">צריך להתחבר ראשית ל-Shopify.</p>
          <p className="mt-1 text-xs">
            עבור לטאב <b>"חיבור ישיר ל-Shopify"</b>, חבר את החנות, וחזור הנה
            כדי לסרוק את עמוד הבית.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* Mode toggle */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setMode("replace")}
          className={clsx(
            "rounded-lg px-3 py-2 text-sm font-semibold transition",
            mode === "replace"
              ? "bg-white text-violet-700 shadow-soft"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          🔁 החלף סלייד קיים
          <span className="block text-[10px] font-normal opacity-70">
            וריאציה על תמונה שכבר באתר
          </span>
        </button>
        <button
          onClick={() => setMode("compose")}
          className={clsx(
            "rounded-lg px-3 py-2 text-sm font-semibold transition",
            mode === "compose"
              ? "bg-white text-violet-700 shadow-soft"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          ✨ צור באנר חדש
          <span className="block text-[10px] font-normal opacity-70">
            מוצרים + טקסט + DNA של האתר
          </span>
        </button>
      </div>

      {mode === "compose" ? (
        <HeroComposer
          scan={scan}
          scanning={scanning}
          onRequestScan={runScan}
          onAfterReplace={runScan}
        />
      ) : (
        <ReplaceMode
          conn={conn}
          scan={scan}
          scanning={scanning}
          scanError={scanError}
          slideStates={slideStates}
          onlyLive={onlyLive}
          setOnlyLive={setOnlyLive}
          showBackups={showBackups}
          setShowBackups={setShowBackups}
          restoring={restoring}
          restoreError={restoreError}
          restoreDone={restoreDone}
          handleRestoreFromKey={handleRestoreFromKey}
          updateSlide={updateSlide}
          handleGenerate={handleGenerate}
          handleApply={handleApply}
          runScan={runScan}
        />
      )}
    </div>
  );
}

// פונקציה פנימית שמכילה את כל ה-UI של "החלף סלייד קיים" – הפרדה זו מקלה
// על תחזוקה כי שני המצבים שונים בהיגיון.
function ReplaceMode({
  conn,
  scan,
  scanning,
  scanError,
  slideStates,
  onlyLive,
  setOnlyLive,
  showBackups,
  setShowBackups,
  restoring,
  restoreError,
  restoreDone,
  handleRestoreFromKey,
  updateSlide,
  handleGenerate,
  handleApply,
  runScan,
}: {
  conn: ShopifyConnection;
  scan: HeroScanResult | null;
  scanning: boolean;
  scanError: string | null;
  slideStates: Map<string, SlideState>;
  onlyLive: boolean;
  setOnlyLive: (v: boolean) => void;
  showBackups: boolean;
  setShowBackups: (v: boolean | ((p: boolean) => boolean)) => void;
  restoring: boolean;
  restoreError: string | null;
  restoreDone: boolean;
  handleRestoreFromKey: (key: string) => void;
  updateSlide: (path: string, patch: Partial<SlideState>) => void;
  handleGenerate: (slide: HeroSlide) => void;
  handleApply: (sectionId: string, slide: HeroSlide) => void;
  runScan: () => void;
}) {
  return (
    <>
      {/* כותרת + סריקה */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-2 w-2 rounded-full bg-violet-500" />
          <span>
            דף הבית של <b className="text-violet-900">{conn.shopName || conn.shop}</b>
          </span>
          {scan?.theme && (
            <code className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
              theme: {scan.theme.name}
            </code>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scan && scan.backups.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowBackups((v) => !v)}
                disabled={restoring}
                className="btn-ghost !py-1 text-xs text-amber-700"
                title="שחזור מגיבוי קיים"
              >
                {restoring
                  ? "משחזר..."
                  : `שחזר מגיבוי (${scan.backups.length})`}
              </button>
              {showBackups && (
                <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
                  <p className="px-2 pt-1 pb-2 text-[11px] font-semibold text-slate-500">
                    בחר גיבוי לשחזור (החדש למעלה)
                  </p>
                  <div className="max-h-64 overflow-y-auto">
                    {scan.backups.map((b) => (
                      <button
                        key={b.key}
                        onClick={() => handleRestoreFromKey(b.key)}
                        className="block w-full rounded-lg px-2 py-1.5 text-right text-xs hover:bg-amber-50"
                      >
                        <div className="font-mono text-[10px] text-slate-700">
                          {b.key.replace(
                            "config/photospro-hero-backup-",
                            ""
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(b.updatedAt).toLocaleString("he-IL")}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            onClick={runScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={clsx("h-3.5 w-3.5", scanning && "animate-spin")}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {scanning ? "סורק..." : scan ? "סרוק שוב" : "סרוק את עמוד הבית"}
          </button>
        </div>
      </div>

      {scanError && (
        <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {scanError}
        </div>
      )}
      {restoreError && (
        <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          שחזור: {restoreError}
        </div>
      )}
      {restoreDone && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
          השחזור הושלם בהצלחה. עמוד הבית חזר למצב הקודם.
        </div>
      )}

      {!scan && !scanning && (
        <div className="rounded-xl bg-slate-50 p-8 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 h-10 w-10 text-slate-400"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 14l4-4 4 4 6-6 4 4" />
            <circle cx="8" cy="8" r="1.5" />
          </svg>
          <p className="text-sm font-semibold text-slate-700">
            לחץ "סרוק את עמוד הבית"
          </p>
          <p className="mt-1 text-xs text-slate-500">
            נזהה אוטומטית סקשני Hero / Slideshow / Banner / Video, ונציג כל
            סלייד עם אפשרות ליצור חדש ולהחליף.
          </p>
        </div>
      )}

      {scan?.notes?.map((n, i) => (
        <div
          key={i}
          className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200"
        >
          {n}
        </div>
      ))}

      {scan && scan.sections.length > 0 && (() => {
        // מסננים סקשנים לפי toggle "הצג רק מוצגים בלייב". סקשן יוצג רק אם
        // יש לפחות סלייד אחד שעובר את הפילטר (אחרת אין מה להציג).
        const sectionsToShow = scan.sections
          .map((sec) => {
            const filteredSlides =
              scan.liveVerified && onlyLive
                ? sec.slides.filter((s) => s.displayedOnLive !== false)
                : sec.slides;
            return { ...sec, slides: filteredSlides };
          })
          .filter((sec) => sec.slides.length > 0);

        // ספירת "מוסתרים" – כדי להראות למשתמש כמה סלייד׳ים נחסכו
        const hiddenCount = scan.sections.reduce(
          (acc, sec) =>
            acc +
            sec.slides.filter(
              (s) => scan.liveVerified && onlyLive && s.displayedOnLive === false
            ).length,
          0
        );

        return (
          <>
            {scan.liveVerified && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={onlyLive}
                    onChange={(e) => setOnlyLive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span>
                    הצג רק סלייד׳ים שמוצגים בלייב באתר{" "}
                    {hiddenCount > 0 && (
                      <span className="text-slate-500">
                        (מסונן: {hiddenCount})
                      </span>
                    )}
                  </span>
                </label>
                <span className="text-[10px] text-emerald-700">
                  ✓ אומת מול ה-HTML של עמוד הבית
                </span>
              </div>
            )}
            {!scan.liveVerified && (
              <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                לא הצלחנו לקרוא את ה-HTML של האתר החי (ייתכן שהאתר מוגן בסיסמה
                או שיש password page). מציגים את כל הסלייד׳ים מתוך ה-theme JSON
                ללא אימות. ייתכן שחלקם לא מוצגים בפועל.
              </div>
            )}

            <div className="space-y-6">
              {sectionsToShow.map((sec) => (
                <SectionCard
                  key={sec.id}
                  section={sec}
                  slideStates={slideStates}
                  onChangePrompt={(path, prompt) =>
                    updateSlide(path, { prompt })
                  }
                  onChangeSize={(path, size) => updateSlide(path, { size })}
                  onToggleMobile={(path, alsoMobile) =>
                    updateSlide(path, { alsoMobile })
                  }
                  onGenerate={handleGenerate}
                  onApply={(slide) => handleApply(sec.id, slide)}
                />
              ))}
            </div>
          </>
        );
      })()}
    </>
  );
}

function SectionCard({
  section,
  slideStates,
  onChangePrompt,
  onChangeSize,
  onToggleMobile,
  onGenerate,
  onApply,
}: {
  section: HeroSection;
  slideStates: Map<string, SlideState>;
  onChangePrompt: (path: string, prompt: string) => void;
  onChangeSize: (
    path: string,
    size: "1024x1024" | "1024x1536" | "1536x1024"
  ) => void;
  onToggleMobile: (path: string, alsoMobile: boolean) => void;
  onGenerate: (slide: HeroSlide) => void;
  onApply: (slide: HeroSlide) => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900">
            {section.displayName}
          </h4>
          <p className="text-[11px] text-slate-500">
            id: <code>{section.id}</code> • סדר: {section.order + 1} • סלייד׳ים:{" "}
            {section.slides.length}
          </p>
        </div>
        <span className="chip bg-violet-100 text-violet-700">
          {prettySectionName(section.type)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {section.slides.map((slide, idx) => {
          const state =
            slideStates.get(slide.path) ||
            ({
              prompt: DEFAULT_HERO_PROMPT,
              size: "1536x1024",
              alsoMobile: !!slide.mobilePath,
              genStatus: "idle",
              applyStatus: "idle",
            } as SlideState);
          return (
            <SlideCard
              key={slide.path}
              slide={slide}
              index={idx}
              state={state}
              onChangePrompt={(p) => onChangePrompt(slide.path, p)}
              onChangeSize={(s) => onChangeSize(slide.path, s)}
              onToggleMobile={(v) => onToggleMobile(slide.path, v)}
              onGenerate={() => onGenerate(slide)}
              onApply={() => onApply(slide)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SlideCard({
  slide,
  index,
  state,
  onChangePrompt,
  onChangeSize,
  onToggleMobile,
  onGenerate,
  onApply,
}: {
  slide: HeroSlide;
  index: number;
  state: SlideState;
  onChangePrompt: (p: string) => void;
  onChangeSize: (s: "1024x1024" | "1024x1536" | "1536x1024") => void;
  onToggleMobile: (v: boolean) => void;
  onGenerate: () => void;
  onApply: () => void;
}) {
  const [showAdv, setShowAdv] = useState(false);
  const isVideo = slide.kind === "video" || slide.hasVideo;
  const hasMobile = !!slide.mobilePath;
  const busy =
    state.genStatus === "fetching" ||
    state.genStatus === "generating" ||
    state.applyStatus === "applying";

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-white text-slate-700 ring-1 ring-slate-200">
            סלייד {index + 1}
          </span>
          {isVideo && (
            <span className="chip bg-fuchsia-100 text-fuchsia-700">וידאו</span>
          )}
          {hasMobile && (
            <span className="chip bg-sky-100 text-sky-700" title="זוהתה תמונת מובייל נפרדת">
              📱 מובייל נפרד
            </span>
          )}
          {slide.displayedOnLive === false && (
            <span
              className="chip bg-amber-100 text-amber-800"
              title="לא נמצא ב-HTML של עמוד הבית – כנראה לא מוצג כרגע"
            >
              לא בלייב
            </span>
          )}
          {slide.displayedOnLive === true && (
            <span className="chip bg-emerald-100 text-emerald-700">
              ✓ מוצג בלייב
            </span>
          )}
        </div>
        <code className="truncate text-[10px] text-slate-400" title={slide.path}>
          {slide.path.replace("sections.", "").slice(-40)}
        </code>
      </div>

      {/* Before / After – desktop ראשון, ואם יש מובייל גם הוא */}
      <div className="space-y-2">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            דסקטופ
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Preview
              label="עכשיו באתר"
              imageUrl={slide.imageUrl}
              videoBadge={isVideo}
            />
            <Preview
              label="חדש (לא הוחל)"
              imageUrl={state.generated?.dataUrl}
              loading={
                state.genStatus === "fetching" ||
                state.genStatus === "generating"
              }
              loadingText={
                state.genStatus === "fetching"
                  ? "מוריד את הנוכחית..."
                  : state.genStatus === "generating"
                  ? "מייצר תמונה..."
                  : undefined
              }
            />
          </div>
        </div>
        {hasMobile && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              📱 מובייל
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Preview
                label="עכשיו באתר"
                imageUrl={slide.mobileImageUrl}
                aspect="portrait"
              />
              <Preview
                label="חדש (לא הוחל)"
                imageUrl={state.generatedMobile?.dataUrl}
                aspect="portrait"
                loading={
                  state.alsoMobile &&
                  (state.genStatus === "fetching" ||
                    state.genStatus === "generating")
                }
                loadingText={
                  state.alsoMobile && state.genStatus === "generating"
                    ? "מייצר מובייל..."
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      {(slide.heading || slide.subheading) && (
        <div className="mt-2 rounded-lg bg-white p-2 text-xs text-slate-600 ring-1 ring-slate-200">
          {slide.heading && (
            <p>
              <b>כותרת:</b> {slide.heading}
            </p>
          )}
          {slide.subheading && (
            <p className="mt-0.5">
              <b>כיתוב:</b> {slide.subheading}
            </p>
          )}
        </div>
      )}

      {/* Prompt */}
      <div className="mt-3">
        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
          תיאור התמונה החדשה (Prompt)
        </label>
        <textarea
          value={state.prompt}
          onChange={(e) => onChangePrompt(e.target.value)}
          rows={3}
          disabled={busy}
          className="w-full rounded-lg bg-white px-2.5 py-2 text-xs leading-relaxed ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={() => setShowAdv((v) => !v)}
          className="mt-1 text-[10px] text-slate-500 underline-offset-2 hover:underline"
        >
          {showAdv ? "הסתר" : "הצג"} הגדרות מתקדמות
        </button>
        {showAdv && (
          <div className="mt-2 space-y-2 rounded-lg bg-white p-2 ring-1 ring-slate-200">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                גודל פלט (דסקטופ)
              </label>
              <div className="mt-1 flex gap-1">
                {(
                  [
                    { v: "1536x1024", l: "16:9 רחב (Hero מומלץ)" },
                    { v: "1024x1024", l: "1:1 ריבוע" },
                    { v: "1024x1536", l: "9:16 לאורך" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => onChangeSize(opt.v)}
                    className={clsx(
                      "flex-1 rounded-md px-2 py-1 text-[10px] transition",
                      state.size === opt.v
                        ? "bg-violet-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            {hasMobile && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md bg-sky-50 p-2 text-[11px] ring-1 ring-sky-200">
                <input
                  type="checkbox"
                  checked={state.alsoMobile}
                  onChange={(e) => onToggleMobile(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-sky-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-sky-900">
                  ייצר אוטומטית גם תמונת מובייל (9:16) – תוחלף יחד עם הדסקטופ
                  באותה לחיצה
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* פעולות */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onGenerate}
          disabled={busy || (!slide.imageUrl && !slide.mobileImageUrl)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-violet-700 disabled:opacity-50"
          title={
            !slide.imageUrl && !slide.mobileImageUrl
              ? "אין URL לתמונה הנוכחית – לא ניתן לייצר וריאציה"
              : "ייצור תמונה חדשה לפי ה-Prompt" +
                (state.alsoMobile && hasMobile ? " (כולל מובייל)" : "")
          }
        >
          {state.genStatus === "fetching" || state.genStatus === "generating"
            ? "מייצר..."
            : state.generated
            ? "ייצר שוב"
            : state.alsoMobile && hasMobile
            ? "צור desktop + mobile"
            : "צור תמונה חדשה"}
        </button>

        {state.generated && (
          <button
            onClick={onApply}
            disabled={busy || state.applyStatus === "done"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {state.applyStatus === "applying"
              ? "מחליף בחנות..."
              : state.applyStatus === "done"
              ? "✓ הוחלף בחנות"
              : "החלף בחנות"}
          </button>
        )}

        {/* Higgsfield video stub */}
        <button
          type="button"
          disabled
          title="חיבור ל-Higgsfield יתווסף בקרוב. כל ה-pipeline (העלאה, גיבוי, החלפה) כבר מוכן."
          className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-100 px-3 py-1.5 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200 transition disabled:opacity-70"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          צור וידאו (Higgsfield – בקרוב)
        </button>
      </div>

      {state.genError && (
        <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700 ring-1 ring-rose-200">
          {state.genError}
        </div>
      )}
      {state.applyError && (
        <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700 ring-1 ring-rose-200">
          החלפה: {state.applyError}
        </div>
      )}
      {state.applyStatus === "done" && (
        <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
          ✓ הוחל בחנות. גיבוי נשמר אוטומטית – אפשר לשחזר מהכפתור למעלה.
        </div>
      )}
      {state.generated?.costUSD != null && (
        <p className="mt-1 text-[10px] text-slate-400">
          עלות יצירה: ${state.generated.costUSD.toFixed(3)}
        </p>
      )}
    </div>
  );
}

function Preview({
  label,
  imageUrl,
  videoBadge,
  loading,
  loadingText,
  aspect = "video",
}: {
  label: string;
  imageUrl?: string;
  videoBadge?: boolean;
  loading?: boolean;
  loadingText?: string;
  aspect?: "video" | "portrait" | "square";
}) {
  const aspectClass =
    aspect === "portrait"
      ? "aspect-[9/16]"
      : aspect === "square"
      ? "aspect-square"
      : "aspect-video";
  return (
    <div className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {videoBadge && (
          <span className="text-[10px] text-fuchsia-600">▶ וידאו</span>
        )}
      </div>
      <div
        className={clsx(
          "relative flex items-center justify-center bg-slate-50",
          aspectClass
        )}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-[11px] text-slate-500">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {loadingText || "טוען..."}
          </div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[11px] text-slate-400">אין תמונה</span>
        )}
      </div>
    </div>
  );
}
