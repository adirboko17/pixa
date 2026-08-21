import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { actualCostFromUsageUSD } from "@/lib/pricing";
import { parseCm } from "@/lib/product-dimensions";
import { prepareBlueprintPlate } from "@/lib/blueprint-annotations";

export const runtime = "nodejs";
export const maxDuration = 300;

function pickMime(name: string, fallback = "image/png") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  return fallback;
}

function buildBlueprintPrompt(args: { productName: string }): string {
  const name = args.productName.trim().slice(0, 180) || "industrial product";
  return `TASK: CONVERT this photograph into a manufacturer CATALOG TECHNICAL LINE DRAWING of the same product.
This is a STYLE TRANSFER, not a cutout. If the result still looks like a photo, you failed.

FORBIDDEN:
- Do NOT keep photo pixels, color photography, reflections, chrome highlights, or real-world lighting.
- Do NOT just remove the background of the source photo.
- Do NOT output a photorealistic freezer / fridge.

REQUIRED LOOK:
- Black ink outlines + soft light-gray volume shading only.
- Drawn / illustrated, like an architectural product plate or CAD catalog illustration.
- Clean, sharp, premium. Slightly 3D from gray shading — not a cartoon, not a blueprint grid.
- Pure uniform white #FFFFFF page around the drawing.

KEEP THE SAME CAMERA as the source: three-quarter view, front + one side visible.

EMPTY THE INTERIOR:
- Remove every product, package, bottle, food, label, and clutter from inside.
- Draw empty factory-new wire shelves through the glass.

KEEP THE REAL MACHINE:
- Same door count, frames, handles, vents, control panel, lock, casters/wheels.
- Product (do not print the name): "${name}"
- Do not invent a different model.

DO NOT DRAW DIMENSIONS:
- No measurement lines, arrows, ticks, rulers, numbers, Hebrew, "ס״מ", or title blocks.
- Product drawing only. We add dimensions later.

OUTPUT: square 1:1, product centered, generous white margins on every side.`;
}

