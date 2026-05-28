"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  estimateBatchCostUSD,
  fmtUSD,
  fmtILS,
  usdToIls,
  type ImageSize,
  type Quality,
} from "@/lib/pricing";
import ShopifyPanel from "@/components/ShopifyPanel";
import HeroPanel from "@/components/HeroPanel";
import type { ImageSource } from "@/lib/shopify-client";

type ScanImage = { src: string; alt?: string };
type ScanProduct = {
  id: string;
  title: string;
  url?: string;
  images: ScanImage[];
};
type ScanCategory = {
  name: string;
  handle: string;
  products: ScanProduct[];
};
type ScanResult = {
  source: "shopify" | "html" | "sitemap";
  domain: string;
  categories: ScanCategory[];
  totalProducts: number;
  totalImages: number;
  notes?: string[];
};

type Props = {
  onImport: (items: Array<{ file: File; source?: ImageSource }>) => void;
  size: ImageSize;
  quality: Quality;
};

type ImporterTab = "public" | "shopify" | "hero";

function filenameFromUrl(u: string, fallback = "image.jpg"): string {
  try {
    const url = new URL(u);
    const last = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
    if (last) return last + ".jpg";
    return fallback;
  } catch {
    return fallback;
  }
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, "_").slice(0, 120) || "image.jpg";
}

