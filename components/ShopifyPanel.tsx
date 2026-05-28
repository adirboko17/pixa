"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  type ImageSource,
  type ShopifyCollection,
  type ShopifyConnection,
  type ShopifyProduct,
  clearConnection,
  getConnection,
  listCollections,
  listProducts,
  normalizeShopDomain,
  saveConnection,
  validateConnection,
} from "@/lib/shopify-client";
import {
  estimateBatchCostUSD,
  fmtUSD,
  fmtILS,
  usdToIls,
  type ImageSize,
  type Quality,
} from "@/lib/pricing";
import { slugifyFilename, extensionFromUrl } from "@/lib/seo-slug";

type Props = {
  onImport: (items: Array<{ file: File; source?: ImageSource }>) => void;
  size: ImageSize;
  quality: Quality;
};

type SelectedItem = {
  imgSrc: string;
  imgId: number;
  productId: number;
  productTitle: string;
};

// pseudo-collection "כל המוצרים"
const ALL_COLLECTION: ShopifyCollection = {
  id: 0,
  handle: "__all__",
  title: "כל המוצרים",
  productsCount: null,
};

/**
 * בונה שם קובץ ידידותי-SEO משם המוצר. אם יש מספר תמונות לאותו מוצר,
 * הסיומת הייחודית (`-2`, `-3`...) מנוהלת ע"י המפה שמועברת בחוץ.
 */
function buildSeoFilename(
  productTitle: string,
  imgSrc: string,
  nthForProduct: number = 1
): string {
  const ext = extensionFromUrl(imgSrc, "jpg");
  const base = slugifyFilename(productTitle, ext);
  if (nthForProduct <= 1) return base;
  // "green-tea-cleaner.jpg" → "green-tea-cleaner-2.jpg"
  const dot = base.lastIndexOf(".");
  if (dot === -1) return `${base}-${nthForProduct}`;
  return `${base.slice(0, dot)}-${nthForProduct}${base.slice(dot)}`;
}