/** Punch uniform page pixels to alpha, including holes inside digits (0 / 9 / ס / מ). */
async function knockoutWhiteBackground(pngBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels < 4) return pngBuffer;

  const rgb = (idx: number) => {
    const i = idx * channels;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const isNearWhite = (idx: number, minBright: number, maxDiff: number) => {
    const [r, g, b] = rgb(idx);
    const lo = Math.min(r, g, b);
    const hi = Math.max(r, g, b);
    return lo >= minBright && hi - lo <= maxDiff;
  };
  const isInk = (idx: number) => {
    const [r, g, b] = rgb(idx);
    return Math.max(r, g, b) <= 90;
  };

  const neighbors = (idx: number): number[] => {
    const x = idx % width;
    const y = (idx - x) / width;
    const out: number[] = [];
    if (x + 1 < width) out.push(idx + 1);
    if (x > 0) out.push(idx - 1);
    if (y + 1 < height) out.push(idx + width);
    if (y > 0) out.push(idx - width);
    return out;
  };

  const flood = (
    start: number,
    pred: (idx: number) => boolean,
    seen: Uint8Array
  ): number[] => {
    if (seen[start] || !pred(start)) return [];
    const blob: number[] = [];
    const q = [start];
    seen[start] = 1;
    for (let i = 0; i < q.length; i++) {
      const idx = q[i];
      blob.push(idx);
      for (const n of neighbors(idx)) {
        if (!seen[n] && pred(n)) {
          seen[n] = 1;
          q.push(n);
        }
      }
    }
    return blob;
  };

  const total = width * height;
  const page = new Uint8Array(total);

  // 1) Exterior page — flood from the frame so only background connected to the edge is cut.
  const edgeSeen = new Uint8Array(total);
  const isPage = (idx: number) => isNearWhite(idx, 225, 18);
  const edgeSeeds: number[] = [];
  for (let x = 0; x < width; x++) {
    edgeSeeds.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    edgeSeeds.push(y * width, y * width + (width - 1));
  }
  for (const s of edgeSeeds) {
    for (const p of flood(s, isPage, edgeSeen)) page[p] = 1;
  }

  let pageCount = 0;
  for (let i = 0; i < total; i++) if (page[i]) pageCount += 1;
  if (pageCount < total * 0.08) return pngBuffer;

  // 2) Counters inside glyphs: leftover near-white islands fully ringed by ink.
  //    Digit holes are small; fridge glass / shading is large or bordered by gray, not ink.
  const HOLE_MAX = Math.round(total * 0.012); // ~1.2% — a "0" is tiny, a door is not
  const HOLE_MIN = 8;
  const holeSeen = new Uint8Array(total);
  const isHoleFill = (idx: number) =>
    !page[idx] && isNearWhite(idx, 210, 28);

  for (let i = 0; i < total; i++) {
    if (holeSeen[i] || page[i] || !isHoleFill(i)) continue;
    const blob = flood(i, isHoleFill, holeSeen);
    if (blob.length < HOLE_MIN || blob.length > HOLE_MAX) continue;

    const blobSet = new Uint8Array(total);
    for (const idx of blob) blobSet[idx] = 1;
    let inkBorder = 0;
    let border = 0;
    for (const idx of blob) {
      for (const n of neighbors(idx)) {
        if (blobSet[n]) continue;
        border += 1;
        if (isInk(n) || page[n]) inkBorder += 1;
      }
    }
    if (border === 0) continue;
    // Letter counters sit inside black strokes (and sometimes already-cut page).
    if (inkBorder / border >= 0.55) {
      for (const idx of blob) page[idx] = 1;
    }
  }

  // 3) Same idea, color-agnostic: small islands fully ringed by ink
  //    (grey leftovers inside 0 / 9 / ס / מ that are not near-white).
  const leftoverSeen = new Uint8Array(total);
  const isLeftover = (idx: number) => !page[idx] && !isInk(idx);
  for (let i = 0; i < total; i++) {
    if (leftoverSeen[i] || !isLeftover(i)) continue;
    const blob = flood(i, isLeftover, leftoverSeen);
    if (blob.length < HOLE_MIN || blob.length > HOLE_MAX) continue;
    const blobSet = new Uint8Array(total);
    for (const idx of blob) blobSet[idx] = 1;
    let inkBorder = 0;
    let border = 0;
    for (const idx of blob) {
      for (const n of neighbors(idx)) {
        if (blobSet[n]) continue;
        border += 1;
        if (isInk(n) || page[n]) inkBorder += 1;
      }
    }
    if (border > 0 && inkBorder / border >= 0.7) {
      for (const idx of blob) page[idx] = 1;
    }
  }

  const out = Buffer.from(data);
  for (let p = 0; p < total; p++) {
    if (page[p]) {
      const i = p * channels;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "לא הוגדר OPENAI_API_KEY." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("image");
    const productName = (form.get("productName") as string | null)?.trim() || "";
    const widthCm = parseCm(form.get("widthCm"));
    const heightCm = parseCm(form.get("heightCm"));
    const depthCm = parseCm(form.get("depthCm"));
    const qualityRaw = ((form.get("quality") as string | null) || "high") as
      | "low"
      | "medium"
      | "high"
      | "auto";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "לא התקבל קובץ תמונה." }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "הקובץ גדול מ-20MB." },
        { status: 400 }
      );
    }
    if (!widthCm || !heightCm || !depthCm) {
      return NextResponse.json(
        { error: "חסרות מידות. הזן רוחב, גובה ועומק בס״מ." },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey });
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await toFile(buffer, file.name || "product.png", {
      type: pickMime(file.name || "product.png", file.type || "image/png"),
    });

    const result = await client.images.edit({
      model: "gpt-image-2",
      image: uploaded,
      prompt: buildBlueprintPrompt({
        productName,
      }),
      size: "1024x1024",
      quality: qualityRaw === "auto" ? "auto" : qualityRaw,
      background: "opaque",
      output_format: "png",
      n: 1,
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "המודל לא החזיר תמונה. נסה שוב." },
        { status: 502 }
      );
    }

    let pngBuffer = Buffer.from(b64, "base64");
    try {
      pngBuffer = await knockoutWhiteBackground(pngBuffer);
    } catch (e) {
      console.warn("[/api/blueprint] alpha knockout failed, returning opaque:", e);
    }
    let layout = { canvasW: 0, canvasH: 0, plates: [] as { id: string; valueCm: number; a: { x: number; y: number }; b: { x: number; y: number } }[] };
    try {
      const prepared = await prepareBlueprintPlate(pngBuffer, {
        widthCm,
        heightCm,
        depthCm,
      });
      pngBuffer = prepared.png;
      layout = prepared.layout;
    } catch (e) {
      console.warn("[/api/blueprint] dimension layout failed:", e);
    }
    const finalB64 = pngBuffer.toString("base64");

    return NextResponse.json({
      image: `data:image/png;base64,${finalB64}`,
      imageBase64: finalB64,
      layout,
      usage: result.usage ?? null,
      costUSD: actualCostFromUsageUSD(result.usage),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "שגיאה לא ידועה במהלך השרטוט.";
    const status =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    console.error("[/api/blueprint] error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
