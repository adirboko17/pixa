"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BlueprintCrop,
  BlueprintLayout,
  BlueprintPlate,
} from "@/lib/blueprint-annotations";
import { Icons } from "./icons";

const II = Icons;

function fmtNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function labelAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

function plateNormal(p: BlueprintPlate): { nx: number; ny: number } {
  const dx = p.b.x - p.a.x;
  const dy = p.b.y - p.a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

function plateText(p: BlueprintPlate): string {
  return p.text?.trim() ? p.text : `${fmtNum(p.valueCm)} ס״מ`;
}

function plateLabel(p: BlueprintPlate) {
  const { nx, ny } = plateNormal(p);
  const baseX =
    p.id === "height"
      ? (p.a.x + p.b.x) / 2 - 78
      : (p.a.x + p.b.x) / 2 + nx * 34;
  const baseY =
    p.id === "height"
      ? (p.a.y + p.b.y) / 2
      : (p.a.y + p.b.y) / 2 + ny * 34;
  return {
    x: baseX + (p.labelDx ?? 0),
    y: baseY + (p.labelDy ?? 0),
    angle: p.id === "height" ? 0 : labelAngle(p.a, p.b),
  };
}

function cloneLayout(layout: BlueprintLayout): BlueprintLayout {
  return {
    canvasW: layout.canvasW,
    canvasH: layout.canvasH,
    crop: layout.crop ? { ...layout.crop } : undefined,
    plates: layout.plates.map((p) => ({
      ...p,
      a: { ...p.a },
      b: { ...p.b },
    })),
  };
}

type AspectId = "free" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2";

const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: "free", label: "חופשי", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
];

function fullCrop(w: number, h: number): BlueprintCrop {
  return { x: 0, y: 0, w, h };
}

function fitAspectCrop(
  canvasW: number,
  canvasH: number,
  ratio: number | null
): BlueprintCrop {
  if (!ratio) return fullCrop(canvasW, canvasH);
  let w = canvasW;
  let h = w / ratio;
  if (h > canvasH) {
    h = canvasH;
    w = h * ratio;
  }
  return {
    x: (canvasW - w) / 2,
    y: (canvasH - h) / 2,
    w,
    h,
  };
}

function clampCrop(
  crop: BlueprintCrop,
  canvasW: number,
  canvasH: number
): BlueprintCrop {
  const w = Math.max(48, Math.min(crop.w, canvasW));
  const h = Math.max(48, Math.min(crop.h, canvasH));
  return {
    w,
    h,
    x: Math.max(0, Math.min(crop.x, canvasW - w)),
    y: Math.max(0, Math.min(crop.y, canvasH - h)),
  };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - 12 * Math.cos(ang - 0.35),
    to.y - 12 * Math.sin(ang - 0.35)
  );
  ctx.lineTo(
    to.x - 12 * Math.cos(ang + 0.35),
    to.y - 12 * Math.sin(ang + 0.35)
  );
  ctx.closePath();
  ctx.fill();
}

export async function flattenBlueprint(
  imageUrl: string,
  layout: BlueprintLayout
): Promise<string> {
  const img = new Image();
  img.src = imageUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;
  ctx.drawImage(img, 0, 0, layout.canvasW, layout.canvasH);
  ctx.strokeStyle = "#111111";
  ctx.fillStyle = "#111111";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "square";
  ctx.font = "600 28px Arial, sans-serif";
  ctx.textBaseline = "middle";

  for (const p of layout.plates) {
    ctx.beginPath();
    ctx.moveTo(p.a.x, p.a.y);
    ctx.lineTo(p.b.x, p.b.y);
    ctx.stroke();
    drawArrowHead(ctx, p.a, p.b);
    drawArrowHead(ctx, p.b, p.a);

    const loc = plateLabel(p);
    ctx.save();
    ctx.translate(loc.x, loc.y);
    ctx.rotate((loc.angle * Math.PI) / 180);
    ctx.textAlign = "left";
    ctx.direction = "ltr";
    const chars = [...plateText(p)];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((s, w) => s + w, 0);
    let x = -total / 2;
    chars.forEach((ch, i) => {
      ctx.fillText(ch, x, 0);
      x += widths[i];
    });
    ctx.restore();
  }

  const crop = layout.crop;
  if (
    crop &&
    crop.w > 8 &&
    crop.h > 8 &&
    (crop.x > 0.5 ||
      crop.y > 0.5 ||
      crop.w < layout.canvasW - 1 ||
      crop.h < layout.canvasH - 1)
  ) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(crop.w));
    out.height = Math.max(1, Math.round(crop.h));
    const octx = out.getContext("2d");
    if (!octx) return canvas.toDataURL("image/png");
    octx.drawImage(
      canvas,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      out.width,
      out.height
    );
    return out.toDataURL("image/png");
  }

  return canvas.toDataURL("image/png");
}