export default function SiteImporter({ onImport, size, quality }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ImporterTab>("public");

  return (
    <div className="card mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-right transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-soft">
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
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold">ייבוא וניהול אתר</h3>
            <p className="text-xs text-slate-500">
              סריקת אתר ציבורי, ייבוא מ-Shopify, או עריכת דף הבית / Hero ישירות
              בחנות
            </p>
          </div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clsx(
            "h-5 w-5 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-200">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-3">
            <button
              type="button"
              onClick={() => setTab("public")}
              className={clsx(
                "relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition",
                tab === "public"
                  ? "border-slate-200 bg-white text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
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
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              סריקת אתר ציבורי
            </button>
            <button
              type="button"
              onClick={() => setTab("shopify")}
              className={clsx(
                "relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition",
                tab === "shopify"
                  ? "border-slate-200 bg-white text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4 text-emerald-600"
              >
                <path d="M15.337 2.715c-.13-.043-.564-.087-.564-.087s-.13-.087-.215-.13c-.13-.087-.347-.043-.434-.043-.087.044-2.516.781-2.516.781s-.998.304-1.561.477c-.086 0-.13.044-.173.087-.434.13-.738.217-1.084.347-.13-.087-.218-.13-.347-.217-.13-.087-.347-.087-.477-.087-.434 0-1.302.13-1.302.13s-1.518.477-1.778 1.171c-.347.911-.694 2.299-.954 3.295-.434 1.519-.911 3.298-1.041 3.732 0 .087-.043.13-.043.217 0 .087 0 .174.043.218l3.038.738-1.953 7.591 11.058 2.428c.087 0 .131-.043.218-.087.087-.087.13-.13.13-.218l3.339-15.572s-.087-.13-.174-.173c-.043-.044-.087-.044-.13-.087-.131-.044-2.299-.477-2.299-.477s-.13-.347-.347-.564c-.087-.087-.174-.13-.304-.218z" />
              </svg>
              חיבור ישיר ל-Shopify
              <span className="chip bg-emerald-100 text-emerald-700 text-[10px]">
                החזרה אוטומטית
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab("hero")}
              className={clsx(
                "relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition",
                tab === "hero"
                  ? "border-slate-200 bg-white text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 text-violet-600"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 14l4-4 4 4 6-6 4 4" />
                <circle cx="8" cy="8" r="1.5" />
              </svg>
              דף הבית / Hero
              <span className="chip bg-violet-100 text-violet-700 text-[10px]">
                חדש
              </span>
            </button>
          </div>

          {tab === "shopify" ? (
            <ShopifyPanel onImport={onImport} size={size} quality={quality} />
          ) : tab === "hero" ? (
            <HeroPanel />
          ) : (
            <PublicScanTab
              onImport={onImport}
              size={size}
              quality={quality}
            />
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// טאב סריקה ציבורית (URL-based) – הקוד הקודם כמות שהוא
// -----------------------------------------------------------------------------

function PublicScanTab({
  onImport,
  size,
  quality,
}: {
  onImport: (items: Array<{ file: File; source?: ImageSource }>) => void;
  size: ImageSize;
  quality: Quality;
}) {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [onlyFirstImagePerProduct, setOnlyFirstImagePerProduct] =
    useState(true);

  const scan = async () => {
    if (!url.trim() || scanning) return;
    setError(null);
    setResult(null);
    setSelected(new Set());
    setSearch("");
    setScanning(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `שגיאה ${res.status}`);
      setResult(data as ScanResult);
      if (data.categories?.[0]) setActiveCategory(data.categories[0].handle);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setScanning(false);
    }
  };

  const toggleSelect = (src: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  const activeCat = useMemo(
    () => result?.categories.find((c) => c.handle === activeCategory) || null,
    [result, activeCategory]
  );

  const filteredProducts = useMemo(() => {
    if (!activeCat) return [];
    if (!search.trim()) return activeCat.products;
    const q = search.trim().toLowerCase();
    return activeCat.products.filter((p) => p.title.toLowerCase().includes(q));
  }, [activeCat, search]);

  const visibleImages = useMemo(() => {
    const out: Array<{ product: ScanProduct; img: ScanImage; key: string }> = [];
    for (const p of filteredProducts) {
      const imgs = onlyFirstImagePerProduct ? p.images.slice(0, 1) : p.images;
      imgs.forEach((img, i) => {
        out.push({ product: p, img, key: `${p.id}__${i}` });
      });
    }
    return out;
  }, [filteredProducts, onlyFirstImagePerProduct]);

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const v of visibleImages) next.add(v.img.src);
    setSelected(next);
  };

  const unselectAllVisible = () => {
    const next = new Set(selected);
    for (const v of visibleImages) next.delete(v.img.src);
    setSelected(next);
  };

  const clearAllSelection = () => setSelected(new Set());

  const importSelected = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    const urls = Array.from(selected);
    setImportProgress({ done: 0, total: urls.length });

    const files: File[] = [];
    const batchSize = 5;
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (imgUrl) => {
          const r = await fetch("/api/fetch-image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: imgUrl }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.error || `HTTP ${r.status}`);
          }
          const blob = await r.blob();
          const name = safeFilename(filenameFromUrl(imgUrl));
          return new File([blob], name, { type: blob.type || "image/jpeg" });
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") files.push(r.value);
      }
      setImportProgress((p) => ({
        done: Math.min(p.done + batch.length, urls.length),
        total: p.total,
      }));
    }

    if (files.length > 0) {
      const filtered = files.filter((f) =>
        ["image/png", "image/jpeg", "image/webp"].includes(f.type)
      );
      const final = filtered.length > 0 ? filtered : files;
      onImport(final.map((file) => ({ file })));
    }
    setSelected(new Set());
    setImporting(false);
  };

  return (
    <div className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          dir="ltr"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") scan();
          }}
          placeholder="myshop.com  או  myshop.com/collections/shoes"
          className="flex-1 rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
          disabled={scanning}
        />
        <button
          onClick={scan}
          disabled={scanning || !url.trim()}
          className="btn-primary whitespace-nowrap"
        >
          {scanning ? (
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
              סורק...
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              סרוק אתר
            </>
          )}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        ✨ עובד הכי טוב על חנויות <b>Shopify</b> (קולקציות נטענות אוטומטית).
        לאתרים אחרים – הדבק כתובת של עמוד קטגוריה ספציפי או עמוד מוצר.
      </p>

      {error && (
        <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="chip bg-emerald-100 text-emerald-800">
              ✓ {result.totalProducts} מוצרים • {result.totalImages} תמונות
            </span>
            <span className="chip bg-slate-100 text-slate-700">
              מקור:{" "}
              {result.source === "shopify" ? "Shopify API" : "סריקת HTML"}
            </span>
            <span className="chip bg-slate-100 text-slate-700">
              {result.domain}
            </span>
            {result.notes?.map((n, i) => (
              <span key={i} className="chip bg-amber-50 text-amber-800">
                {n}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
            <aside className="max-h-[480px] overflow-y-auto rounded-xl bg-slate-50 p-2">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                קטגוריות
              </p>
              {result.categories.map((cat) => {
                const imgCount = cat.products.reduce(
                  (a, p) => a + p.images.length,
                  0
                );
                return (
                  <button
                    key={cat.handle}
                    onClick={() => setActiveCategory(cat.handle)}
                    className={clsx(
                      "mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition",
                      activeCategory === cat.handle
                        ? "bg-brand-600 font-semibold text-white shadow-soft"
                        : "hover:bg-white text-slate-700"
                    )}
                  >
                    <span className="truncate">{cat.name}</span>
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                        activeCategory === cat.handle
                          ? "bg-white/20"
                          : "bg-slate-200 text-slate-600"
                      )}
                    >
                      {cat.products.length}/{imgCount}
                    </span>
                  </button>
                );
              })}
            </aside>

            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">{activeCat?.name}</h4>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="חיפוש לפי שם מוצר..."
                    className="rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={onlyFirstImagePerProduct}
                      onChange={(e) =>
                        setOnlyFirstImagePerProduct(e.target.checked)
                      }
                      className="rounded accent-brand-600"
                    />
                    רק תמונה ראשית לכל מוצר
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={selectAllVisible}
                    className="btn-ghost !py-1 text-xs"
                  >
                    בחר הכל
                  </button>
                  <button
                    onClick={unselectAllVisible}
                    className="btn-ghost !py-1 text-xs"
                  >
                    בטל בחירה כאן
                  </button>
                  <button
                    onClick={clearAllSelection}
                    className="btn-ghost !py-1 text-xs text-rose-600"
                  >
                    נקה הכל
                  </button>
                </div>
              </div>

              {visibleImages.length === 0 ? (
                <div className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                  אין תמונות בקטגוריה הזאת לפי הסינון.
                </div>
              ) : (
                <div className="grid max-h-[480px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {visibleImages.map(({ product, img, key }) => {
                    const isSel = selected.has(img.src);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleSelect(img.src)}
                        className={clsx(
                          "group relative overflow-hidden rounded-xl ring-2 transition",
                          isSel
                            ? "ring-brand-600"
                            : "ring-transparent hover:ring-slate-300"
                        )}
                        title={product.title}
                      >
                        <div className="aspect-square bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.src}
                            alt={img.alt || product.title}
                            loading="lazy"
                            className="h-full w-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity =
                                "0.2";
                            }}
                          />
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1.5">
                          <p
                            className="truncate text-right text-[10px] font-medium text-white"
                            dir="auto"
                          >
                            {product.title}
                          </p>
                        </div>
                        <div
                          className={clsx(
                            "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow",
                            isSel
                              ? "bg-brand-600"
                              : "bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100"
                          )}
                        >
                          {isSel ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3.5 w-3.5"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3.5 w-3.5"
                            >
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {selected.size > 0 ? (
                <>
                  <span>
                    נבחרו <b className="text-brand-700">{selected.size}</b>{" "}
                    תמונות
                  </span>
                  <span className="chip bg-amber-50 text-amber-900 ring-1 ring-amber-200">
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
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                    עלות עיבוד משוערת:{" "}
                    {fmtUSD(estimateBatchCostUSD(selected.size, size, quality))}{" "}
                    (
                    {fmtILS(
                      usdToIls(estimateBatchCostUSD(selected.size, size, quality))
                    )}
                    )
                  </span>
                </>
              ) : (
                <span className="text-slate-500">
                  בחר תמונות לייבוא ע״י לחיצה עליהן
                </span>
              )}
            </div>
            <button
              onClick={importSelected}
              disabled={selected.size === 0 || importing}
              className="btn-primary"
            >
              {importing ? (
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
                  מייבא {importProgress.done}/{importProgress.total}
                </>
              ) : (
                <>הוסף {selected.size} תמונות לעיבוד</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
