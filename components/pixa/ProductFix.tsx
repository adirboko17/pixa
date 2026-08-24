"use client";

import React, { useEffect, useState } from "react";
import { Icons } from "./icons";
import { Spinner } from "./screens-shell";
import {
  SHELF_TRIM_HEX,
  hasProductFix,
  pickProductFix,
  appendProductFixToForm,
  type ProductFixOptions,
  type ShelfTrim,
} from "./data";

const II = Icons;

const INTERIOR_SWATCHES: Array<{ label: string; hex: string }> = [
  { label: "שחור", hex: "#111111" },
  { label: "פחם", hex: "#2A2A2A" },
  { label: "גרפיט", hex: "#3A3A3A" },
  { label: "פחם בהיר", hex: "#4A4A4A" },
  { label: "לבן", hex: "#F3F3F3" },
];

export function emptyProductFix(): ProductFixOptions {
  return {};
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "btn btn-primary" : "btn btn-ghost"}
      onClick={onClick}
      style={{ height: 34 }}
    >
      {children}
    </button>
  );
}

export const ProductFixControls: React.FC<{
  value: ProductFixOptions;
  onChange: (next: ProductFixOptions) => void;
  compact?: boolean;
}> = ({ value, onChange, compact }) => {
  const set = (patch: Partial<ProductFixOptions>) =>
    onChange(pickProductFix({ ...value, ...patch }));

  const clearInterior = () =>
    onChange(
      pickProductFix({
        ...value,
        interiorLift: undefined,
        interiorLiftHex: undefined,
      })
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 16 : 22 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          צבע פנים
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Chip
            active={value.interiorLift === "darken" && !value.interiorLiftHex}
            onClick={() =>
              set({
                interiorLift: "darken",
                interiorLiftHex: undefined,
              })
            }
          >
            כהה יותר
          </Chip>
          <Chip
            active={value.interiorLift === "lighten" && !value.interiorLiftHex}
            onClick={() =>
              set({
                interiorLift: "lighten",
                interiorLiftHex: undefined,
              })
            }
          >
            בהיר יותר
          </Chip>
          {(value.interiorLift || value.interiorLiftHex) && (
            <Chip active={false} onClick={clearInterior}>
              נקה
            </Chip>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
          או גוון מדויק לפנים בלבד
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {INTERIOR_SWATCHES.map((swatch) => {
            const active =
              value.interiorLiftHex?.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                className={active ? "btn btn-primary" : "btn btn-ghost"}
                onClick={() =>
                  set({
                    interiorLiftHex: swatch.hex,
                    interiorLift: undefined,
                  })
                }
                style={{ height: 34 }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 99,
                    background: swatch.hex,
                    border: "1px solid rgba(0,0,0,.2)",
                  }}
                />
                {swatch.label}
              </button>
            );
          })}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(value.interiorLiftHex || "")
                  ? value.interiorLiftHex
                  : "#3A3A3A"
              }
              onChange={(e) =>
                set({
                  interiorLiftHex: e.target.value,
                  interiorLift: undefined,
                })
              }
              style={{ width: 36, height: 32, border: 0, background: "none" }}
            />
            מותאם
          </label>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          מספר מדפים
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 36, height: 36, padding: 0 }}
            disabled={!value.shelfCount || value.shelfCount <= 1}
            onClick={() =>
              set({
                shelfCount: Math.max(1, (value.shelfCount || 2) - 1),
              })
            }
          >
            −
          </button>
          <input
            className="input"
            inputMode="numeric"
            value={value.shelfCount ? String(value.shelfCount) : ""}
            placeholder="—"
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                set({ shelfCount: undefined });
                return;
              }
              const n = Number(raw);
              if (!Number.isInteger(n)) return;
              set({ shelfCount: Math.max(1, Math.min(20, n)) });
            }}
            style={{
              width: 64,
              height: 36,
              textAlign: "center",
              fontWeight: 700,
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 36, height: 36, padding: 0 }}
            disabled={(value.shelfCount || 0) >= 20}
            onClick={() =>
              set({
                shelfCount: Math.min(20, (value.shelfCount || 0) + 1),
              })
            }
          >
            +
          </button>
          {value.shelfCount ? (
            <Chip active={false} onClick={() => set({ shelfCount: undefined })}>
              נקה
            </Chip>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
          זה מספר היעד. המדפים יתפזרו באופן שווה — המדף התחתון לא יושב
          על הרצפה (לא כולל מגירות וצידי דלת)
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          צבע פס מדף
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["black", "white"] as ShelfTrim[]).map((id) => (
            <Chip
              key={id}
              active={value.shelfTrim === id}
              onClick={() =>
                set({
                  shelfTrim: value.shelfTrim === id ? undefined : id,
                })
              }
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 99,
                  background: SHELF_TRIM_HEX[id],
                  border: "1px solid rgba(0,0,0,.2)",
                }}
              />
              {id === "black" ? "שחור" : "לבן"}
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
          רק רצועת החזית של כל מדף — לא הזכוכית ולא הקירות
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          תאורת מדפים
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip
            active={!!value.shelfLed}
            onClick={() =>
              set({
                shelfLed: value.shelfLed ? undefined : true,
              })
            }
          >
            תאורה עדינה בכל מדף
          </Chip>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
          אור לבן קטן על כל מדף — בלי לראות את הפס עצמו
        </div>
      </div>
    </div>
  );
};

