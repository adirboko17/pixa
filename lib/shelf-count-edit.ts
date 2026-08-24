import sharp from "sharp";

export type ShelfCountPrep = {
  image: Buffer;
  mask: Buffer;
  width: number;
  height: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

function findProductBox(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  let hits = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const minC = Math.min(r, g, b);
      const maxC = Math.max(r, g, b);
      const isBackground = minC >= 232 && maxC - minC <= 12;
      if (isBackground) continue;
      hits += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  if (hits < 80 || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function interiorFromProduct(box: Box, width: number, height: number): Box {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const insetX = Math.round(w * 0.16);
  const insetTop = Math.round(h * 0.14);
  const insetBottom = Math.round(h * 0.3);
  return {
    x0: Math.max(0, box.x0 + insetX),
    y0: Math.max(0, box.y0 + insetTop),
    x1: Math.min(width - 1, box.x1 - insetX),
    y1: Math.min(height - 1, box.y1 - insetBottom),
  };
}

function fallbackInterior(width: number, height: number): Box {
  return {
    x0: Math.round(width * 0.28),
    y0: Math.round(height * 0.2),
    x1: Math.round(width * 0.72),
    y1: Math.round(height * 0.66),
  };
}

function drawHLine(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  y: number,
  x0: number,
  x1: number,
  thickness: number,
  rgb: [number, number, number]
) {
  const y0 = Math.max(0, y - Math.floor(thickness / 2));
  const y1 = Math.min(height - 1, y0 + thickness - 1);
  for (let yy = y0; yy <= y1; yy++) {
    for (let x = x0; x <= x1; x++) {
      const i = (yy * width + x) * channels;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      if (channels === 4) data[i + 3] = 255;
    }
  }
}

/**
 * Paint N magenta guide lines on the cabinet interior and build an OpenAI
 * inpaint mask (transparent = regenerate). High-fidelity models copy the
 * existing shelf count from pixels; the guides + mask force a rebuild.
 */
export async function prepareShelfCountEdit(
  pngBuffer: Buffer,
  count: number
): Promise<ShelfCountPrep> {
  const n = Math.max(1, Math.min(20, Math.round(count)));
  const img = sharp(pngBuffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const product = findProductBox(data, width, height, channels);
  const interior = product
    ? interiorFromProduct(product, width, height)
    : fallbackInterior(width, height);

  const painted = Buffer.from(data);
  const innerW = interior.x1 - interior.x0;
  const innerH = interior.y1 - interior.y0;
  const x0 = interior.x0 + Math.round(innerW * 0.04);
  const x1 = interior.x1 - Math.round(innerW * 0.04);
  const thickness = Math.max(4, Math.round(height * 0.007));
  const topClear = Math.round(innerH * 0.08);
  const floorClear = Math.round(innerH * 0.2);
  const bandTop = interior.y0 + topClear;
  const bandBottom = Math.max(bandTop + n * 10, interior.y1 - floorClear);
  const bandH = bandBottom - bandTop;

  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const y = Math.round(bandTop + t * bandH);
    drawHLine(painted, width, height, channels, y, x0, x1, thickness, [
      255, 0, 180,
    ]);
  }

  const annotated = await sharp(painted, {
    raw: { width, height, channels: channels as 3 | 4 },
  })
    .png()
    .toBuffer();

  const mask = Buffer.alloc(width * height * 4, 255);
  const pad = Math.max(4, Math.round(Math.min(innerW, innerH) * 0.02));
  const mx0 = Math.max(0, interior.x0 - pad);
  const my0 = Math.max(0, interior.y0 - pad);
  const mx1 = Math.min(width - 1, interior.x1 + pad);
  const my1 = Math.min(height - 1, interior.y1 + pad);
  for (let y = my0; y <= my1; y++) {
    for (let x = mx0; x <= mx1; x++) {
      const i = (y * width + x) * 4;
      mask[i] = 0;
      mask[i + 1] = 0;
      mask[i + 2] = 0;
      mask[i + 3] = 0;
    }
  }

  const maskPng = await sharp(mask, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return { image: annotated, mask: maskPng, width, height };
}
