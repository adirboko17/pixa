// Client-side metadata for batch items (product ids for publish from history).

const META_KEY = "photospro:batch-item-meta";

export type BatchItemSourceType = "shopify" | "custom-api" | "upload";

export type BatchItemMeta = {
  sourceType: BatchItemSourceType;
  shopifyProductId?: number;
  externalProductId?: string;
  productId?: number;
  blueprintLayout?: unknown;
};

export function patchBatchItemMeta(
  itemId: string,
  patch: Partial<BatchItemMeta>
): void {
  const prev = getBatchItemMeta(itemId);
  saveBatchItemMeta(itemId, {
    sourceType: prev?.sourceType ?? "upload",
    ...prev,
    ...patch,
  });
}

function readMetaMap(): Record<string, BatchItemMeta> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}") as Record<
      string,
      BatchItemMeta
    >;
  } catch {
    return {};
  }
}

export function saveBatchItemMeta(itemId: string, meta: BatchItemMeta): void {
  if (typeof window === "undefined" || !itemId) return;
  const map = readMetaMap();
  map[itemId] = meta;
  localStorage.setItem(META_KEY, JSON.stringify(map));
}

export function getBatchItemMeta(itemId: string): BatchItemMeta | null {
  return readMetaMap()[itemId] ?? null;
}
