"use client";

import React, { useMemo, useRef, useState } from "react";
import { Icons } from "./icons";
import { buildImgUrl, fmtDate } from "./data";
import {
  isStoreBackedProduct,
  isUploadedProduct,
  type AnyProduct,
  type BlueprintDims,
} from "./screens-app";
import { Spinner } from "./screens-shell";
import {
  formatDimensions,
  parseDimensionsFromText,
  type ProductDimensions,
} from "@/lib/product-dimensions";
import type { ProcessingOptions, RecolorScope } from "./data";

const COLOR_SWATCHES = [
  { id: "black", label: "שחור", hex: "#111111" },
  { id: "graphite", label: "גרפיט", hex: "#3A3A3A" },
  { id: "white", label: "לבן", hex: "#F3F3F3" },
  { id: "silver", label: "כסף", hex: "#C0C4C8" },
  { id: "cream", label: "קרם", hex: "#E8DCC8" },
  { id: "navy", label: "כחול כהה", hex: "#1B2A4A" },
  { id: "red", label: "אדום", hex: "#B42318" },
] as const;

const II = Icons;

export type BlueprintJob = {
  product: AnyProduct;
  dims: BlueprintDims;
};

type DimDraft = {
  width: string;
  height: string;
  depth: string;
  source?: ProductDimensions["source"];
};

function productImageUrl(p: AnyProduct): string {
  if (isUploadedProduct(p)) return p.fileUrl;
  if (isStoreBackedProduct(p)) return p.imageUrl;
  return buildImgUrl(p.img, 640);
}

function resolveDimensions(p: AnyProduct): ProductDimensions | undefined {
  if (p.dimensions?.widthCm || p.dimensions?.heightCm || p.dimensions?.depthCm) {
    return p.dimensions;
  }
  return parseDimensionsFromText(p.name);
}

function draftFromProduct(p: AnyProduct): DimDraft {
  const dims = resolveDimensions(p);
  return {
    width: dims?.widthCm != null ? String(dims.widthCm) : "",
    height: dims?.heightCm != null ? String(dims.heightCm) : "",
    depth: dims?.depthCm != null ? String(dims.depthCm) : "",
    source: dims?.source,
  };
}

function parseDraft(d: DimDraft | undefined): BlueprintDims | null {
  if (!d) return null;
  const widthCm = Number(d.width);
  const heightCm = Number(d.height);
  const depthCm = Number(d.depth);
  if (!(widthCm > 0 && heightCm > 0 && depthCm > 0)) return null;
  return { widthCm, heightCm, depthCm };
}

function DimInputs({
  draft,
  onChange,
}: {
  draft: DimDraft;
  onChange: (next: DimDraft) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 10,
      }}
    >
      {(
        [
          ["רוחב", "width"],
          ["גובה", "height"],
          ["עומק", "depth"],
        ] as const
      ).map(([label, key]) => (
        <label key={key} style={{ display: "block" }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginBottom: 6,
            }}
          >
            {label} (ס״מ)
          </div>
          <input
            className="input"
            inputMode="decimal"
            value={draft[key]}
            onChange={(e) =>
              onChange({ ...draft, [key]: e.target.value, source: undefined })
            }
            placeholder="0"
            style={{
              width: "100%",
              height: 44,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>
      ))}
    </div>
  );
}

