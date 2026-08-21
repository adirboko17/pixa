import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

export type BlueprintDims = {
  widthCm: number;
  heightCm: number;
  depthCm: number;
};

export type BlueprintPlate = {
  id: "height" | "width" | "depth";
  valueCm: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Extra shift of the text block, in image pixels. */
  labelDx?: number;
  labelDy?: number;
  /** Full label, e.g. "205 ס״מ". Defaults to the value + ס״מ. */
  text?: string;
};

export type BlueprintCrop = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BlueprintLayout = {
  canvasW: number;
  canvasH: number;
  plates: BlueprintPlate[];
  crop?: BlueprintCrop;
};

function fmtNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadDimFontCss(): Promise<string> {
  const candidates = [
    process.env.WINDIR && path.join(process.env.WINDIR, "Fonts", "arial.ttf"),
    process.env.WINDIR && path.join(process.env.WINDIR, "Fonts", "segoeui.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter((p): p is string => Boolean(p));

  for (const file of candidates) {
    try {
      const buf = await readFile(file);
      return `
        @font-face {
          font-family: "DimFont";
          src: url("data:font/ttf;base64,${buf.toString("base64")}") format("truetype");
          font-weight: 600;
        }
      `;
    } catch {
      // try next
    }
  }
  return "";
}

type Pt = { x: number; y: number };
type Edge = { a: Pt; b: Pt };

type ProductGeometry = {
  imgW: number;
  imgH: number;
  side: "left" | "right";
  center: Pt;
  roof: number;
  wheels: number;
  productLeft: number;
  heightTickTop: Pt;
  heightTickBot: Pt;
  widthEdge: Edge;
  depthEdge: Edge;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[i];
}

function yOnLine(fit: { slope: number; intercept: number }, x: number): number {
  return fit.slope * x + fit.intercept;
}

function fitLine(pts: Pt[]): { slope: number; intercept: number } {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: pts[0]?.y ?? 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const den = n * sxx - sx * sx;
  const slope = Math.abs(den) < 1e-6 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function smoothProfile(profile: Pt[], radius: number): Pt[] {
  const r = Math.max(1, radius);
  return profile.map((p, i) => {
    let s = 0;
    let c = 0;
    for (let k = i - r; k <= i + r; k++) {
      if (k < 0 || k >= profile.length) continue;
      s += profile[k].y;
      c += 1;
    }
    return { x: p.x, y: s / c };
  });
}

/** Split where the receding side (steep) meets the front (flatter). */
function bestSplit(profile: Pt[], side: "left" | "right"): number {
  const lo = Math.max(3, Math.round(profile.length * 0.12));
  const hi = Math.max(lo + 1, Math.round(profile.length * 0.46));
  let best = side === "left" ? lo : profile.length - 1 - lo;
  let bestScore = -Infinity;
  if (side === "left") {
    for (let i = lo; i <= hi; i++) {
      const sideFit = fitLine(profile.slice(0, i + 1));
      const frontFit = fitLine(profile.slice(i));
      const score = Math.abs(sideFit.slope) - Math.abs(frontFit.slope);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  } else {
    for (let i = profile.length - 1 - hi; i <= profile.length - 1 - lo; i++) {
      const frontFit = fitLine(profile.slice(0, i + 1));
      const sideFit = fitLine(profile.slice(i));
      const score = Math.abs(sideFit.slope) - Math.abs(frontFit.slope);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

function distToLine(p: Pt, slope: number, intercept: number): number {
  return Math.abs(p.y - (slope * p.x + intercept));
}

function ransacFit(
  pts: Pt[],
  thresh = 2.8,
  iters = 140
): { slope: number; intercept: number } {
  if (pts.length < 3) return fitLine(pts);

  let bestInliers: Pt[] = [];
  for (let i = 0; i < iters; i++) {
    const i1 = Math.floor(Math.random() * pts.length);
    let i2 = Math.floor(Math.random() * pts.length);
    if (i2 === i1) i2 = (i2 + 1) % pts.length;
    const a = pts[i1];
    const b = pts[i2];
    if (Math.abs(a.x - b.x) < 3) continue;
    const slope = (b.y - a.y) / (b.x - a.x);
    const intercept = a.y - slope * a.x;
    const inliers = pts.filter((p) => distToLine(p, slope, intercept) <= thresh);
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }

  return fitLine(bestInliers.length >= 4 ? bestInliers : pts);
}

function intersectFits(
  a: { slope: number; intercept: number },
  b: { slope: number; intercept: number }
): Pt | null {
  const den = a.slope - b.slope;
  if (Math.abs(den) < 1e-4) return null;
  const x = (b.intercept - a.intercept) / den;
  if (!Number.isFinite(x)) return null;
  return { x, y: yOnLine(a, x) };
}

/** Bottom of the cabinet body in this column — skip short caster blobs. */
function cabinetBottomY(
  occ: Uint8Array,
  imgW: number,
  imgH: number,
  x: number,
  fallback: number
): number {
  const minRun = Math.max(12, Math.round(imgH * 0.045));
  let run = 0;
  for (let y = imgH - 1; y >= 0; y--) {
    if (occ[y * imgW + x]) {
      run += 1;
      if (run >= minRun) return y + run - 1;
    } else {
      run = 0;
    }
  }
  return fallback;
}

async function analyzeProduct(png: Buffer): Promise<ProductGeometry | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: imgW, height: imgH, channels } = info;
  if (channels < 4) return null;

  const opaque = (i: number) => data[i * channels + 3] >= 40;
  const total = imgW * imgH;
  const seen = new Uint8Array(total);
  let best: number[] = [];

  const flood = (start: number) => {
    const q = [start];
    seen[start] = 1;
    const blob = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const idx = q[qi];
      const x = idx % imgW;
      const y = (idx - x) / imgW;
      const tryN = (n: number) => {
        if (n < 0 || n >= total || seen[n] || !opaque(n)) return;
        seen[n] = 1;
        q.push(n);
        blob.push(n);
      };
      if (x + 1 < imgW) tryN(idx + 1);
      if (x > 0) tryN(idx - 1);
      if (y + 1 < imgH) tryN(idx + imgW);
      if (y > 0) tryN(idx - imgW);
    }
    return blob;
  };

  for (let i = 0; i < total; i++) {
    if (seen[i] || !opaque(i)) continue;
    const blob = flood(i);
    if (blob.length > best.length) best = blob;
  }
  if (best.length < 80) return null;

  const occ = new Uint8Array(total);
  const colCount = new Uint32Array(imgW);
  const topY = new Int32Array(imgW).fill(-1);
  const botY = new Int32Array(imgW).fill(-1);
  let cx = 0;
  let cy = 0;
  for (const i of best) {
    const x = i % imgW;
    const y = (i - x) / imgW;
    occ[i] = 1;
    colCount[x] += 1;
    if (topY[x] < 0 || y < topY[x]) topY[x] = y;
    if (y > botY[x]) botY[x] = y;
    cx += x;
    cy += y;
  }
  cx /= best.length;
  cy /= best.length;

  const minCol = Math.max(8, Math.round(imgH * 0.025));
  const xs: number[] = [];
  const bodyBot = new Int32Array(imgW).fill(-1);
  for (let x = 0; x < imgW; x++) {
    if (colCount[x] >= minCol && botY[x] >= 0) {
      xs.push(x);
      bodyBot[x] = cabinetBottomY(occ, imgW, imgH, x, botY[x]);
    }
  }
  if (xs.length < 12) return null;

  const rawProfile: Pt[] = [];
  for (const x of xs) rawProfile.push({ x, y: bodyBot[x] });
  const profile = smoothProfile(
    rawProfile,
    Math.max(2, Math.round(rawProfile.length * 0.015))
  );

  const endN = Math.max(10, Math.round(profile.length * 0.26));
  const leftFit = fitLine(profile.slice(0, endN));
  const rightFit = fitLine(profile.slice(profile.length - endN));
  const side: "left" | "right" =
    Math.abs(leftFit.slope) > Math.abs(rightFit.slope) + 0.03 ? "left" : "right";

  const split = bestSplit(profile, side);
  const frontPts =
    side === "left" ? profile.slice(split) : profile.slice(0, split + 1);
  const sidePts =
    side === "left" ? profile.slice(0, split + 1) : profile.slice(split);
  if (frontPts.length < 4 || sidePts.length < 3) return null;

  const frontFit = ransacFit(frontPts);
  const sideFit = ransacFit(sidePts);
  const frontOuter: Pt = {
    x: side === "left" ? frontPts[frontPts.length - 1].x : frontPts[0].x,
    y: 0,
  };
  frontOuter.y = yOnLine(frontFit, frontOuter.x);
  const sideOuter: Pt = {
    x: side === "left" ? sidePts[0].x : sidePts[sidePts.length - 1].x,
    y: 0,
  };
  sideOuter.y = yOnLine(sideFit, sideOuter.x);

  const hit = intersectFits(frontFit, sideFit);
  const minX = Math.min(frontOuter.x, sideOuter.x);
  const maxX = Math.max(frontOuter.x, sideOuter.x);
  const corner: Pt =
    hit && hit.x > minX + 2 && hit.x < maxX - 2
      ? hit
      : {
          x: side === "left" ? frontPts[0].x : frontPts[frontPts.length - 1].x,
          y: yOnLine(
            frontFit,
            side === "left" ? frontPts[0].x : frontPts[frontPts.length - 1].x
          ),
        };

  const frontLeftX = Math.min(frontOuter.x, corner.x);
  const band = Math.max(6, Math.round((frontPts[frontPts.length - 1].x - frontPts[0].x) * 0.04));
  const bandTops: number[] = [];
  const bandBots: number[] = [];
  for (let x = Math.round(frontLeftX); x <= Math.round(frontLeftX) + band; x++) {
    if (x < 0 || x >= imgW) continue;
    if (colCount[x] >= minCol && topY[x] >= 0) {
      bandTops.push(topY[x]);
      bandBots.push(botY[x]);
    }
  }
  if (bandTops.length < 2) return null;
  const roof = Math.min(...bandTops);
  const wheels = Math.max(...bandBots);

  return {
    imgW,
    imgH,
    side,
    center: { x: cx, y: cy },
    roof,
    wheels,
    productLeft: frontLeftX,
    heightTickTop: { x: frontLeftX, y: roof },
    heightTickBot: { x: frontLeftX, y: wheels },
    widthEdge: { a: frontOuter, b: corner },
    depthEdge: { a: corner, b: sideOuter },
  };
}

function arrowLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = 2.4
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111111" stroke-width="${stroke}" stroke-linecap="square" marker-start="url(#arrS)" marker-end="url(#arrE)"/>`;
}

function shift(p: Pt, ox: number, oy: number): Pt {
  return { x: p.x + ox, y: p.y + oy };
}

function offsetAway(
  a: Pt,
  b: Pt,
  dist: number,
  origin: Pt
): { a: Pt; b: Pt; nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let nx = -dy;
  let ny = dx;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  if (nx * (origin.x - midX) + ny * (origin.y - midY) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    a: { x: a.x + nx * dist, y: a.y + ny * dist },
    b: { x: b.x + nx * dist, y: b.y + ny * dist },
    nx,
    ny,
  };
}

function labelAngle(a: Pt, b: Pt): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

async function renderDimLabelPng(
  n: number,
  fontCss: string
): Promise<{ href: string; w: number; h: number }> {
  const num = esc(fmtNum(n));
  const w = Math.max(160, 20 * num.length + 86);
  const h = 46;
  const unitX = 10 + num.length * 17 + 12;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <style>
      ${fontCss}
      .d { font-family: "DimFont", Arial, sans-serif; font-size: 28px; font-weight: 600; fill: #111111; }
    </style>
  </defs>
  <text class="d" x="8" y="32">${num}</text>
  <text class="d" x="${unitX}" y="32">מ</text>
  <text class="d" x="${unitX + 18}" y="32">"</text>
  <text class="d" x="${unitX + 30}" y="32">ס</text>
</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return {
    href: `data:image/png;base64,${buf.toString("base64")}`,
    w: meta.width ?? w,
    h: meta.height ?? h,
  };
}

function labelImage(
  href: string,
  w: number,
  h: number,
  cx: number,
  cy: number,
  angle = 0
): string {
  const t =
    angle === 0
      ? `translate(${cx - w / 2} ${cy - h / 2})`
      : `translate(${cx} ${cy}) rotate(${angle.toFixed(2)}) translate(${-w / 2} ${-h / 2})`;
  return `<image href="${href}" xlink:href="${href}" x="0" y="0" width="${w}" height="${h}" transform="${t}"/>`;
}

export async function prepareBlueprintPlate(
  png: Buffer,
  dims: BlueprintDims
): Promise<{ png: Buffer; layout: BlueprintLayout }> {
  const g = await analyzeProduct(png);
  const padL = 260;
  const padR = g?.side === "right" ? 180 : 80;
  const padT = 56;
  const padB = 170;
  const imgW = g?.imgW ?? (await sharp(png).metadata()).width ?? 1536;
  const imgH = g?.imgH ?? (await sharp(png).metadata()).height ?? 1024;
  const canvasW = imgW + padL + padR;
  const canvasH = imgH + padT + padB;
  const padded = await sharp(png)
    .ensureAlpha()
    .extend({
      top: padT,
      bottom: padB,
      left: padL,
      right: padR,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  if (!g) {
    return { png: padded, layout: { canvasW, canvasH, plates: [] } };
  }

  const ox = padL;
  const oy = padT;
  const origin = shift(g.center, ox, oy);
  const roof = oy + g.roof;
  const wheels = oy + g.wheels;
  const heightX = Math.max(150, ox + g.productLeft - 48);
  const widthE = {
    a: shift(g.widthEdge.a, ox, oy),
    b: shift(g.widthEdge.b, ox, oy),
  };
  const depthE = {
    a: shift(g.depthEdge.a, ox, oy),
    b: shift(g.depthEdge.b, ox, oy),
  };
  const widthDim = offsetAway(widthE.a, widthE.b, 42, origin);
  const depthDim = offsetAway(depthE.a, depthE.b, 38, origin);

  return {
    png: padded,
    layout: {
      canvasW,
      canvasH,
      plates: [
        {
          id: "height",
          valueCm: dims.heightCm,
          a: { x: heightX, y: roof },
          b: { x: heightX, y: wheels },
        },
        {
          id: "width",
          valueCm: dims.widthCm,
          a: widthDim.a,
          b: widthDim.b,
        },
        {
          id: "depth",
          valueCm: dims.depthCm,
          a: depthDim.a,
          b: depthDim.b,
        },
      ],
    },
  };
}

/**
 * Composite crisp vector dimension lines + Hebrew labels onto a transparent
 * product drawing. Catalog plate: height is always vertical.
 */
export async function annotateBlueprintDrawing(
  png: Buffer,
  dims: BlueprintDims
): Promise<Buffer> {
  const { png: product, layout } = await prepareBlueprintPlate(png, dims);
  if (layout.plates.length === 0) return product;

  const height = layout.plates.find((p) => p.id === "height")!;
  const width = layout.plates.find((p) => p.id === "width")!;
  const depth = layout.plates.find((p) => p.id === "depth")!;
  const { canvasW, canvasH } = layout;

  const widthDim = { a: width.a, b: width.b, nx: 0, ny: 1 };
  const depthDim = { a: depth.a, b: depth.b, nx: 0, ny: 1 };
  const wx = width.b.x - width.a.x;
  const wy = width.b.y - width.a.y;
  const wlen = Math.hypot(wx, wy) || 1;
  widthDim.nx = -wy / wlen;
  widthDim.ny = wx / wlen;
  const dx = depth.b.x - depth.a.x;
  const dy = depth.b.y - depth.a.y;
  const dlen = Math.hypot(dx, dy) || 1;
  depthDim.nx = -dy / dlen;
  depthDim.ny = dx / dlen;

  const fontCss = await loadDimFontCss();
  const [hLbl, wLbl, dLbl] = await Promise.all([
    renderDimLabelPng(dims.heightCm, fontCss),
    renderDimLabelPng(dims.widthCm, fontCss),
    renderDimLabelPng(dims.depthCm, fontCss),
  ]);

  const heightLabelX = height.a.x - 18 - hLbl.w / 2;
  const heightLabelY = (height.a.y + height.b.y) / 2;
  const widthMid = {
    x: (widthDim.a.x + widthDim.b.x) / 2 + widthDim.nx * 36,
    y: (widthDim.a.y + widthDim.b.y) / 2 + widthDim.ny * 36,
  };
  const depthMid = {
    x: (depthDim.a.x + depthDim.b.x) / 2 + depthDim.nx * 30,
    y: (depthDim.a.y + depthDim.b.y) / 2 + depthDim.ny * 30,
  };

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <style>
      ${fontCss}
    </style>
    <marker id="arrE" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
      <path d="M0,0.6 L8.4,4 L0,7.4 Z" fill="#111111"/>
    </marker>
    <marker id="arrS" markerWidth="9" markerHeight="8" refX="1" refY="4" orient="auto">
      <path d="M8.4,0.6 L0,4 L8.4,7.4 Z" fill="#111111"/>
    </marker>
  </defs>

  ${arrowLine(height.a.x, height.a.y, height.b.x, height.b.y)}
  ${arrowLine(width.a.x, width.a.y, width.b.x, width.b.y)}
  ${arrowLine(depth.a.x, depth.a.y, depth.b.x, depth.b.y)}

  ${labelImage(hLbl.href, hLbl.w, hLbl.h, heightLabelX, heightLabelY)}
  ${labelImage(wLbl.href, wLbl.w, wLbl.h, widthMid.x, widthMid.y, labelAngle(width.a, width.b))}
  ${labelImage(dLbl.href, dLbl.w, dLbl.h, depthMid.x, depthMid.y, labelAngle(depth.a, depth.b))}
</svg>`;

  const overlay = await sharp(Buffer.from(svg)).png().toBuffer();

  return sharp(product)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
