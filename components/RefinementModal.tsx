"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

export type Quality = "low" | "medium" | "high" | "auto";

export type RefinementJobInfo = {
  id: string;
  fileName: string;
  originalUrl: string; // preview URL של המקור (ObjectURL)
  resultDataUrl: string; // התוצאה הנוכחית (data:image/png;base64,...)
};

type Props = {
  job: RefinementJobInfo | null;
  defaultQuality: Quality;
  onClose: () => void;
  onSubmit: (args: {
    refinement: string;
    quality: Quality;
    mask?: Blob | null;
  }) => Promise<void>;
};

const QUICK_TIPS = [
  "הטקסט בעברית בתווית/מדבקה מעוות – שמור עליו בדיוק כמו במקור",
  "המוצר נראה גדול מדי – הקטן אותו ב-20% והשאר יותר רווח לבן סביב",
  "הצבע של המוצר יצא חיוור מדי – הפוך אותו לרווי יותר כמו במקור",
  "הצל מתחת למוצר חזק מדי – עשה אותו עדין ורך הרבה יותר",
  "ה-logo / תווית מטושטש – הגדל את החדות שלו",
  "יש פיקסלים אפורים ברקע – נקה הכל ללבן מוחלט #FFFFFF",
];

export default function RefinementModal({
  job,
  defaultQuality,
  onClose,
  onSubmit,
}: Props) {
  const [refinement, setRefinement] = useState("");
  const [quality, setQuality] = useState<Quality>(defaultQuality);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- מצב מסכה ---
  const [maskEnabled, setMaskEnabled] = useState(false);
  const [brushSize, setBrushSize] = useState(60); // פיקסלים בקואורדינטות הקנבס
  const [hasPainted, setHasPainted] = useState(false);
  const [paintedPercent, setPaintedPercent] = useState(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // אתחול כשפותחים מודאל חדש
  useEffect(() => {
    if (job) {
      setRefinement("");
      setQuality(defaultQuality);
      setError(null);
      setMaskEnabled(false);
      setHasPainted(false);
      setPaintedPercent(0);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [job, defaultQuality]);

  // סגירה ב-Esc
  useEffect(() => {
    if (!job) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job, onClose, submitting]);

  // כשהתמונה נטענת – מאתחל את הקנבס בגודל הטבעי שלה
  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImgSize({ w, h });
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, w, h);
    }
    setHasPainted(false);
    setPaintedPercent(0);
  };

  // המרת קואורדינטה של pointer לקואורדינטה בקנבס
  const toCanvasCoord = (clientX: number, clientY: number) => {
    const wrap = wrapperRef.current;
    if (!wrap || !imgSize) return null;
    const rect = wrap.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * imgSize.w;
    const y = ((clientY - rect.top) / rect.height) * imgSize.h;
    return { x, y };
  };

  const updatePaintedPercent = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // דגימה מהירה – מסתכלים על 1% מהפיקסלים בלבד כדי לא לחנוק את ה-UI
    const sampleSize = 64;
    const tmp = document.createElement("canvas");
    tmp.width = sampleSize;
    tmp.height = sampleSize;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.drawImage(canvas, 0, 0, sampleSize, sampleSize);
    const data = tctx.getImageData(0, 0, sampleSize, sampleSize).data;
    let painted = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4) {
      total++;
      if (data[i] > 0) painted++;
    }
    setPaintedPercent(total > 0 ? Math.round((painted / total) * 100) : 0);
  }, []);

  const drawDot = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(239, 68, 68, 0.55)"; // אדום שקוף כדי לראות את התמונה
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  // ציור קו רציף בין שתי נקודות (כדי שתנועה מהירה לא תייצר נקודות מרוחקות)
  const drawLineSegment = (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "rgba(239, 68, 68, 0.55)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!maskEnabled || submitting) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = toCanvasCoord(e.clientX, e.clientY);
    if (!p) return;
    drawDot(p.x, p.y);
    lastPointRef.current = p;
    setHasPainted(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toCanvasCoord(e.clientX, e.clientY);
    if (p) setCursorPos({ x: e.clientX, y: e.clientY });
    if (!drawingRef.current || !maskEnabled || submitting) return;
    if (!p) return;
    if (lastPointRef.current) {
      drawLineSegment(lastPointRef.current, p);
    } else {
      drawDot(p.x, p.y);
    }
    lastPointRef.current = p;
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    updatePaintedPercent();
  };

  const clearMask = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasPainted(false);
    setPaintedPercent(0);
  };

  // יצירת המסכה לשליחה ל-API
  // OpenAI: פיקסלים שקופים (alpha=0) = איפה לערוך; אטומים = להשאיר
  const generateMaskBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const src = overlayCanvasRef.current;
      if (!src || !hasPainted || !imgSize) {
        resolve(null);
        return;
      }
      const out = document.createElement("canvas");
      out.width = imgSize.w;
      out.height = imgSize.h;
      const ctx = out.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      // התחל עם תמונה לבנה אטומה (= לא לערוך כלום)
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(0, 0, imgSize.w, imgSize.h);
      // קרא את הפיקסלים הצבועים
      const srcCtx = src.getContext("2d");
      if (!srcCtx) {
        resolve(null);
        return;
      }
      const srcData = srcCtx.getImageData(0, 0, imgSize.w, imgSize.h);
      const outData = ctx.getImageData(0, 0, imgSize.w, imgSize.h);
      // בכל מקום שהאלפא במקור > 0 → באאוטפוט נקבע אלפא 0 (= לערוך כאן)
      for (let i = 3; i < srcData.data.length; i += 4) {
        if (srcData.data[i] > 0) {
          outData.data[i] = 0;
        }
      }
      ctx.putImageData(outData, 0, 0);
      out.toBlob((blob) => resolve(blob), "image/png");
    });
  };

  if (!job) return null;

  const handleSubmit = async () => {
    if (refinement.trim().length < 3) {
      setError("כתוב הסבר קצר על מה לתקן (לפחות כמה מילים)");
      return;
    }
    if (maskEnabled && !hasPainted) {
      setError(
        "הפעלת מצב סימון אך לא סימנת כלום. צבע על האזור שצריך תיקון או כבה את מצב הסימון."
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const mask = maskEnabled ? await generateMaskBlob() : null;
      await onSubmit({ refinement: refinement.trim(), quality, mask });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
      setSubmitting(false);
    }
  };

  // גודל המברשת המוצג בקאסור (נצטרך לפי יחס תצוגה)
  const brushDisplaySize = (() => {
    const wrap = wrapperRef.current;
    if (!wrap || !imgSize) return brushSize;
    const rect = wrap.getBoundingClientRect();
    return (brushSize / imgSize.w) * rect.width;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="relative max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* כותרת */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">תיקון תמונה</h3>
              <p
                className="max-w-[400px] truncate text-xs text-slate-500"
                title={job.fileName}
              >
                {job.fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* תצוגת תמונות זו לצד זו */}
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* מקור */}
            <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
              <p className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                מקור (תמיד יישאר ברפרנס)
              </p>
              <div className="aspect-square overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={job.originalUrl}
                  alt="original"
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            {/* תוצאה נוכחית – עם קנבס לציור */}
            <div className="rounded-xl bg-emerald-50 p-2 ring-1 ring-emerald-200">
              <p className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                תוצאה נוכחית{" "}
                {maskEnabled
                  ? `• מצב סימון פעיל${
                      hasPainted ? ` (~${paintedPercent}% מהתמונה)` : ""
                    }`
                  : "(תתוקן)"}
              </p>
              <div
                ref={wrapperRef}
                className={clsx(
                  "relative aspect-square overflow-hidden rounded-lg bg-white ring-1",
                  maskEnabled
                    ? "cursor-none ring-2 ring-rose-400 select-none"
                    : "ring-emerald-200"
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => {
                  setCursorPos(null);
                  onPointerUp();
                }}
                style={{ touchAction: maskEnabled ? "none" : "auto" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={job.resultDataUrl}
                  alt="current result"
                  onLoad={handleImgLoad}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                  draggable={false}
                />
                <canvas
                  ref={overlayCanvasRef}
                  className={clsx(
                    "pointer-events-none absolute inset-0 h-full w-full object-contain",
                    maskEnabled ? "opacity-100" : "opacity-0"
                  )}
                />
                {/* תצוגת מברשת ליד הקאסור */}
                {maskEnabled && cursorPos && wrapperRef.current && (
                  <div
                    className="pointer-events-none absolute rounded-full border-2 border-rose-500 bg-rose-500/10 shadow"
                    style={{
                      width: brushDisplaySize * 2,
                      height: brushDisplaySize * 2,
                      left:
                        cursorPos.x -
                        wrapperRef.current.getBoundingClientRect().left -
                        brushDisplaySize,
                      top:
                        cursorPos.y -
                        wrapperRef.current.getBoundingClientRect().top -
                        brushDisplaySize,
                    }}
                  />
                )}
              </div>

              {/* פס כלי המסכה */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 ring-1 ring-emerald-200">
                <button
                  type="button"
                  onClick={() => setMaskEnabled((v) => !v)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
                    maskEnabled
                      ? "bg-rose-600 text-white shadow"
                      : "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                  )}
                  disabled={submitting}
                  title={
                    maskEnabled
                      ? "כבה את מצב סימון – יחזיר לתיקון של כל התמונה"
                      : "צבע על האזור הספציפי שאתה רוצה לתקן"
                  }
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                  {maskEnabled ? "סימון פעיל" : "סמן אזור לתיקון"}
                </button>

                {maskEnabled && (
                  <>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      גודל מברשת
                      <input
                        type="range"
                        min={10}
                        max={200}
                        value={brushSize}
                        onChange={(e) =>
                          setBrushSize(Number(e.target.value) || 60)
                        }
                        disabled={submitting}
                        className="w-24 accent-rose-500"
                      />
                      <span className="w-7 text-center font-mono">
                        {brushSize}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={clearMask}
                      disabled={!hasPainted || submitting}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-40"
                    >
                      נקה סימון
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* הסבר */}
          <div className="mb-3 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-900 ring-1 ring-blue-200">
            {maskEnabled ? (
              <>
                <b>מצב סימון פעיל:</b> צבע (גרור) על האזור הספציפי בתמונה שצריך
                תיקון. רק האזור הצבוע יישתנה – כל השאר יישאר זהה ב-100%. שאר
                התמונה לא תיגע.
              </>
            ) : (
              <>
                כתוב <b>בדיוק</b> מה לתקן. המודל יראה גם את המקור וגם את התוצאה
                הנוכחית. אם רוצים תיקון רק לאזור מסוים – לחץ "סמן אזור לתיקון"
                למעלה.
              </>
            )}
          </div>

          {/* טקסטריה */}
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
            מה לתקן?
          </label>
          <textarea
            ref={textareaRef}
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            placeholder={
              maskEnabled
                ? "באזור שסימנתי: שמור על הטקסט בעברית בדיוק כמו בתמונה המקורית..."
                : "לדוגמה: התווית הצהובה עם הטקסט בעברית יצאה מטושטשת ולא קריאה – העתק את הטקסט מהתמונה המקורית בדיוק..."
            }
            rows={3}
            disabled={submitting}
            className="w-full resize-y rounded-xl bg-white px-3 py-2.5 text-sm leading-relaxed ring-1 ring-slate-300 transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />

          {/* טיפים מהירים */}
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold text-slate-500">
              טיפים מהירים – לחץ כדי להוסיף:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TIPS.map((tip, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setRefinement((prev) =>
                      prev.trim().length > 0
                        ? `${prev.trim()}\n• ${tip}`
                        : `• ${tip}`
                    )
                  }
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-700 transition hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                >
                  + {tip}
                </button>
              ))}
            </div>
          </div>

          {/* בחירת איכות */}
          <div className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  איכות לתיקון
                </p>
                <p className="text-[10px] text-slate-500">
                  איכות גבוהה יותר → תוצאה מדויקת יותר, אך עלות גבוהה יותר
                </p>
              </div>
              <div className="flex rounded-lg bg-white ring-1 ring-slate-200">
                {(["low", "medium", "high", "auto"] as Quality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={submitting}
                    onClick={() => setQuality(q)}
                    className={clsx(
                      "px-3 py-1.5 text-xs font-semibold transition first:rounded-r-lg last:rounded-l-lg",
                      quality === q
                        ? "bg-emerald-600 text-white shadow"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    {q === "low"
                      ? "נמוך"
                      : q === "medium"
                        ? "בינוני"
                        : q === "high"
                          ? "גבוה"
                          : "אוטו'"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          {/* כפתורי פעולה */}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || refinement.trim().length < 3}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? (
                <>
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
                  מתקן...
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                  {maskEnabled && hasPainted
                    ? "תקן את האזור המסומן"
                    : "הפעל תיקון"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
