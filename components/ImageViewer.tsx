"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

export type ViewerImage = {
  originalUrl: string;
  resultUrl?: string;
  fileName: string;
  costUSD?: number;
  durationMs?: number;
};

type ViewMode = "result" | "original" | "compare";

type Props = {
  image: ViewerImage | null;
  onClose: () => void;
  initialMode?: ViewMode;
};

export default function ImageViewer({ image, onClose, initialMode }: Props) {
  const [mode, setMode] = useState<ViewMode>("result");
  const [sliderPos, setSliderPos] = useState(50);
  const [mounted, setMounted] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // נעילת גלילת הרקע + ESC לסגירה
  useEffect(() => {
    if (!image) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "1") setMode("result");
      if (e.key === "2") setMode("original");
      if (e.key === "3") setMode("compare");
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prev;
    };
  }, [image, onClose]);

  // איפוס מצב כשמשתמש סוגר/פותח חדש
  useEffect(() => {
    if (image) {
      setMode(
        initialMode ?? (image.resultUrl ? "result" : "original")
      );
      setSliderPos(50);
    }
  }, [image, initialMode]);

  if (!image || !mounted) return null;

  const hasResult = !!image.resultUrl;

  const updateSliderFromPointer = (clientX: number) => {
    if (!compareRef.current) return;
    const rect = compareRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    updateSliderFromPointer(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateSliderFromPointer(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const handleDownload = () => {
    if (!image.resultUrl) return;
    const a = document.createElement("a");
    a.href = image.resultUrl;
    const base = image.fileName.replace(/\.[^.]+$/, "");
    a.download = `${base}_white.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const TabButton = ({
    value,
    label,
    shortcut,
  }: {
    value: ViewMode;
    label: string;
    shortcut: string;
  }) => (
    <button
      onClick={() => setMode(value)}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition",
        mode === value
          ? "bg-white text-slate-900 shadow"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      )}
      title={`קיצור: ${shortcut}`}
    >
      {label}
    </button>
  );

  const imageMaxClass =
    "max-h-full max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/10";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/92 p-3 backdrop-blur-sm sm:p-5"
      style={{
        paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(80px, env(safe-area-inset-bottom, 0px))",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-[min(640px,100%)] min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-900/95 shadow-2xl ring-1 ring-white/10"
        style={{ maxHeight: "calc(100dvh - max(96px, env(safe-area-inset-bottom, 0px) + 80px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 text-white sm:gap-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
              title="סגור (Esc)"
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
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{image.fileName}</p>
              <p className="hidden text-[11px] text-white/50 sm:block">
                {hasResult ? "תוצאה מוכנה" : "תמונת מקור בלבד"}
                {typeof image.costUSD === "number" && image.costUSD > 0 && (
                  <> • ${image.costUSD.toFixed(3)}</>
                )}
                {typeof image.durationMs === "number" && (
                  <> • {(image.durationMs / 1000).toFixed(1)}s</>
                )}
              </p>
            </div>
          </div>

          {hasResult && (
            <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1">
              <TabButton value="result" label="תוצאה" shortcut="1" />
              <TabButton value="original" label="מקור" shortcut="2" />
              <TabButton value="compare" label="השוואה" shortcut="3" />
            </div>
          )}

          <div className="flex items-center gap-2">
            {hasResult && (
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
              >
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                הורד
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-4">
          {mode === "result" && hasResult && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.resultUrl}
              alt="תוצאה"
              className={imageMaxClass}
              style={{ background: "#fff" }}
            />
          )}
          {mode === "original" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.originalUrl}
              alt="מקור"
              className={imageMaxClass}
            />
          )}
          {mode === "compare" && hasResult && (
            <div className="flex h-full w-full min-h-0 items-center justify-center">
              <div
                ref={compareRef}
                dir="ltr"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="relative aspect-square max-h-full max-w-full cursor-ew-resize select-none overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
                style={{
                  background: "#fff",
                  width: "min(100%, min(480px, calc(100dvh - 15rem)))",
                  touchAction: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.originalUrl}
                  alt="מקור"
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.resultUrl}
                    alt="תוצאה"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{ background: "#fff" }}
                  />
                </div>

                <div
                  className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                  style={{
                    left: `${sliderPos}%`,
                    transform: "translateX(-1px)",
                  }}
                />

                <div
                  className="pointer-events-none absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-700 shadow-[0_4px_16px_rgba(0,0,0,0.4)] ring-2 ring-slate-200 sm:h-12 sm:w-12"
                  style={{ left: `${sliderPos}%` }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 sm:h-5 sm:w-5"
                  >
                    <polyline points="15 18 9 12 15 6" />
                    <polyline
                      points="9 18 3 12 9 6"
                      transform="translate(12 0)"
                    />
                  </svg>
                </div>

                <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                  אחרי
                </div>
                <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                  לפני
                </div>
              </div>
            </div>
          )}
        </div>

        {/* רמז ניווט תחתית */}
        <div className="hidden shrink-0 items-center justify-center gap-4 border-t border-white/10 px-4 py-2 text-[11px] text-white/40 sm:flex">
          <span>
            <kbd className="rounded bg-white/10 px-1.5 py-0.5">Esc</kbd> סגור
          </span>
          {hasResult && (
            <>
              <span>
                <kbd className="rounded bg-white/10 px-1.5 py-0.5">1</kbd>{" "}
                תוצאה
              </span>
              <span>
                <kbd className="rounded bg-white/10 px-1.5 py-0.5">2</kbd> מקור
              </span>
              <span>
                <kbd className="rounded bg-white/10 px-1.5 py-0.5">3</kbd>{" "}
                השוואה
              </span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