function DimOverlay({
  plates,
  canvasW,
  canvasH,
  interactive,
  onChange,
}: {
  plates: BlueprintPlate[];
  canvasW: number;
  canvasH: number;
  interactive?: boolean;
  onChange?: (id: BlueprintPlate["id"], next: BlueprintPlate) => void;
}) {
  const [editingId, setEditingId] = useState<BlueprintPlate["id"] | null>(null);
  const drag = useRef<
    | {
        id: BlueprintPlate["id"];
        mode: "a" | "b" | "move" | "label";
        startX: number;
        startY: number;
        orig: BlueprintPlate;
      }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toLocal = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !onChange) return;
    const loc = toLocal(e);
    const dx = loc.x - d.startX;
    const dy = loc.y - d.startY;
    if (d.mode === "move") {
      onChange(d.id, {
        ...d.orig,
        a: { x: d.orig.a.x + dx, y: d.orig.a.y + dy },
        b: { x: d.orig.b.x + dx, y: d.orig.b.y + dy },
      });
      return;
    }
    if (d.mode === "label") {
      onChange(d.id, {
        ...d.orig,
        labelDx: (d.orig.labelDx ?? 0) + dx,
        labelDy: (d.orig.labelDy ?? 0) + dy,
      });
      return;
    }
    onChange(d.id, {
      ...d.orig,
      [d.mode]: { x: d.orig[d.mode].x + dx, y: d.orig[d.mode].y + dy },
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${canvasW} ${canvasH}`}
      preserveAspectRatio="xMidYMid meet"
      direction="ltr"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        cursor: interactive ? "default" : "inherit",
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <defs>
        <marker id="bpArrE" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
          <path d="M0,0.6 L8.4,4 L0,7.4 Z" fill="#111" />
        </marker>
        <marker id="bpArrS" markerWidth="9" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M8.4,0.6 L0,4 L8.4,7.4 Z" fill="#111" />
        </marker>
      </defs>
      {plates.map((p) => {
        const loc = plateLabel(p);
        return (
          <g key={p.id}>
            <line
              x1={p.a.x}
              y1={p.a.y}
              x2={p.b.x}
              y2={p.b.y}
              stroke="transparent"
              strokeWidth={18}
              style={{ cursor: interactive ? "move" : "inherit" }}
              onPointerDown={(e) => {
                if (!interactive) return;
                e.preventDefault();
                (e.target as SVGElement).setPointerCapture(e.pointerId);
                const loc0 = toLocal(e);
                drag.current = {
                  id: p.id,
                  mode: "move",
                  startX: loc0.x,
                  startY: loc0.y,
                  orig: { ...p, a: { ...p.a }, b: { ...p.b } },
                };
              }}
            />
            <line
              x1={p.a.x}
              y1={p.a.y}
              x2={p.b.x}
              y2={p.b.y}
              stroke="#111"
              strokeWidth={2.4}
              strokeLinecap="square"
              markerStart="url(#bpArrS)"
              markerEnd="url(#bpArrE)"
              pointerEvents="none"
            />
            <g
              transform={
                loc.angle
                  ? `translate(${loc.x} ${loc.y}) rotate(${loc.angle.toFixed(2)})`
                  : `translate(${loc.x} ${loc.y})`
              }
              style={{ cursor: interactive ? "move" : "inherit" }}
              onPointerDown={(e) => {
                if (!interactive || editingId) return;
                e.preventDefault();
                e.stopPropagation();
                (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
                const loc0 = toLocal(e);
                drag.current = {
                  id: p.id,
                  mode: "label",
                  startX: loc0.x,
                  startY: loc0.y,
                  orig: { ...p, a: { ...p.a }, b: { ...p.b } },
                };
              }}
              onDoubleClick={(e) => {
                if (!interactive) return;
                e.preventDefault();
                e.stopPropagation();
                drag.current = null;
                setEditingId(p.id);
              }}
            >
              <rect
                x={-90}
                y={-22}
                width={180}
                height={40}
                rx={6}
                fill={interactive ? "rgba(255,255,255,.55)" : "none"}
                stroke={interactive ? "rgba(17,17,17,.28)" : "none"}
                strokeDasharray={interactive ? "4 3" : undefined}
              />
              {editingId === p.id && interactive && onChange ? (
                <foreignObject x={-90} y={-22} width={180} height={40}>
                  <input
                    autoFocus
                    dir="ltr"
                    defaultValue={plateText(p)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      onChange(p.id, { ...p, text: e.currentTarget.value });
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        onChange(p.id, {
                          ...p,
                          text: (e.target as HTMLInputElement).value,
                        });
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #111",
                      borderRadius: 6,
                      fontFamily: "Arial, sans-serif",
                      fontSize: 22,
                      fontWeight: 600,
                      textAlign: "center",
                      direction: "ltr",
                      unicodeBidi: "bidi-override",
                      background: "#fff",
                      color: "#111111",
                      WebkitTextFillColor: "#111111",
                      caretColor: "#111111",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </foreignObject>
              ) : (
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontFamily: "Arial, sans-serif",
                    fontSize: 28,
                    fontWeight: 600,
                    fill: "#111",
                    direction: "ltr",
                    unicodeBidi: "bidi-override",
                  }}
                >
                  {plateText(p)}
                </text>
              )}
            </g>
            {interactive &&
              (["a", "b"] as const).map((end) => (
                <circle
                  key={end}
                  cx={p[end].x}
                  cy={p[end].y}
                  r={10}
                  fill="#fff"
                  stroke="#111"
                  strokeWidth={1.6}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    (e.target as SVGElement).setPointerCapture(e.pointerId);
                    const loc0 = toLocal(e);
                    drag.current = {
                      id: p.id,
                      mode: end,
                      startX: loc0.x,
                      startY: loc0.y,
                      orig: { ...p, a: { ...p.a }, b: { ...p.b } },
                    };
                  }}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

function CropOverlay({
  crop,
  canvasW,
  canvasH,
  ratio,
  onChange,
}: {
  crop: BlueprintCrop;
  canvasW: number;
  canvasH: number;
  ratio: number | null;
  onChange: (next: BlueprintCrop) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | {
        mode: "move" | "nw" | "ne" | "sw" | "se";
        startX: number;
        startY: number;
        orig: BlueprintCrop;
      }
    | null
  >(null);

  const toLocal = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    return pt.matrixTransform(m.inverse());
  };

  const applyResize = (
    mode: "nw" | "ne" | "sw" | "se",
    dx: number,
    dy: number,
    orig: BlueprintCrop
  ) => {
    let { x, y, w, h } = orig;
    if (mode.includes("w")) {
      x = orig.x + dx;
      w = orig.w - dx;
    }
    if (mode.includes("e")) w = orig.w + dx;
    if (mode.includes("n")) {
      y = orig.y + dy;
      h = orig.h - dy;
    }
    if (mode.includes("s")) h = orig.h + dy;

    if (ratio) {
      if (mode === "se" || mode === "nw") h = w / ratio;
      else w = h * ratio;
      if (mode.includes("w")) x = orig.x + orig.w - w;
      if (mode.includes("n")) y = orig.y + orig.h - h;
    }

    onChange(clampCrop({ x, y, w, h }, canvasW, canvasH));
  };

  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const loc = toLocal(e);
    const dx = loc.x - d.startX;
    const dy = loc.y - d.startY;
    if (d.mode === "move") {
      onChange(
        clampCrop(
          { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy },
          canvasW,
          canvasH
        )
      );
      return;
    }
    applyResize(d.mode, dx, dy, d.orig);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${canvasW} ${canvasH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <path
        d={`M0 0H${canvasW}V${canvasH}H0Z M${crop.x} ${crop.y}H${crop.x + crop.w}V${crop.y + crop.h}H${crop.x}Z`}
        fill="rgba(10,10,12,.42)"
        fillRule="evenodd"
      />
      <rect
        x={crop.x}
        y={crop.y}
        width={crop.w}
        height={crop.h}
        fill="transparent"
        stroke="#fff"
        strokeWidth={2}
        style={{ pointerEvents: "auto", cursor: "move" }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          (e.target as SVGElement).setPointerCapture(e.pointerId);
          const loc = toLocal(e);
          drag.current = {
            mode: "move",
            startX: loc.x,
            startY: loc.y,
            orig: { ...crop },
          };
        }}
        onPointerMove={onDrag}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      {(["nw", "ne", "sw", "se"] as const).map((mode) => {
        const cx = mode.includes("w") ? crop.x : crop.x + crop.w;
        const cy = mode.includes("n") ? crop.y : crop.y + crop.h;
        return (
          <rect
            key={mode}
            x={cx - 8}
            y={cy - 8}
            width={16}
            height={16}
            fill="#fff"
            stroke="#111"
            strokeWidth={1.4}
            style={{
              pointerEvents: "auto",
              cursor:
                mode === "nw" || mode === "se" ? "nwse-resize" : "nesw-resize",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              (e.target as SVGElement).setPointerCapture(e.pointerId);
              const loc = toLocal(e);
              drag.current = {
                mode,
                startX: loc.x,
                startY: loc.y,
                orig: { ...crop },
              };
            }}
            onPointerMove={onDrag}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        );
      })}
    </svg>
  );
}

export function BlueprintPreview({
  imageUrl,
  layout,
}: {
  imageUrl: string;
  layout: BlueprintLayout;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background:
          "repeating-conic-gradient(#ececec 0% 25%, #fff 0% 50%) 50% / 18px 18px",
      }}
    >
      <img
        src={imageUrl}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      <DimOverlay
        plates={layout.plates}
        canvasW={layout.canvasW}
        canvasH={layout.canvasH}
      />
    </div>
  );
}

export function BlueprintEditorModal({
  imageUrl,
  layout,
  productName,
  onClose,
  onSave,
}: {
  imageUrl: string;
  layout: BlueprintLayout;
  productName: string;
  onClose: () => void;
  onSave: (layout: BlueprintLayout) => void;
}) {
  const [draft, setDraft] = useState(() => cloneLayout(layout));
  const [aspect, setAspect] = useState<AspectId>("free");
  const [crop, setCrop] = useState<BlueprintCrop>(
    () => layout.crop ?? fullCrop(layout.canvasW, layout.canvasH)
  );
  const [showCrop, setShowCrop] = useState(true);
  const draftRef = useRef(draft);
  const cropRef = useRef(crop);
  const onSaveRef = useRef(onSave);
  draftRef.current = draft;
  cropRef.current = crop;
  onSaveRef.current = onSave;

  const persist = useCallback(() => {
    onSaveRef.current({ ...draftRef.current, crop: cropRef.current });
  }, []);

  useEffect(() => {
    persist();
  }, [draft, crop, persist]);

  const updatePlate = useCallback((id: BlueprintPlate["id"], next: BlueprintPlate) => {
    setDraft((prev) => ({
      ...prev,
      plates: prev.plates.map((p) => (p.id === id ? next : p)),
    }));
  }, []);

  const applyAspect = (id: AspectId) => {
    setAspect(id);
    const spec = ASPECTS.find((a) => a.id === id);
    setCrop(fitAspectCrop(draft.canvasW, draft.canvasH, spec?.ratio ?? null));
  };

  const closeAndKeep = useCallback(() => {
    persist();
    onClose();
  }, [persist, onClose]);

  const downloadNow = async () => {
    const next = { ...draftRef.current, crop: cropRef.current };
    persist();
    const href = await flattenBlueprint(imageUrl, next);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${productName.replace(/[^\w\u0590-\u05FF]+/g, "_")}_blueprint.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAndKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAndKeep]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(10,10,12,.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={closeAndKeep}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(96vw, 1200px)",
          height: "min(94vh, 920px)",
          background: "var(--bg-card, #fff)",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 30px 80px rgba(0,0,0,.28)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 14,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              עריכת מידות
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{productName}</div>
            <p className="text-2" style={{ marginTop: 6, fontSize: 13 }}>
              גרור קו / טקסט · לחיצה כפולה לעריכה · חיתוך לפי יחס או ידני
            </p>
          </div>
          <button className="icon-btn" onClick={closeAndKeep} title="סגור">
            <II.X size={16} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <button
            className={`btn btn-ghost${showCrop ? "" : ""}`}
            onClick={() => setShowCrop((v) => !v)}
            style={{
              borderColor: showCrop ? "var(--ink)" : undefined,
              fontSize: 12,
            }}
          >
            {showCrop ? "הסתר חיתוך" : "הצג חיתוך"}
          </button>
          {ASPECTS.map((item) => (
            <button
              key={item.id}
              className="btn btn-ghost"
              onClick={() => {
                setShowCrop(true);
                applyAspect(item.id);
              }}
              style={{
                fontSize: 12,
                minWidth: 52,
                borderColor: aspect === item.id ? "var(--ink)" : undefined,
                fontWeight: aspect === item.id ? 700 : 500,
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              setAspect("free");
              setCrop(fullCrop(draft.canvasW, draft.canvasH));
            }}
          >
            איפוס
          </button>
        </div>

        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 240,
            background:
              "repeating-conic-gradient(#ececec 0% 25%, #fff 0% 50%) 50% / 18px 18px",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <img
            src={imageUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />
          <DimOverlay
            plates={draft.plates}
            canvasW={draft.canvasW}
            canvasH={draft.canvasH}
            interactive
            onChange={updatePlate}
          />
          {showCrop && (
            <CropOverlay
              crop={crop}
              canvasW={draft.canvasW}
              canvasH={draft.canvasH}
              ratio={ASPECTS.find((a) => a.id === aspect)?.ratio ?? null}
              onChange={setCrop}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 12,
            flexShrink: 0,
          }}
        >
          <button className="btn btn-ghost" onClick={closeAndKeep}>
            סגור
          </button>
          <button className="btn btn-primary" onClick={downloadNow}>
            <II.Download size={15} /> הורד עם השינויים
          </button>
        </div>
      </div>
    </div>
  );
}
