import type { ShopifyBackedProduct } from "@/components/pixa/data";

const AFTER_MAP_KEY = "pixa:after-product-map";
const FP_SIZE = 32;

type AfterMapEntry = {
  name: string;
  shopifyProductId?: number;
};

function readAfterMap(): Record<string, AfterMapEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(AFTER_MAP_KEY) || "{}") as Record<
      string,
      AfterMapEntry
    >;
  } catch {
    return {};
  }
}

export function saveAfterProductMap(
  afterUrl: string,
  name: string,
  shopifyProductId?: number
) {
  if (typeof window === "undefined" || !afterUrl) return;
  const map = readAfterMap();
  map[afterUrl] = { name, shopifyProductId };
  localStorage.setItem(AFTER_MAP_KEY, JSON.stringify(map));
}

export function lookupAfterProductMap(afterUrl?: string): AfterMapEntry | null {
  if (!afterUrl) return null;
  return readAfterMap()[afterUrl] ?? null;
}

async function loadImageBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch("/api/fetch-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function grayscaleFingerprint(url: string): Promise<number[] | null> {
  const bmp = await loadImageBitmap(url);
  if (!bmp) return null;
  const canvas = document.createElement("canvas");
  canvas.width = FP_SIZE;
  canvas.height = FP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, FP_SIZE, FP_SIZE);
  bmp.close?.();
  const { data } = ctx.getImageData(0, 0, FP_SIZE, FP_SIZE);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

function fingerprintDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

const shopifyFingerprintCache = new Map<string, number[]>();

async function shopifyFingerprint(
  product: ShopifyBackedProduct
): Promise<number[] | null> {
  const cached = shopifyFingerprintCache.get(product.imageUrl);
  if (cached) return cached;
  const fp = await grayscaleFingerprint(product.imageUrl);
  if (fp) shopifyFingerprintCache.set(product.imageUrl, fp);
  return fp;
}

export async function preloadShopifyFingerprints(
  shopifyProducts: ShopifyBackedProduct[]
): Promise<void> {
  const chunk = 40;
  for (let i = 0; i < shopifyProducts.length; i += chunk) {
    await Promise.all(
      shopifyProducts.slice(i, i + chunk).map((p) => shopifyFingerprint(p))
    );
  }
}

export async function matchShopifyProductByAfterImage(
  afterUrl: string,
  shopifyProducts: ShopifyBackedProduct[]
): Promise<ShopifyBackedProduct | null> {
  if (!afterUrl || shopifyProducts.length === 0) return null;

  const afterFp = await grayscaleFingerprint(afterUrl);
  if (!afterFp) return null;

  let best: ShopifyBackedProduct | null = null;
  let bestDist = Infinity;
  let secondDist = Infinity;

  const chunk = 40;
  for (let i = 0; i < shopifyProducts.length; i += chunk) {
    const slice = shopifyProducts.slice(i, i + chunk);
    const fps = await Promise.all(slice.map((p) => shopifyFingerprint(p)));
    fps.forEach((fp, idx) => {
      if (!fp) return;
      const dist = fingerprintDistance(afterFp, fp);
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        best = slice[idx];
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    });
  }

  // Require a confident match: low average diff and clear gap to runner-up.
  if (!best || bestDist > 50 || bestDist * 1.08 > secondDist) return null;
  return best;
}

export function isLegacyBatchProductName(name: string): boolean {
  return name.startsWith("עיצוב · ") || name === "מוצר מעוצב";
}

export async function resolveShopifyProductName(
  afterUrl: string | undefined,
  beforeUrl: string | undefined,
  productName: string,
  shopifyProductId: number | undefined,
  shopifyProducts: ShopifyBackedProduct[]
): Promise<{ name: string; shopifyProductId?: number } | null> {
  if (shopifyProductId && shopifyProducts.length > 0) {
    const byId = shopifyProducts.find((p) => p.id === shopifyProductId);
    if (byId) return { name: byId.name, shopifyProductId: byId.id };
  }

  if (beforeUrl && shopifyProducts.length > 0) {
    const normalized = beforeUrl.split("?")[0];
    const byImage = shopifyProducts.find(
      (p) => p.imageUrl.split("?")[0] === normalized
    );
    if (byImage) return { name: byImage.name, shopifyProductId: byImage.id };
  }

  const mapped = lookupAfterProductMap(afterUrl);
  if (mapped?.name) {
    return {
      name: mapped.name,
      shopifyProductId: mapped.shopifyProductId,
    };
  }

  if (!isLegacyBatchProductName(productName)) {
    return { name: productName, shopifyProductId };
  }

  if (afterUrl && shopifyProducts.length > 0) {
    const matched = await matchShopifyProductByAfterImage(
      afterUrl,
      shopifyProducts
    );
    if (matched) {
      saveAfterProductMap(afterUrl, matched.name, matched.id);
      return { name: matched.name, shopifyProductId: matched.id };
    }
  }

  return null;
}