export const BlueprintScreen: React.FC<{
  products: AnyProduct[];
  loading?: boolean;
  onGenerate: (jobs: BlueprintJob[]) => void;
  onCatalog: (products: AnyProduct[]) => void;
  onRestyle: (products: AnyProduct[], extras: Partial<ProcessingOptions>) => void;
}> = ({ products, loading, onGenerate, onCatalog, onRestyle }) => {
  const [step, setStep] = useState<"select" | "mode" | "dims" | "recolor">(
    "select"
  );
  const [recolorHex, setRecolorHex] = useState("#111111");
  const [recolorLabel, setRecolorLabel] = useState("שחור");
  const [recolorScope, setRecolorScope] = useState<RecolorScope>("both");
  const [emptyWithColor, setEmptyWithColor] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dimsById, setDimsById] = useState<Record<number, DimDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localUploads, setLocalUploads] = useState<AnyProduct[]>([]);

  const catalog = useMemo(
    () => [...localUploads, ...products],
    [localUploads, products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((p) => p.name.toLowerCase().includes(q));
  }, [catalog, search]);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => catalog.find((p) => p.id === id))
        .filter((p): p is AnyProduct => !!p),
    [catalog, selectedIds]
  );

  const readyCount = selected.filter((p) => parseDraft(dimsById[p.id])).length;
  const allReady = selected.length > 0 && readyCount === selected.length;

  const ensureDrafts = (ids: number[]) => {
    setDimsById((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]) continue;
        const p = catalog.find((item) => item.id === id);
        if (p) next[id] = draftFromProduct(p);
      }
      return next;
    });
  };

  const toggleProduct = (p: AnyProduct) => {
    setSelectedIds((prev) => {
      if (prev.includes(p.id)) return prev.filter((id) => id !== p.id);
      ensureDrafts([p.id]);
      return [...prev, p.id];
    });
    setError(null);
  };

  const selectVisible = () => {
    const ids = filtered.map((p) => p.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    ensureDrafts(ids);
    setError(null);
  };

  const clearSelected = () => {
    setSelectedIds([]);
    setError(null);
    if (step !== "select") setStep("select");
  };

  const onLocalFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: AnyProduct[] = Array.from(files).map((file, i) => {
      const id = Date.now() + i;
      return {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        price: 0,
        category: "all",
        img: "",
        optimized: false,
        isUpload: true as const,
        fileUrl: URL.createObjectURL(file),
        file,
      };
    });
    setLocalUploads((prev) => [...next, ...prev]);
    const ids = next.map((p) => p.id);
    setSelectedIds((prev) => [...prev, ...ids]);
    setDimsById((prev) => {
      const copy = { ...prev };
      for (const p of next) copy[p.id] = draftFromProduct(p);
      return copy;
    });
    setError(null);
  };

  const goToMode = () => {
    if (selectedIds.length === 0) {
      setError("בחר לפחות מוצר אחד");
      return;
    }
    setError(null);
    setStep("mode");
  };

  const goToDims = () => {
    ensureDrafts(selectedIds);
    setError(null);
    setStep("dims");
  };

  const startCatalog = () => {
    if (!selected.length) {
      setError("בחר לפחות מוצר אחד");
      return;
    }
    setError(null);
    onCatalog(selected);
  };

  const startEmpty = () => {
    if (!selected.length) {
      setError("בחר לפחות מוצר אחד");
      return;
    }
    setError(null);
    onRestyle(selected, { emptyInterior: true });
  };

  const goToRecolor = () => {
    if (!selected.length) {
      setError("בחר לפחות מוצר אחד");
      return;
    }
    setError(null);
    setStep("recolor");
  };

  const startRecolor = () => {
    if (!selected.length) {
      setError("בחר לפחות מוצר אחד");
      return;
    }
    if (!/^#?[0-9a-fA-F]{6}$/.test(recolorHex)) {
      setError("בחר צבע תקין");
      return;
    }
    const hex = recolorHex.startsWith("#") ? recolorHex : `#${recolorHex}`;
    setError(null);
    onRestyle(selected, {
      recolorHex: hex,
      recolorLabel,
      recolorScope,
      emptyInterior: emptyWithColor,
    });
  };

  const generate = () => {
    const jobs: BlueprintJob[] = [];
    for (const p of selected) {
      const dims = parseDraft(dimsById[p.id]);
      if (!dims) {
        setError("הזן רוחב, גובה ועומק לכל המוצרים");
        return;
      }
      jobs.push({ product: p, dims });
    }
    if (!jobs.length) return;
    setError(null);
    onGenerate(jobs);
  };

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 22 }}>
        {step === "select"
          ? "01 · בחירת מוצרים"
          : step === "mode"
            ? "02 · בחירת סוג עיבוד"
            : step === "recolor"
              ? "03 · בחירת צבע"
              : "03 · מידות לכל מוצר"}{" "}
        · {fmtDate()}
      </div>
      <h1 className="h-display" style={{ marginBottom: 14, maxWidth: 720 }}>
        {step === "select" ? (
          <>
            בחר
            <span className="grad-text"> כמה מוצרים</span>
            <br />
            בבת אחת.
          </>
        ) : step === "mode" ? (
          <>
            מה
            <span className="grad-text"> לעשות</span>
            <br />
            עם המוצרים?
          </>
        ) : step === "recolor" ? (
          <>
            באיזה
            <span className="grad-text"> צבע</span>
            <br />
            לצבוע?
          </>
        ) : (
          <>
            הזן
            <span className="grad-text"> מידות</span>
            <br />
            לכל מוצר.
          </>
        )}
      </h1>
      <p className="text-2" style={{ maxWidth: 560, marginBottom: 40, fontSize: 16 }}>
        {step === "select"
          ? "סמן את כל המוצרים. בשלב הבא תבחר שרטוט, קטלוג, צביעה או ריקון פנים."
          : step === "mode"
            ? "שרטוט מידות, תמונת קטלוג, צביעה בצבע שבחרת, או ריקון מקרר / ארון ממוצרים עם שמירה על מספר המדפים."
            : step === "recolor"
              ? "בחר צבע לפנים, לחוץ, או לשניהם. אפשר גם לרוקן את הפנים ממוצרים באותו צעד."
              : "רוחב · גובה · עומק בס״מ. מה שנמצא בדאטה או בשם כבר ממולא — אשר או תקן."}
      </p>

      {step === "select" ? (
        <section>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <span
                style={{
                  position: "absolute",
                  insetInlineStart: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--ink-3)",
                }}
              >
                <II.Search size={14} />
              </span>
              <input
                className="input"
                placeholder="חפש מוצר…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ height: 44, paddingInlineStart: 36, width: "100%" }}
              />
            </div>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <II.Upload size={14} /> העלה תמונות
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onLocalFiles(e.target.files)}
            />
            {filtered.length > 0 && (
              <button className="btn btn-ghost" type="button" onClick={selectVisible}>
                בחר את כל המוצגים
              </button>
            )}
            {selectedIds.length > 0 && (
              <button className="btn btn-ghost" type="button" onClick={clearSelected}>
                נקה בחירה
              </button>
            )}
          </div>

          {loading && catalog.length === 0 ? (
            <div style={{ padding: 48, display: "grid", placeItems: "center" }}>
              <Spinner size={22} />
            </div>
          ) : filtered.length === 0 ? (
            <p style={{ color: "var(--ink-3)", fontSize: 14 }}>
              אין מוצרים להצגה. חבר חנות או העלה תמונה.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                gap: 12,
                paddingBottom: 110,
              }}
            >
              {filtered.map((p) => {
                const active = selectedIds.includes(p.id);
                const dims = resolveDimensions(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProduct(p)}
                    style={{
                      textAlign: "start",
                      background: active ? "var(--bg-card-hi)" : "var(--bg-card)",
                      border: active
                        ? "1px solid var(--cream)"
                        : "1px solid var(--hair)",
                      borderRadius: 14,
                      overflow: "hidden",
                      cursor: "pointer",
                      padding: 0,
                      color: "inherit",
                      fontFamily: "inherit",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: "1",
                        background: "var(--bg-paper)",
                        overflow: "hidden",
                      }}
                    >
                      <img
                        src={productImageUrl(p)}
                        alt={p.name}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        top: 8,
                        insetInlineEnd: 8,
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        border: active
                          ? "0"
                          : "2px solid rgba(255,255,255,.85)",
                        background: active ? "var(--grad)" : "rgba(0,0,0,.35)",
                        display: "grid",
                        placeItems: "center",
                        boxShadow: "0 2px 8px rgba(0,0,0,.25)",
                      }}
                    >
                      {active ? (
                        <II.Check size={14} strokeWidth={3} />
                      ) : null}
                    </div>
                    <div style={{ padding: "10px 12px 12px" }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {p.name}
                      </div>
                      {dims && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: "var(--cream-dim)",
                          }}
                        >
                          {formatDimensions(dims)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : step === "mode" ? (
        <section style={{ paddingBottom: 110, maxWidth: 820 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError(null);
              setStep("select");
            }}
            style={{ marginBottom: 18 }}
          >
            ← חזרה לבחירה
          </button>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            <button
              type="button"
              onClick={goToDims}
              style={{
                textAlign: "start",
                background: "var(--bg-card)",
                border: "1px solid var(--hair)",
                borderRadius: 18,
                padding: 22,
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "var(--bg-paper)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 16,
                }}
              >
                <II.Ruler size={20} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                שרטוט מידות
              </div>
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
                שרטוט קווי מקצועי עם רוחב · גובה · עומק. בשלב הבא תזין מידות לכל
                מוצר, ואז התור יעבד את כולם.
              </div>
            </button>
            <button
              type="button"
              onClick={startCatalog}
              style={{
                textAlign: "start",
                background: "var(--bg-card-hi)",
                border: "1px solid var(--cream)",
                borderRadius: 18,
                padding: 22,
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "var(--grad)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 16,
                }}
              >
                <II.Sparkles size={20} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                תמונת קטלוג מקצועית
              </div>
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
                לוקח את התמונה המקורית ומעצב אותה מחדש על רקע לבן: משלים מוצר
                חתוך, מסדר פנים מבולגן (כמו מקרר), ומחזיר תמונת קטלוג שנראית
                כמו מוצר אמיתי למכירה.
              </div>
            </button>
            <button
              type="button"
              onClick={goToRecolor}
              style={{
                textAlign: "start",
                background: "var(--bg-card)",
                border: "1px solid var(--hair)",
                borderRadius: 18,
                padding: 22,
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "#111",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 16,
                  color: "#fff",
                }}
              >
                <II.Droplet size={20} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                צביעת מוצר
              </div>
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
                צובע את המוצר בצבע שבחרת. לדוגמה מקרר שחור פנים וחוץ — בלי
                להחליף את הדגם.
              </div>
            </button>
            <button
              type="button"
              onClick={startEmpty}
              style={{
                textAlign: "start",
                background: "var(--bg-card)",
                border: "1px solid var(--hair)",
                borderRadius: 18,
                padding: 22,
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "var(--bg-paper)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 16,
                }}
              >
                <II.Box size={20} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                ריקון פנים
              </div>
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
                מרוקן מקרר / ארון / תצוגה ממוצרים. נשאר רק המוצר עצמו — עם אותו
                מספר מדפים, מגירות ודלתות כמו במקור.
              </div>
            </button>
          </div>
        </section>
      ) : step === "recolor" ? (
        <section style={{ paddingBottom: 110, maxWidth: 760 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError(null);
              setStep("mode");
            }}
            style={{ marginBottom: 18 }}
          >
            ← חזרה לסוג העיבוד
          </button>
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--hair)",
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ fontWeight: 650, marginBottom: 14 }}>צבע</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {COLOR_SWATCHES.map((c) => {
                const active = recolorHex.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setRecolorHex(c.hex);
                      setRecolorLabel(c.label);
                    }}
                    style={{
                      border: active
                        ? "2px solid var(--cream)"
                        : "1px solid var(--hair)",
                      borderRadius: 12,
                      padding: "10px 8px",
                      background: "transparent",
                      cursor: "pointer",
                      color: "inherit",
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: 28,
                        borderRadius: 8,
                        background: c.hex,
                        border: "1px solid rgba(0,0,0,.12)",
                        marginBottom: 8,
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{c.label}</span>
                  </button>
                );
              })}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--ink-3)" }}>צבע מותאם</span>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(recolorHex) ? recolorHex : "#111111"}
                onChange={(e) => {
                  setRecolorHex(e.target.value);
                  setRecolorLabel("מותאם");
                }}
                style={{ width: 42, height: 32, border: 0, background: "none" }}
              />
              <input
                className="input"
                value={recolorHex}
                onChange={(e) => {
                  setRecolorHex(e.target.value);
                  setRecolorLabel("מותאם");
                }}
                style={{ width: 110, height: 36, textAlign: "center" }}
              />
            </label>

            <div style={{ fontWeight: 650, marginBottom: 10 }}>איפה לצבוע</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {(
                [
                  ["both", "פנים וחוץ"],
                  ["exterior", "רק חוץ"],
                  ["interior", "רק פנים"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={recolorScope === id ? "btn btn-primary" : "btn btn-ghost"}
                  onClick={() => setRecolorScope(id)}
                  style={{ height: 38 }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setEmptyWithColor((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                background: "var(--bg-paper)",
                border: "1px solid var(--hair)",
                borderRadius: 12,
                padding: "12px 14px",
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
                textAlign: "start",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  רוקן גם ממוצרים בפנים
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
                  המקרר נשאר ריק, עם אותו מספר מדפים כמו בתמונה המקורית
                </div>
              </div>
              <span
                style={{
                  width: 38,
                  height: 22,
                  borderRadius: 999,
                  background: emptyWithColor ? "var(--grad)" : "var(--bg-card-hi)",
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    [emptyWithColor ? "left" : "right"]: 3,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "white",
                  }}
                />
              </span>
            </button>
          </div>
        </section>
      ) : (
        <section style={{ paddingBottom: 110, maxWidth: 760 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError(null);
              setStep("mode");
            }}
            style={{ marginBottom: 18 }}
          >
            ← חזרה לסוג העיבוד
          </button>
          <div style={{ display: "grid", gap: 14 }}>
            {selected.map((p, index) => {
              const draft = dimsById[p.id] ?? draftFromProduct(p);
              const ok = !!parseDraft(draft);
              return (
                <div
                  key={p.id}
                  style={{
                    background: "var(--bg-card)",
                    border: ok
                      ? "1px solid var(--hair)"
                      : "1px solid rgba(255,61,139,.35)",
                    borderRadius: 18,
                    padding: 16,
                    display: "grid",
                    gridTemplateColumns: "92px 1fr",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      borderRadius: 12,
                      overflow: "hidden",
                      aspectRatio: "1",
                      background: "var(--bg-paper)",
                    }}
                  >
                    <img
                      src={productImageUrl(p)}
                      alt={p.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "start",
                        marginBottom: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink-3)",
                            marginBottom: 4,
                          }}
                        >
                          {index + 1} / {selected.length}
                        </div>
                        <div style={{ fontWeight: 650, fontSize: 15 }}>
                          {p.name}
                        </div>
                        {draft.source && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--cream-dim)",
                              marginTop: 4,
                            }}
                          >
                            {draft.source === "data"
                              ? "המידות נמשכו מהדאטה — אפשר לערוך"
                              : "המידות זוהו מהשם — אשר או תקן"}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setSelectedIds((prev) => {
                            const next = prev.filter((id) => id !== p.id);
                            if (next.length === 0) setStep("select");
                            return next;
                          });
                        }}
                        style={{ height: 36, paddingInline: 10 }}
                      >
                        הסר
                      </button>
                    </div>
                    <DimInputs
                      draft={draft}
                      onChange={(next) =>
                        setDimsById((prev) => ({ ...prev, [p.id]: next }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div
        style={{
          position: "sticky",
          bottom: 18,
          zIndex: 4,
          background: "var(--bg-card)",
          border: "1px solid var(--hair)",
          borderRadius: 16,
          padding: "14px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          boxShadow: "0 12px 40px -18px rgba(0,0,0,.45)",
        }}
      >
        <div style={{ fontSize: 14 }}>
          {step === "dims" ? (
            <>
              <span className="mono" style={{ fontWeight: 700 }}>
                {readyCount}
              </span>{" "}
              מתוך {selected.length} עם מידות מלאות
            </>
          ) : (
            <>
              <span className="mono" style={{ fontWeight: 700 }}>
                {selectedIds.length}
              </span>{" "}
              מוצרים נבחרו
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {error && (
            <div
              style={{
                color: "#ff3d8b",
                fontSize: 13,
                maxWidth: 260,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}
          {step === "select" ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={selectedIds.length === 0}
              onClick={goToMode}
              style={{ height: 46 }}
            >
              המשך
            </button>
          ) : step === "mode" ? (
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              בחר סוג עיבוד למעלה
            </span>
          ) : step === "recolor" ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={selected.length === 0}
              onClick={startRecolor}
              style={{ height: 46 }}
            >
              <II.Droplet size={16} /> צבע {selected.length} מוצרים
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={!allReady}
              onClick={generate}
              style={{ height: 46 }}
            >
              <II.Ruler size={16} /> צור {selected.length} שרטוטים
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
