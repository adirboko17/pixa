"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  BlueprintCrop,
  BlueprintLayout,
  BlueprintPlate,
} from "@/lib/blueprint-annotations";
import { Icons } from "./icons";
import { Spinner } from "./screens-shell";

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

function straightenPlate(p: BlueprintPlate): BlueprintPlate {
  if (p.id === "height") {
    const x = (p.a.x + p.b.x) / 2;
    return { ...p, a: { x, y: p.a.y }, b: { x, y: p.b.y } };
  }
  const dx = Math.abs(p.b.x - p.a.x);
  const dy = Math.abs(p.b.y - p.a.y);
  if (dx >= dy) {
    const y = (p.a.y + p.b.y) / 2;
    return { ...p, a: { x: p.a.x, y }, b: { x: p.b.x, y } };
  }
  const x = (p.a.x + p.b.x) / 2;
  return { ...p, a: { x, y: p.a.y }, b: { x, y: p.b.y } };
}

function constrainAxis(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number } {
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
    return { x: to.x, y: from.y };
  }
  return { x: from.x, y: to.y };
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

function DrawingStage({
  canvasW,
  canvasH,
  children,
}: {
  canvasW: number;
  canvasH: number;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw < 8 || ch < 8) return;
      const scale = Math.min(cw / canvasW, ch / canvasH);
      setBox({
        w: Math.max(1, Math.floor(canvasW * scale)),
        h: Math.max(1, Math.floor(canvasH * scale)),
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  return (
    <div
      ref={hostRef}
      style={{
        minHeight: 0,
        margin: "0 16px",
        display: "grid",
        placeItems: "center",
        background: "transparent",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          position: "relative",
          width: box.w || "100%",
          height: box.h || "100%",
          background:
            "repeating-conic-gradient(#ececec 0% 25%, #fff 0% 50%) 50% / 16px 16px",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 8px 28px rgba(0,0,0,.18)",
        }}
      >
        {children}
      </div>
    </div>
  );
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

function labelSize(p: BlueprintPlate): { w: number; h: number } {
  const text = plateText(p);
  return { w: Math.max(80, text.length * 18), h: 36 };
}

function layoutContentBounds(layout: BlueprintLayout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!layout.plates.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const tip = 14;
  for (const p of layout.plates) {
    minX = Math.min(minX, p.a.x - tip, p.b.x - tip);
    minY = Math.min(minY, p.a.y - tip, p.b.y - tip);
    maxX = Math.max(maxX, p.a.x + tip, p.b.x + tip);
    maxY = Math.max(maxY, p.a.y + tip, p.b.y + tip);
    const loc = plateLabel(p);
    const sz = labelSize(p);
    minX = Math.min(minX, loc.x - sz.w / 2);
    minY = Math.min(minY, loc.y - sz.h / 2);
    maxX = Math.max(maxX, loc.x + sz.w / 2);
    maxY = Math.max(maxY, loc.y + sz.h / 2);
  }
  return { minX, minY, maxX, maxY };
}

async function loadBlueprintImage(imageUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  if (!imageUrl.startsWith("data:") && !imageUrl.startsWith("blob:")) {
    img.crossOrigin = "anonymous";
  }
  img.src = imageUrl;
  await img.decode();
  return img;
}

function knockoutNearWhite(source: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const total = w * h;
  const isPage = (idx: number) => {
    const i = idx * 4;
    if (d[i + 3] < 18) return true;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lo = Math.min(r, g, b);
    const hi = Math.max(r, g, b);
    return lo >= 225 && hi - lo <= 18;
  };
  const seen = new Uint8Array(total);
  const q: number[] = [];
  const push = (idx: number) => {
    if (idx < 0 || idx >= total || seen[idx] || !isPage(idx)) return;
    seen[idx] = 1;
    q.push(idx);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  for (let i = 0; i < total; i++) {
    if (d[i * 4 + 3] < 18) push(i);
  }
  for (let n = 0; n < q.length; n++) {
    const idx = q[n];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x + 1 < w) push(idx + 1);
    if (x > 0) push(idx - 1);
    if (y + 1 < h) push(idx + w);
    if (y > 0) push(idx - w);
  }
  for (let idx = 0; idx < total; idx++) {
    if (!seen[idx]) continue;
    const i = idx * 4;
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = 0;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function drawAlignedImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

function opaqueBounds(canvas: HTMLCanvasElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 24) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function shiftPlates(plates: BlueprintPlate[], dx: number, dy: number) {
  return plates.map((p) => ({
    ...p,
    a: { x: p.a.x + dx, y: p.a.y + dy },
    b: { x: p.b.x + dx, y: p.b.y + dy },
  }));
}

function squareFitCanvas(
  source: HTMLCanvasElement,
  layout: BlueprintLayout,
  margin = 56
): { imageUrl: string; layout: BlueprintLayout } {
  const art = opaqueBounds(source);
  const plates = layoutContentBounds({ ...layout, canvasW: source.width, canvasH: source.height });
  const x0 = Math.min(art?.x ?? 0, plates?.minX ?? 0) - margin;
  const y0 = Math.min(art?.y ?? 0, plates?.minY ?? 0) - margin;
  const x1 = Math.max(
    (art ? art.x + art.w : source.width),
    plates?.maxX ?? source.width
  ) + margin;
  const y1 = Math.max(
    (art ? art.y + art.h : source.height),
    plates?.maxY ?? source.height
  ) + margin;
  const cutW = Math.max(64, x1 - x0);
  const cutH = Math.max(64, y1 - y0);
  const side = Math.max(cutW, cutH);
  const ox = Math.round((side - cutW) / 2);
  const oy = Math.round((side - cutH) / 2);
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const ctx = out.getContext("2d");
  if (!ctx) {
    return { imageUrl: source.toDataURL("image/png"), layout };
  }
  ctx.clearRect(0, 0, side, side);
  ctx.drawImage(source, x0, y0, cutW, cutH, ox, oy, cutW, cutH);
  const dx = ox - x0;
  const dy = oy - y0;
  return {
    imageUrl: out.toDataURL("image/png"),
    layout: {
      canvasW: side,
      canvasH: side,
      plates: shiftPlates(layout.plates, dx, dy),
    },
  };
}

function alignToLayout(
  img: HTMLImageElement,
  canvasW: number,
  canvasH: number
): HTMLCanvasElement {
  const cleaned = knockoutNearWhite(
    img,
    img.naturalWidth || img.width,
    img.naturalHeight || img.height
  );
  const aligned = document.createElement("canvas");
  aligned.width = canvasW;
  aligned.height = canvasH;
  const ctx = aligned.getContext("2d");
  if (ctx) drawAlignedImage(ctx, cleaned, canvasW, canvasH);
  return aligned;
}

function paintDimensionPlates(
  ctx: CanvasRenderingContext2D,
  plates: BlueprintPlate[]
) {
  ctx.strokeStyle = "#111111";
  ctx.fillStyle = "#111111";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "square";
  ctx.font = "600 28px Arial, sans-serif";
  ctx.textBaseline = "middle";

  for (const p of plates) {
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
}

export async function cropBlueprintImage(
  imageUrl: string,
  layout: BlueprintLayout,
  crop: BlueprintCrop
): Promise<{ imageUrl: string; layout: BlueprintLayout }> {
  const img = await loadBlueprintImage(imageUrl);
  const aligned = alignToLayout(img, layout.canvasW, layout.canvasH);
  const x = Math.max(0, Math.floor(crop.x));
  const y = Math.max(0, Math.floor(crop.y));
  const w = Math.max(1, Math.min(aligned.width - x, Math.round(crop.w)));
  const h = Math.max(1, Math.min(aligned.height - y, Math.round(crop.h)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { imageUrl, layout };
  ctx.drawImage(aligned, x, y, w, h, 0, 0, w, h);

  const croppedLayout: BlueprintLayout = {
    canvasW: w,
    canvasH: h,
    plates: shiftPlates(layout.plates, -x, -y),
  };
  return squareFitCanvas(canvas, croppedLayout);
}

export async function fitBlueprintToProduct(
  imageUrl: string,
  layout: BlueprintLayout
): Promise<{ imageUrl: string; layout: BlueprintLayout }> {
  const img = await loadBlueprintImage(imageUrl);
  const aligned = alignToLayout(img, layout.canvasW, layout.canvasH);
  return squareFitCanvas(aligned, layout);
}

export async function flattenBlueprint(
  imageUrl: string,
  layout: BlueprintLayout
): Promise<string> {
  const img = await loadBlueprintImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;
  const aligned = alignToLayout(img, layout.canvasW, layout.canvasH);
  ctx.drawImage(aligned, 0, 0);
  paintDimensionPlates(ctx, layout.plates);

  const crop = layout.crop;
  const hasCrop =
    !!crop &&
    crop.w > 8 &&
    crop.h > 8 &&
    (crop.x > 0.5 ||
      crop.y > 0.5 ||
      crop.w < layout.canvasW - 1 ||
      crop.h < layout.canvasH - 1);

  let out = canvas;
  if (hasCrop && crop) {
    const sx = Math.max(0, Math.floor(crop.x));
    const sy = Math.max(0, Math.floor(crop.y));
    const sw = Math.min(canvas.width - sx, Math.ceil(crop.w));
    const sh = Math.min(canvas.height - sy, Math.ceil(crop.h));
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, sw);
    cropped.height = Math.max(1, sh);
    const octx = cropped.getContext("2d");
    if (octx) {
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height);
      out = cropped;
    }
  }

  const bounds = layoutContentBounds(
    hasCrop && crop
      ? {
          ...layout,
          canvasW: out.width,
          canvasH: out.height,
          plates: layout.plates.map((p) => ({
            ...p,
            a: { x: p.a.x - crop.x, y: p.a.y - crop.y },
            b: { x: p.b.x - crop.x, y: p.b.y - crop.y },
          })),
          crop: undefined,
        }
      : layout
  );
  const pad = 16;
  if (
    bounds &&
    (bounds.minX < 0 ||
      bounds.minY < 0 ||
      bounds.maxX > out.width ||
      bounds.maxY > out.height)
  ) {
    const left = Math.max(0, Math.ceil(pad - bounds.minX));
    const top = Math.max(0, Math.ceil(pad - bounds.minY));
    const right = Math.max(0, Math.ceil(bounds.maxX + pad - out.width));
    const bottom = Math.max(0, Math.ceil(bounds.maxY + pad - out.height));
    const grown = document.createElement("canvas");
    grown.width = out.width + left + right;
    grown.height = out.height + top + bottom;
    const gctx = grown.getContext("2d");
    if (gctx) {
      gctx.clearRect(0, 0, grown.width, grown.height);
      gctx.drawImage(out, left, top);
      out = grown;
    }
  }

  return knockoutNearWhite(out, out.width, out.height).toDataURL("image/png");
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
      const moved: BlueprintPlate = {
        ...d.orig,
        a: { x: d.orig.a.x + dx, y: d.orig.a.y + dy },
        b: { x: d.orig.b.x + dx, y: d.orig.b.y + dy },
      };
      onChange(d.id, e.shiftKey ? straightenPlate(moved) : moved);
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
    const raw = {
      x: d.orig[d.mode].x + dx,
      y: d.orig[d.mode].y + dy,
    };
    const other = d.mode === "a" ? d.orig.b : d.orig.a;
    onChange(d.id, {
      ...d.orig,
      [d.mode]: e.shiftKey ? constrainAxis(other, raw) : raw,
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
  canUpload,
  uploading,
  uploaded,
  onUpload,
}: {
  imageUrl: string;
  layout: BlueprintLayout;
  productName: string;
  onClose: () => void;
  onSave: (layout: BlueprintLayout, nextImageUrl?: string) => void;
  canUpload?: boolean;
  uploading?: boolean;
  uploaded?: boolean;
  onUpload?: () => void | Promise<void>;
}) {
  const [workImage, setWorkImage] = useState(imageUrl);
  const [draft, setDraft] = useState(() => cloneLayout(layout));
  const [aspect, setAspect] = useState<AspectId>(
    layout.canvasW === layout.canvasH ? "1:1" : "free"
  );
  const [crop, setCrop] = useState<BlueprintCrop>(
    () => layout.crop ?? fullCrop(layout.canvasW, layout.canvasH)
  );
  const [tab, setTab] = useState<"dims" | "crop">("dims");
  const [downloading, setDownloading] = useState(false);
  const [fitting, setFitting] = useState(false);
  const holdLocalImage = useRef(false);

  useEffect(() => {
    if (holdLocalImage.current) {
      if (imageUrl.startsWith("data:") || imageUrl === workImage) {
        holdLocalImage.current = false;
      }
      return;
    }
    let cancelled = false;
    setWorkImage(imageUrl);
    void loadBlueprintImage(imageUrl)
      .then((img) => {
        if (cancelled) return;
        const cleaned = knockoutNearWhite(
          img,
          img.naturalWidth || img.width,
          img.naturalHeight || img.height
        );
        setWorkImage(cleaned.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancelled) setWorkImage(imageUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const draftRef = useRef(draft);
  const cropRef = useRef(crop);
  const onSaveRef = useRef(onSave);
  draftRef.current = draft;
  cropRef.current = crop;
  onSaveRef.current = onSave;

  const persist = useCallback((nextImageUrl?: string) => {
    const current = draftRef.current;
    const c = cropRef.current;
    const full =
      c.x <= 0.5 &&
      c.y <= 0.5 &&
      c.w >= current.canvasW - 1 &&
      c.h >= current.canvasH - 1;
    onSaveRef.current(
      { ...current, crop: full ? undefined : c },
      nextImageUrl
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => persist(), 450);
    return () => window.clearTimeout(timer);
  }, [draft, crop, persist]);

  const updatePlate = useCallback((id: BlueprintPlate["id"], next: BlueprintPlate) => {
    setDraft((prev) => ({
      ...prev,
      plates: prev.plates.map((p) => (p.id === id ? next : p)),
    }));
  }, []);

  const applyAspect = (id: AspectId) => {
    setAspect(id);
    setTab("crop");
    const spec = ASPECTS.find((a) => a.id === id);
    setCrop(fitAspectCrop(draft.canvasW, draft.canvasH, spec?.ratio ?? null));
  };

  const closeAndKeep = useCallback(() => {
    persist();
    onClose();
  }, [persist, onClose]);

  const cropIsActive = (() => {
    const c = crop;
    return (
      c.x > 1 ||
      c.y > 1 ||
      c.w < draft.canvasW - 2 ||
      c.h < draft.canvasH - 2
    );
  })();

  const applyCropAndContinue = async () => {
    if (!cropIsActive || applyingCrop) return;
    setApplyingCrop(true);
    try {
      const next = await cropBlueprintImage(workImage, draft, crop);
      holdLocalImage.current = true;
      setWorkImage(next.imageUrl);
      setDraft(next.layout);
      setCrop(fullCrop(next.layout.canvasW, next.layout.canvasH));
      setAspect(
        next.layout.canvasW === next.layout.canvasH ? "1:1" : "free"
      );
      setTab("dims");
      onSaveRef.current(next.layout, next.imageUrl);
    } finally {
      setApplyingCrop(false);
    }
  };

  const fitToProduct = async () => {
    if (fitting) return;
    setFitting(true);
    try {
      const next = await fitBlueprintToProduct(workImage, draft);
      holdLocalImage.current = true;
      setWorkImage(next.imageUrl);
      setDraft(next.layout);
      setCrop(fullCrop(next.layout.canvasW, next.layout.canvasH));
      setAspect("1:1");
      setTab("dims");
      onSaveRef.current(next.layout, next.imageUrl);
    } finally {
      setFitting(false);
    }
  };

  const downloadNow = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const next = { ...draftRef.current, crop: cropRef.current };
      persist();
      const href = await flattenBlueprint(workImage, next);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${productName.replace(/[^\w\u0590-\u05FF]+/g, "_")}_blueprint.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAndKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAndKeep]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="עריכת שרטוט"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(8,6,12,.72)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        style={{
          width: "min(100vw, 1280px)",
          height: "100%",
          maxHeight: "100dvh",
          background: "var(--bg-card, #141118)",
          borderRadius: 18,
          border: "1px solid var(--hair-2)",
          boxShadow: "0 30px 80px rgba(0,0,0,.45)",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              עריכת שרטוט
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {productName}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={closeAndKeep}
            style={{ height: 40, flexShrink: 0 }}
          >
            <II.X size={16} /> סגור
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              background: "var(--bg, rgba(255,255,255,.06))",
              borderRadius: 12,
              padding: 4,
              gap: 4,
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={() => setTab("dims")}
              style={{
                height: 40,
                fontSize: 13,
                background: tab === "dims" ? "var(--grad)" : "transparent",
                color: tab === "dims" ? "#fff" : undefined,
                border: 0,
                minWidth: 110,
              }}
            >
              <II.Ruler size={15} /> הזז מידות
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setTab("crop")}
              style={{
                height: 40,
                fontSize: 13,
                background: tab === "crop" ? "var(--grad)" : "transparent",
                color: tab === "crop" ? "#fff" : undefined,
                border: 0,
                minWidth: 110,
              }}
            >
              חיתוך
            </button>
          </div>

          {tab === "dims" ? (
            <>
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                גרור קו או מספר · Shift מיישר את הקו · לחיצה כפולה לעריכת הטקסט
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 13, height: 40 }}
                disabled={fitting}
                onClick={() => void fitToProduct()}
              >
                {fitting ? (
                  <>
                    <Spinner size={14} /> מתאים למוצר…
                  </>
                ) : (
                  "התאם למוצר 1:1"
                )}
              </button>
            </>
          ) : (
            <>
              {ASPECTS.map((item) => (
                <button
                  key={item.id}
                  className="btn btn-ghost"
                  onClick={() => applyAspect(item.id)}
                  style={{
                    fontSize: 13,
                    minWidth: 56,
                    height: 40,
                    borderColor: aspect === item.id ? "var(--ink)" : undefined,
                    fontWeight: aspect === item.id ? 700 : 500,
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button
                className="btn btn-ghost"
                style={{ fontSize: 13, height: 40 }}
                onClick={() => {
                  setAspect("free");
                  setCrop(fullCrop(draft.canvasW, draft.canvasH));
                }}
              >
                איפוס
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 13, height: 40 }}
                disabled={!cropIsActive || applyingCrop}
                onClick={() => void applyCropAndContinue()}
              >
                {applyingCrop ? (
                  <>
                    <Spinner size={14} /> שומר חיתוך…
                  </>
                ) : (
                  "שמור חיתוך והמשך"
                )}
              </button>
            </>
          )}
        </div>

        <DrawingStage canvasW={draft.canvasW} canvasH={draft.canvasH}>
          <img
            src={workImage}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "fill",
              pointerEvents: "none",
            }}
          />
          <DimOverlay
            plates={draft.plates}
            canvasW={draft.canvasW}
            canvasH={draft.canvasH}
            interactive={tab === "dims"}
            onChange={tab === "dims" ? updatePlate : undefined}
          />
          {tab === "crop" && (
            <CropOverlay
              crop={crop}
              canvasW={draft.canvasW}
              canvasH={draft.canvasH}
              ratio={ASPECTS.find((a) => a.id === aspect)?.ratio ?? null}
              onChange={setCrop}
            />
          )}
        </DrawingStage>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: 10,
            padding: 16,
            flexShrink: 0,
          }}
        >
          <button
            className="btn btn-ghost"
            onClick={closeAndKeep}
            style={{ height: 44, minWidth: 100 }}
          >
            סיום
          </button>
          {canUpload && onUpload && (
            <button
              className="btn btn-ghost"
              onClick={() => void onUpload()}
              disabled={uploading}
              style={{
                height: 44,
                color: uploaded ? "var(--ok)" : undefined,
              }}
            >
              {uploading ? (
                <>
                  <Spinner size={15} /> מעלה שרטוט…
                </>
              ) : uploaded ? (
                <>
                  <II.Check size={15} /> הועלה לאתר
                </>
              ) : (
                <>
                  <II.Upload size={15} /> העלה שרטוט לאתר
                </>
              )}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void downloadNow()}
            disabled={downloading}
            style={{ height: 44 }}
          >
            {downloading ? (
              <>
                <Spinner size={15} /> מוריד…
              </>
            ) : (
              <>
                <II.Download size={15} /> הורד עם השינויים
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