export const ProductFixSection: React.FC<{
  value: ProductFixOptions;
  onChange: (next: ProductFixOptions) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(() => hasProductFix(value));
  const active = hasProductFix(value);

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--bg-card-hi)",
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
          <div style={{ fontSize: 13, fontWeight: 650 }}>
            תיקוני מוצר{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>
              · אופציונלי
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
            {active
              ? summarizeProductFix(value)
              : "הבהרת פנים · מספר מדפים · צבע פס מדף · תאורת מדפים"}
          </div>
        </div>
        <II.ChevronDown
          size={16}
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .2s",
          }}
        />
      </button>
      {open && (
        <div
          style={{
            marginTop: 12,
            padding: 16,
            border: "1px solid var(--hair)",
            borderRadius: 12,
            background: "var(--bg-paper)",
          }}
        >
          <ProductFixControls value={value} onChange={onChange} compact />
        </div>
      )}
    </div>
  );
};

export function summarizeProductFix(fix: ProductFixOptions): string {
  const bits: string[] = [];
  if (fix.interiorLiftHex) bits.push(`פנים ${fix.interiorLiftHex}`);
  else if (fix.interiorLift === "lighten") bits.push("פנים בהירים יותר");
  else if (fix.interiorLift === "darken") bits.push("פנים כהים יותר");
  if (fix.shelfCount) bits.push(`${fix.shelfCount} מדפים`);
  if (fix.shelfTrim === "white") bits.push("פס מדף לבן");
  else if (fix.shelfTrim === "black") bits.push("פס מדף שחור");
  if (fix.shelfLed) bits.push("תאורת מדפים עדינה");
  return bits.join(" · ");
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/png";
  const binary = atob(b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

async function urlToLocalFile(url: string, filename: string): Promise<File> {
  if (url.startsWith("data:")) return dataUrlToFile(url, filename);
  if (url.startsWith("blob:")) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || "image/png" });
  }
  const res = await fetch("/api/fetch-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `שגיאה בהורדת התמונה (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

export async function runProductFix(args: {
  beforeUrl: string;
  afterUrl: string;
  name: string;
  fix: ProductFixOptions;
  quality?: "low" | "medium" | "high" | "auto";
}): Promise<{ afterUrl: string; afterBase64: string }> {
  if (!hasProductFix(args.fix)) {
    throw new Error("לא נבחר תיקון.");
  }
  const safeName =
    args.name.replace(/[^\w\u0590-\u05FF]+/g, "_").slice(0, 80) || "product";
  const [beforeFile, afterFile] = await Promise.all([
    urlToLocalFile(args.beforeUrl, `${safeName}-before.png`),
    urlToLocalFile(args.afterUrl, `${safeName}-after.png`),
  ]);

  const form = new FormData();
  form.append("image", beforeFile);
  form.append("previousResult", afterFile);
  form.append("quality", args.quality || "high");
  form.append("size", "1024x1024");
  form.append("mode", "single");
  appendProductFixToForm(form, args.fix);

  const res = await fetch("/api/process", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `שגיאה בתיקון (${res.status})`);
  }
  const raw = data.imageBase64 ?? data.image;
  if (!raw || typeof raw !== "string") {
    throw new Error("המודל לא החזיר תמונה");
  }
  if (raw.startsWith("data:")) {
    const afterBase64 = raw.split(",")[1];
    if (!afterBase64) throw new Error("המודל לא החזיר תמונה");
    return { afterUrl: raw, afterBase64 };
  }
  return {
    afterUrl: `data:image/png;base64,${raw}`,
    afterBase64: raw,
  };
}

export type ProductFixTarget = {
  productId: number;
  name: string;
  beforeUrl: string;
  afterUrl: string;
};

export const ProductFixModal: React.FC<{
  target: ProductFixTarget;
  extraCount?: number;
  onClose: () => void;
  onApply: (
    fix: ProductFixOptions,
    applyToAll: boolean
  ) => Promise<void>;
}> = ({ target, extraCount = 0, onClose, onApply }) => {
  const [fix, setFix] = useState<ProductFixOptions>({});
  const [applyToAll, setApplyToAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canApply = hasProductFix(fix);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  return (
    <div className="overlay" onClick={() => !submitting && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 860 }}
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              תיקון מוצר
            </div>
            <h2 className="h-1" style={{ margin: 0 }}>
              {target.name}
            </h2>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="סגור"
          >
            <II.X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="product-fix-layout">
            <div
              style={{
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid var(--hair)",
                background: "#fff",
                aspectRatio: "1 / 1",
              }}
            >
              <img
                src={target.afterUrl}
                alt={target.name}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
            <ProductFixControls value={fix} onChange={setFix} />
          </div>
          {error && (
            <div
              style={{
                marginTop: 16,
                color: "var(--bad)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot" style={{ flexWrap: "wrap" }}>
          {extraCount > 0 ? (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={applyToAll}
                disabled={submitting}
                onChange={(e) => setApplyToAll(e.target.checked)}
              />
              החל גם על {extraCount} תמונות נוספות שאושרו
            </label>
          ) : (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              התיקון רץ על התוצאה הנוכחית בלבד
            </span>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              ביטול
            </button>
            <button
              className="btn btn-primary"
              disabled={!canApply || submitting}
              onClick={async () => {
                if (!canApply) return;
                setSubmitting(true);
                setError(null);
                try {
                  await onApply(fix, applyToAll && extraCount > 0);
                  onClose();
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "התיקון נכשל"
                  );
                  setSubmitting(false);
                }
              }}
              style={{ opacity: canApply && !submitting ? 1 : 0.5 }}
            >
              {submitting ? (
                <>
                  <Spinner size={15} /> מתקן…
                </>
              ) : (
                <>
                  <II.Wand size={22} scale={1.3} /> הפעל תיקון
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export type { ProductFixOptions };
