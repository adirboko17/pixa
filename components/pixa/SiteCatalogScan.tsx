"use client";

import React, { useMemo, useState } from "react";
import { Icons } from "./icons";
import { Spinner } from "./screens-shell";
import type {
  CatalogScanImage,
  CatalogScanProduct,
  CatalogScanResult,
} from "@/lib/site-catalog-scan";

const II = Icons;
const MAX_IMPORT = 100;

export type ScannedImport = {
  file: File;
  name: string;
  price: number;
  currency?: string;
  /** Remote gallery, including the primary image used as the catalog photo. */
  images: Array<{ src: string; primary: boolean; position: number }>;
  activeSrc: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onImport: (items: ScannedImport[]) => void;
};

function safeFilename(name: string): string {
  const clean = name.replace(/[^\w.\-\u0590-\u05FF ]/g, "_").trim().slice(0, 80);
  return clean || "product";
}

function uniqueInCategory(
  result: CatalogScanResult,
  handle: string | null
): CatalogScanProduct[] {
  const cats =
    handle && handle !== "all"
      ? result.categories.filter((c) => c.handle === handle)
      : result.categories;
  const map = new Map<string, CatalogScanProduct>();
  for (const cat of cats) {
    for (const product of cat.products) {
      if (!map.has(product.id)) map.set(product.id, product);
    }
  }
  return Array.from(map.values());
}

function CatalogThumb({
  img,
  title,
}: {
  img: CatalogScanImage;
  title: string;
}) {
  const [src, setSrc] = useState(img.src);
  return (
    <div
      title={img.primary ? "תמונה ראשית" : `תמונה ${img.position}`}
      style={{
        position: "relative",
        width: 92,
        height: 92,
        padding: 0,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--hair)",
        background: "var(--bg-card)",
        flexShrink: 0,
      }}
    >
      <img
        src={src}
        alt={img.alt || title}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        onError={() => {
          if (!src.startsWith("/api/fetch-image")) {
            setSrc(`/api/fetch-image?url=${encodeURIComponent(img.src)}`);
          }
        }}
      />
      <span
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          fontSize: 10,
          lineHeight: 1,
          padding: "3px 6px",
          borderRadius: 999,
          background: img.primary ? "rgba(16,185,129,.92)" : "rgba(15,15,20,.72)",
          color: "#fff",
        }}
      >
        {img.primary ? "ראשית" : "נוספת"}
      </span>
    </div>
  );
}

