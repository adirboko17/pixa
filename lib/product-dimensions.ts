export type ProductDimensions = {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  source?: "data" | "title";
};

export function parseCm(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 10_000) {
    return roundCm(value);
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.,]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n < 10_000) return roundCm(n);
  }
  return undefined;
}

function roundCm(n: number): number {
  return Math.round(n * 10) / 10;
}

function pickField(
  raw: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    if (key in raw) {
      const parsed = parseCm(raw[key]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function matchLabeled(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  return m ? parseCm(m[1]) : undefined;
}

export function parseDimensionsFromText(
  text: string
): ProductDimensions | undefined {
  if (!text.trim()) return undefined;

  const labeled = {
    widthCm: matchLabeled(text, /רוחב\s*:?\s*(\d+(?:[.,]\d+)?)/i),
    heightCm: matchLabeled(text, /גובה\s*:?\s*(\d+(?:[.,]\d+)?)/i),
    depthCm: matchLabeled(text, /עומק\s*:?\s*(\d+(?:[.,]\d+)?)/i),
  };
  if (labeled.widthCm || labeled.heightCm || labeled.depthCm) {
    return { ...labeled, source: "title" };
  }

  const triple = text.match(
    /(\d+(?:[.,]\d+)?)\s*[x×X/\u00d7]\s*(\d+(?:[.,]\d+)?)\s*[x×X/\u00d7]\s*(\d+(?:[.,]\d+)?)/
  );
  if (triple) {
    // Israeli appliance catalogs usually list width × depth × height.
    return {
      widthCm: parseCm(triple[1]),
      depthCm: parseCm(triple[2]),
      heightCm: parseCm(triple[3]),
      source: "title",
    };
  }

  return undefined;
}

export function extractDimensionsFromProduct(
  raw: Record<string, unknown>,
  title?: string
): ProductDimensions | undefined {
  const nested = raw.dimensions;
  const src =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? { ...raw, ...(nested as Record<string, unknown>) }
      : raw;

  let widthCm = pickField(src, [
    "width_cm",
    "widthCm",
    "width",
    "w",
    "רוחב",
  ]);
  let heightCm = pickField(src, [
    "height_cm",
    "heightCm",
    "height",
    "h",
    "גובה",
  ]);
  let depthCm = pickField(src, [
    "depth_cm",
    "depthCm",
    "depth",
    "d",
    "עומק",
  ]);

  let source: ProductDimensions["source"] =
    widthCm || heightCm || depthCm ? "data" : undefined;

  if (!widthCm || !heightCm || !depthCm) {
    const fromTitle = parseDimensionsFromText(
      title || String(raw.title ?? raw.name ?? "")
    );
    if (fromTitle) {
      widthCm = widthCm ?? fromTitle.widthCm;
      heightCm = heightCm ?? fromTitle.heightCm;
      depthCm = depthCm ?? fromTitle.depthCm;
      if (!source) source = "title";
    }
  }

  if (!widthCm && !heightCm && !depthCm) return undefined;
  return { widthCm, heightCm, depthCm, source };
}

export function formatDimensions(d: ProductDimensions): string {
  const parts: string[] = [];
  if (d.widthCm) parts.push(`רוחב ${d.widthCm} ס״מ`);
  if (d.heightCm) parts.push(`גובה ${d.heightCm} ס״מ`);
  if (d.depthCm) parts.push(`עומק ${d.depthCm} ס״מ`);
  return parts.join(" · ");
}

export function hasCompleteDimensions(d?: ProductDimensions | null): boolean {
  return Boolean(d?.widthCm && d?.heightCm && d?.depthCm);
}