export default function ShopifyPanel({ onImport, size, quality }: Props) {
  // הידרציה: התחבר אחרי mount
  const [hydrated, setHydrated] = useState(false);
  const [conn, setConn] = useState<ShopifyConnection | null>(null);

  // טופס חיבור
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // קטגוריות
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<number>(
    ALL_COLLECTION.id
  );

  // מוצרים – ל-cache לכל קטגוריה לחוד כדי לא לטעון שוב
  const [productsByCollection, setProductsByCollection] = useState<
    Map<number, { products: ShopifyProduct[] }>
  >(new Map());
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // בחירה לייבוא
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    setHydrated(true);
    const c = getConnection();
    if (c) {
      setConn(c);
    }
  }, []);

  const loadCollections = useCallback(async (c: ShopifyConnection) => {
    setLoadingCollections(true);
    setCollectionsError(null);
    try {
      const res = await listCollections(c);
      setCollections(res.collections);
    } catch (e: unknown) {
      setCollectionsError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  const loadProductsFor = useCallback(
    async (c: ShopifyConnection, collectionId: number) => {
      setLoadingProducts(true);
      setProductsError(null);
      try {
        const res = await listProducts(c, {
          collectionId:
            collectionId === ALL_COLLECTION.id ? undefined : collectionId,
          fetchAll: true,
        });
        setProductsByCollection((prev) => {
          const next = new Map(prev);
          next.set(collectionId, { products: res.products });
          return next;
        });
      } catch (e: unknown) {
        setProductsError(e instanceof Error ? e.message : "שגיאה");
      } finally {
        setLoadingProducts(false);
      }
    },
    []
  );

  // עם חיבור: טען קטגוריות + מוצרים של "כל המוצרים"
  useEffect(() => {
    if (!conn) return;
    if (collections.length === 0 && !loadingCollections) {
      loadCollections(conn);
    }
    if (!productsByCollection.has(ALL_COLLECTION.id) && !loadingProducts) {
      loadProductsFor(conn, ALL_COLLECTION.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  // החלפת קטגוריה → טען אם אין cache
  useEffect(() => {
    if (!conn) return;
    if (
      !productsByCollection.has(activeCollectionId) &&
      !loadingProducts
    ) {
      loadProductsFor(conn, activeCollectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollectionId, conn]);

  const handleConnect = async () => {
    if (!shop.trim() || !token.trim() || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const normalizedShop = normalizeShopDomain(shop);
      const v = await validateConnection(normalizedShop, token.trim());
      const c: ShopifyConnection = {
        shop: normalizedShop,
        token: token.trim(),
        shopName: v.shopName,
        connectedAt: Date.now(),
      };
      saveConnection(c);
      setConn(c);
      setShop("");
      setToken("");
    } catch (e: unknown) {
      setConnectError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (!confirm("להתנתק מ-Shopify? הטוקן יימחק מהדפדפן.")) return;
    clearConnection();
    setConn(null);
    setCollections([]);
    setProductsByCollection(new Map());
    setSelected(new Map());
    setActiveCollectionId(ALL_COLLECTION.id);
  };

  const refreshAll = async () => {
    if (!conn) return;
    setProductsByCollection(new Map());
    setCollections([]);
    setSelected(new Map());
    await loadCollections(conn);
    await loadProductsFor(conn, activeCollectionId);
  };

  const toggleSelect = (item: SelectedItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = item.imgSrc;
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Map());

  const currentProducts = useMemo(
    () => productsByCollection.get(activeCollectionId)?.products || [],
    [productsByCollection, activeCollectionId]
  );

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return currentProducts;
    const q = search.trim().toLowerCase();
    return currentProducts.filter((p) => p.title.toLowerCase().includes(q));
  }, [currentProducts, search]);

  const selectMainOfVisible = () => {
    if (!filteredProducts.length) return;
    const next = new Map(selected);
    for (const p of filteredProducts) {
      const main =
        (p.featuredImageId &&
          p.images.find((i) => i.id === p.featuredImageId)) ||
        p.images[0];
      if (main) {
        next.set(main.src, {
          imgSrc: main.src,
          imgId: main.id,
          productId: p.id,
          productTitle: p.title,
        });
      }
    }
    setSelected(next);
  };

  const importSelected = async () => {
    if (selected.size === 0 || importing || !conn) return;
    const items = Array.from(selected.values());
    setImporting(true);
    setImportProgress({ done: 0, total: items.length });

    const batchSize = 5;
    const collected: Array<{ file: File; source?: ImageSource }> = [];
    // מונה כמה תמונות כבר ייצרנו לאותו מוצר (כדי להוסיף סיומת ייחודית
    // כשבוחרים יותר מתמונה אחת לאותו מוצר).
    const perProductCount = new Map<string, number>();
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (it) => {
          const r = await fetch("/api/fetch-image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: it.imgSrc }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.error || `HTTP ${r.status}`);
          }
          const blob = await r.blob();
          const key = String(it.productId);
          const nth = (perProductCount.get(key) || 0) + 1;
          perProductCount.set(key, nth);
          const filename = buildSeoFilename(it.productTitle, it.imgSrc, nth);
          const file = new File([blob], filename, {
            type: blob.type || "image/jpeg",
          });
          const source: ImageSource = {
            type: "shopify",
            shop: conn.shop,
            shopName: conn.shopName,
            productId: it.productId,
            productTitle: it.productTitle,
            originalImageId: it.imgId,
          };
          return { file, source };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") collected.push(r.value);
      }
      setImportProgress((p) => ({
        done: Math.min(p.done + batch.length, items.length),
        total: p.total,
      }));
    }

    if (collected.length > 0) onImport(collected);
    setSelected(new Map());
    setImporting(false);
  };

  if (!hydrated) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">טוען...</div>
    );
  }

  // --- מצב לא מחובר ---
  if (!conn) {
    return (
      <div className="p-5">
        <div className="mb-4 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="text-sm font-semibold text-emerald-900">
            איך מקבלים Access Token?
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed text-emerald-900">
            <li>
              בלוח הניהול של Shopify:{" "}
              <b>Settings → Apps and sales channels → Develop apps</b>
            </li>
            <li>
              לחץ <b>Create an app</b>, תן שם (לדוגמה "PhotosPro")
            </li>
            <li>
              ב-<b>Configuration</b> → Admin API access scopes → סמן את:
              <br />
              • <b>read_products</b> + <b>write_products</b> (חובה)
              <br />
              • <b>read_themes</b> + <b>write_themes</b> (לעריכת Hero / דף הבית)
              <br />
              • <b>read_files</b> + <b>write_files</b> (לוידאו ולתמונות גדולות)
            </li>
            <li>
              ב-<b>API credentials</b> → לחץ <b>Install app</b>
            </li>
            <li>
              העתק את ה-<b>Admin API access token</b> (מתחיל ב-
              <code className="rounded bg-white px-1">shpat_...</code>)
            </li>
          </ol>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              דומיין החנות
            </label>
            <input
              dir="ltr"
              type="text"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConnect();
              }}
              placeholder="myshop.myshopify.com"
              className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              disabled={connecting}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Admin API Access Token
            </label>
            <div className="relative">
              <input
                dir="ltr"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
                placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-xl bg-white px-3 py-2 pl-9 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                disabled={connecting}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
                title={showToken ? "הסתר" : "הצג"}
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
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <button
          onClick={handleConnect}
          disabled={connecting || !shop.trim() || !token.trim()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {connecting ? "מתחבר..." : "התחבר לחנות"}
        </button>
        {connectError && (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            {connectError}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          🔒 הטוקן נשמר רק בדפדפן שלך (localStorage) ולא נשלח לאף מקום מלבד
          Shopify עצמו (דרך פרוקסי מקומי לעקיפת CORS).
        </p>
      </div>
    );
  }

  // --- מצב מחובר ---
  const allCollections = [ALL_COLLECTION, ...collections];

  return (
    <div className="p-5">
      {/* סטטוס חיבור */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          <span>
            מחובר ל-
            <b className="text-emerald-900">{conn.shopName || conn.shop}</b>
          </span>
          <code className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
            {conn.shop}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshAll}
            disabled={loadingProducts || loadingCollections}
            className="btn-ghost !py-1 text-xs"
            title="רענן קטגוריות ומוצרים"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={clsx(
                "h-3.5 w-3.5",
                (loadingProducts || loadingCollections) && "animate-spin"
              )}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            רענן
          </button>
          <button
            onClick={handleDisconnect}
            className="btn-ghost !py-1 text-xs text-rose-600"
          >
            התנתק
          </button>
        </div>
      </div>

      {collectionsError && (
        <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          קטגוריות: {collectionsError}
        </div>
      )}
      {productsError && (
        <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          מוצרים: {productsError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        {/* סיידבר קטגוריות */}
        <aside className="max-h-[560px] overflow-y-auto rounded-xl bg-slate-50 p-2">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            קטגוריות{loadingCollections && " • טוען..."}
          </p>
          {allCollections.map((cat) => {
            const isActive = activeCollectionId === cat.id;
            const cached = productsByCollection.get(cat.id);
            const countLabel =
              cat.productsCount != null
                ? cat.productsCount
                : cached?.products.length;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCollectionId(cat.id);
                  setSearch("");
                }}
                className={clsx(
                  "mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition",
                  isActive
                    ? "bg-emerald-600 font-semibold text-white shadow-soft"
                    : "text-slate-700 hover:bg-white"
                )}
              >
                <span className="truncate">{cat.title}</span>
                {countLabel != null && (
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                      isActive
                        ? "bg-white/20"
                        : "bg-slate-200 text-slate-600"
                    )}
                  >
                    {countLabel}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* תוכן המוצרים */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">
                {allCollections.find((c) => c.id === activeCollectionId)?.title}
              </h4>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם מוצר..."
                className="rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="chip bg-slate-100 text-slate-700">
                {filteredProducts.length} מוצרים
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={selectMainOfVisible}
                className="btn-ghost !py-1 text-xs"
                title="בחר את כל המוצרים המוצגים"
              >
                בחר הכל
              </button>
              <button
                onClick={clearSelection}
                className="btn-ghost !py-1 text-xs text-rose-600"
              >
                נקה בחירה
              </button>
            </div>
          </div>

          {loadingProducts && currentProducts.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              טוען מוצרים...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              {search.trim()
                ? "לא נמצאו מוצרים תואמים."
                : "אין מוצרים בקטגוריה זו."}
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filteredProducts.map((p) => {
                  const main =
                    (p.featuredImageId &&
                      p.images.find((i) => i.id === p.featuredImageId)) ||
                    p.images[0];
                  if (!main) {
                    return (
                      <div
                        key={p.id}
                        className="rounded-xl bg-white p-3 text-center text-xs text-slate-400 ring-1 ring-slate-200"
                      >
                        <div className="mb-2 flex aspect-square items-center justify-center rounded-lg bg-slate-50">
                          אין תמונה
                        </div>
                        <p
                          className="truncate text-[11px] font-semibold text-slate-700"
                          title={p.title}
                        >
                          {p.title}
                        </p>
                      </div>
                    );
                  }
                  const isSel = selected.has(main.src);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        toggleSelect({
                          imgSrc: main.src,
                          imgId: main.id,
                          productId: p.id,
                          productTitle: p.title,
                        })
                      }
                      className={clsx(
                        "group relative overflow-hidden rounded-xl bg-white p-2 text-right ring-2 transition",
                        isSel
                          ? "ring-emerald-600"
                          : "ring-slate-200 hover:ring-emerald-300"
                      )}
                      title={p.title}
                    >
                      <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={main.src}
                          alt={main.alt || p.title}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                        <div
                          className={clsx(
                            "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow",
                            isSel
                              ? "bg-emerald-600"
                              : "bg-white/90 text-slate-400 opacity-0 group-hover:opacity-100"
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
                            <span className="text-base leading-none">+</span>
                          )}
                        </div>
                        {p.images.length > 1 && (
                          <div className="absolute left-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                            +{p.images.length - 1}
                          </div>
                        )}
                      </div>
                      <p
                        className="mt-2 line-clamp-2 min-h-[2.4em] text-[11px] font-medium leading-tight text-slate-700"
                      >
                        {p.title}
                      </p>
                    </button>
                  );
                })}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* פס פעולה */}
      <div className="mt-4 flex flex-col items-stretch gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {selected.size > 0 ? (
            <>
              <span>
                נבחרו <b className="text-emerald-700">{selected.size}</b>{" "}
                תמונות
              </span>
              <span className="chip bg-amber-50 text-amber-900 ring-1 ring-amber-200">
                עלות עיבוד משוערת:{" "}
                {fmtUSD(estimateBatchCostUSD(selected.size, size, quality))} (
                {fmtILS(
                  usdToIls(estimateBatchCostUSD(selected.size, size, quality))
                )}
                )
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              לחץ על תמונה כדי לבחור אותה לעיבוד
            </span>
          )}
        </div>
        <button
          onClick={importSelected}
          disabled={selected.size === 0 || importing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-50"
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
  );
}