export default function SiteCatalogScan({ open, onClose, onImport }: Props) {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogScanResult | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const products = useMemo(() => {
    if (!result) return [];
    const list = uniqueInCategory(result, category);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.title.toLowerCase().includes(q));
  }, [result, category, search]);

  if (!open) return null;

  const scan = async () => {
    if (!url.trim() || scanning) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setSelected(new Set());
    setSearch("");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `שגיאה ${res.status}`);
      const scanned = data as CatalogScanResult;
      setResult(scanned);
      setCategory(scanned.focusHandle || "all");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setScanning(false);
    }
  };

  const toggleProduct = (productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const product of products) next.add(product.id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const importSelected = async () => {
    if (!result || selected.size === 0 || importing) return;
    const chosen: CatalogScanProduct[] = [];
    const seen = new Set<string>();
    for (const cat of result.categories) {
      for (const product of cat.products) {
        if (!selected.has(product.id) || seen.has(product.id) || product.images.length === 0) {
          continue;
        }
        seen.add(product.id);
        chosen.push(product);
      }
    }
    const batchItems = chosen.slice(0, MAX_IMPORT);
    setImporting(true);
    setProgress({ done: 0, total: batchItems.length });
    const imported: ScannedImport[] = [];
    const size = 4;
    for (let i = 0; i < batchItems.length; i += size) {
      const slice = batchItems.slice(i, i + size);
      const settled = await Promise.allSettled(
        slice.map(async (product) => {
          const img = product.images.find((image) => image.primary) || product.images[0];
          const r = await fetch("/api/fetch-image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: img.src }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.error || `HTTP ${r.status}`);
          }
          const blob = await r.blob();
          const file = new File([blob], `${safeFilename(product.title)}.jpg`, {
            type: blob.type || "image/jpeg",
          });
          return {
            file,
            name: product.title,
            price: product.priceAmount || 0,
            currency: product.currency,
            images: product.images.map((image) => ({
              src: image.src,
              primary: image.primary,
              position: image.position,
            })),
            activeSrc: img.src,
          } satisfies ScannedImport;
        })
      );
      for (const item of settled) {
        if (item.status === "fulfilled") imported.push(item.value);
      }
      setProgress({
        done: Math.min(i + slice.length, batchItems.length),
        total: batchItems.length,
      });
    }
    setImporting(false);
    if (imported.length === 0) {
      setError("לא הצלחנו להוריד את המוצרים שנבחרו");
      return;
    }
    onImport(imported);
    onClose();
  };

  return (
    <div className="overlay catalog-scan-overlay" onClick={onClose}>
      <div
        className="modal catalog-scan-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(820px, calc(100vw - 48px))",
          height: "auto",
          maxHeight: "min(560px, calc(100vh - 80px))",
          margin: 0,
          animation: "none",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="modal-head" style={{ flex: "0 0 auto" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              סריקת קטלוג
            </div>
            <h2 className="h-display" style={{ fontSize: 26, margin: 0 }}>
              מוצרים מאתר
            </h2>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            סגור
          </button>
        </div>

        <div
          className="modal-body"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void scan();
              }}
              placeholder="https://shop.example.com"
              disabled={scanning}
              style={{
                flex: 1,
                minWidth: 220,
                background: "var(--bg-card)",
                color: "inherit",
                border: "1px solid var(--hair)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 14,
              }}
            />
            <button
              className="btn btn-primary"
              type="button"
              disabled={scanning || !url.trim()}
              onClick={() => void scan()}
            >
              {scanning ? <Spinner size={14} /> : <II.Globe size={15} />}
              {scanning ? "סורק את הקטלוג…" : "סרוק אתר"}
            </button>
          </div>
          <p className="text-2" style={{ marginTop: 10, fontSize: 13 }}>
            מדביקים קישור לחנות, בוחרים מוצרים, ומושכים אותם לקטלוג. אחר כך אפשר להחליט מה לעשות עם התמונות.
          </p>

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,61,139,.08)",
                color: "#ff8eb3",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div style={{ marginTop: 22 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                <span className="chip">נמשכו {result.totalProducts} מוצרים</span>
                <span className="chip">{result.totalImages} תמונות בסך הכל</span>
                <span className="chip">{result.domain}</span>
                {result.notes?.map((note) => (
                  <span key={note} className="chip">
                    {note}
                  </span>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                {result.categories.length > 1 && (
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      background: "var(--bg-card)",
                      color: "inherit",
                      border: "1px solid var(--hair)",
                      borderRadius: 10,
                      padding: "8px 10px",
                    }}
                  >
                    <option value="all">כל הקטגוריות</option>
                    {result.categories.map((cat) => (
                      <option key={cat.handle} value={cat.handle}>
                        {cat.name} ({cat.products.length})
                      </option>
                    ))}
                  </select>
                )}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש לפי שם מוצר"
                  style={{
                    background: "var(--bg-card)",
                    color: "inherit",
                    border: "1px solid var(--hair)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    minWidth: 180,
                  }}
                />
                <button className="btn btn-ghost" type="button" onClick={selectAllVisible}>
                  בחר הכל
                </button>
                <button className="btn btn-ghost" type="button" onClick={clearSelection}>
                  נקה בחירה
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {products.map((product) => {
                  const isSel = selected.has(product.id);
                  return (
                    <div
                      key={product.id}
                      onClick={() => toggleProduct(product.id)}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 14,
                        padding: 12,
                        borderRadius: 16,
                        border: isSel ? "1px solid #fff" : "1px solid var(--hair)",
                        background: "var(--bg-card)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid var(--hair)",
                          background: isSel ? "#fff" : "transparent",
                          color: "#111",
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          marginTop: 4,
                        }}
                      >
                        {isSel && <II.Check size={14} strokeWidth={3} />}
                      </div>
                      <div style={{ minWidth: 160, flex: "1 1 160px" }}>
                        <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{product.title}</div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginTop: 6,
                          }}
                        >
                          <div className="product-price">
                            {product.priceLabel || "בלי מחיר"}
                          </div>
                          <span className="chip" style={{ height: 26, cursor: "default" }}>
                            {product.images.length}{" "}
                            {product.images.length === 1 ? "תמונה" : "תמונות"}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                        {product.images.map((img) => (
                          <CatalogThumb key={img.src} img={img} title={product.title} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {products.length === 0 && (
                  <p className="text-2">אין מוצרים לפי הסינון הזה.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot" style={{ flex: "0 0 auto" }}>
          <span style={{ fontSize: 13 }}>
            {selected.size > 0
              ? `נבחרו ${selected.size} מוצרים`
              : "בחרו את כל המוצרים, או רק חלק מהם"}
          </span>
          <button
            className="btn btn-primary lg"
            type="button"
            disabled={selected.size === 0 || importing}
            onClick={() => void importSelected()}
            style={{ flexShrink: 0 }}
          >
            {importing ? (
              <>
                <Spinner size={14} /> מושך {progress.done}/{progress.total}
              </>
            ) : (
              <>
                משוך לקטלוג
                {selected.size > 0 ? ` (${Math.min(selected.size, MAX_IMPORT)})` : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
