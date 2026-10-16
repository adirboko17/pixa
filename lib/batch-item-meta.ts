// Small ids only — never persist blueprint layouts or images here.
// Layouts live in React state + batch_items.blueprint_layout.

const META_KEY = "photospro:batch-item-meta";
const MAX_ENTRIES = 80;

export type BatchItemSourceType = "shopify" | "custom-api" | "upload";

export type BatchItemMeta = {
  sourceType: BatchItemSourceType;
  shopifyProductId?: number;
  externalProductId?: string;
  productId?: number;
  blueprintLayout?: unknown;
};

const memoryLayouts = new Map<string, unknown>();

function stripLayout(meta: BatchItemMeta): BatchItemMeta {
  return {
    sourceType: meta.sourceType,
    shopifyProductId: meta.shopifyProductId,
    externalProductId: meta.externalProductId,
    productId: meta.productId,
  };
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

function writeMetaMap(map: Record<string, BatchItemMeta>): void {
  if (typeof window === "undefined") return;
  const slim: Record<string, BatchItemMeta> = {};
  const ids = Object.keys(map);
  const keep = ids.length > MAX_ENTRIES ? ids.slice(-MAX_ENTRIES) : ids;
  for (const id of keep) {
    slim[id] = stripLayout(map[id]);
  }
  try {
    localStorage.setItem(META_KEY, JSON.stringify(slim));
  } catch {
    try {
      const fewer = keep.slice(-40);
      const retry: Record<string, BatchItemMeta> = {};
      for (const id of fewer) retry[id] = slim[id] ?? stripLayout(map[id]);
      localStorage.setItem(META_KEY, JSON.stringify(retry));
    } catch {
      try {
        localStorage.removeItem(META_KEY);
      } catch {
        /* quota already blown — never throw into the UI */
      }
    }
  }
}

function compactStoredMetaOnce(): void {
  if (typeof window === "undefined") return;
  const map = readMetaMap();
  const bloated = Object.values(map).some((m) => m?.blueprintLayout != null);
  if (bloated || Object.keys(map).length > MAX_ENTRIES) {
    writeMetaMap(map);
  }
}

if (typeof window !== "undefined") {
  compactStoredMetaOnce();
}

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

export function saveBatchItemMeta(itemId: string, meta: BatchItemMeta): void {
  if (typeof window === "undefined" || !itemId) return;
  if (meta.blueprintLayout !== undefined) {
    memoryLayouts.set(itemId, meta.blueprintLayout);
  }
  const map = readMetaMap();
  map[itemId] = stripLayout({
    ...map[itemId],
    ...meta,
  });
  writeMetaMap(map);
}

export function getBatchItemMeta(itemId: string): BatchItemMeta | null {
  const stored = readMetaMap()[itemId];
  const layout = memoryLayouts.get(itemId) ?? stored?.blueprintLayout;
  if (!stored && layout === undefined) return null;
  return {
    ...stored,
    sourceType: stored?.sourceType ?? "upload",
    ...(layout !== undefined ? { blueprintLayout: layout } : {}),
  };
}
