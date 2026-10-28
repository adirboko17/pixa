import {
  stableProductId,
  uploadCustomApiProductImage,
} from "@/lib/custom-api-client";
import { uploadProductImage as uploadShopifyImage } from "@/lib/shopify-client";
import type {
  CustomBackedProduct,
  HistoryBatchItem,
  ShopifyBackedProduct,
  StoreBackedProduct,
} from "@/components/pixa/data";

function isShopifyProduct(p: StoreBackedProduct): p is ShopifyBackedProduct {
  return "isShopify" in p && p.isShopify === true;
}

function isCustomApiProduct(p: StoreBackedProduct): p is CustomBackedProduct {
  return "isCustomApi" in p && p.isCustomApi === true;
}
import { getBatchItemMeta } from "@/lib/batch-item-meta";
import { parseBlueprintLayout } from "@/lib/blueprint-layout";
import { markItemPublished } from "@/lib/publish-tracker";
import type { StoreConnection } from "@/lib/store-connection";

export type PublishableHistoryItem = HistoryBatchItem & {
  publishable: boolean;
  published: boolean;
};

async function urlToBase64(url: string): Promise<string | null> {
  const res = await fetch("/api/fetch-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = reader.result;
      if (typeof data !== "string") {
        resolve(null);
        return;
      }
      resolve(data.split(",")[1] ?? null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export function enrichHistoryItem(
  item: HistoryBatchItem,
  connection: StoreConnection | null,
  storeProducts: StoreBackedProduct[],
  published: boolean
): PublishableHistoryItem {
  const meta = getBatchItemMeta(item.id);
  const hasAfter = !!item.afterUrl && item.status === "success";
  let publishable = false;

  if (connection && hasAfter) {
    if (connection.platform === "shopify") {
      const pid = item.shopifyProductId ?? meta?.shopifyProductId;
      publishable =
        !!pid && storeProducts.some((p) => isShopifyProduct(p) && p.id === pid);
    } else if (connection.platform === "custom-api") {
      if (meta?.externalProductId) {
        publishable = true;
      } else if (item.beforeUrl) {
        const normalized = item.beforeUrl.split("?")[0];
        publishable = storeProducts.some(
          (p) =>
            isCustomApiProduct(p) &&
            p.imageUrl.split("?")[0] === normalized
        );
      }
    }
  }

  return {
    ...item,
    externalProductId: meta?.externalProductId ?? item.externalProductId,
    sourceType: meta?.sourceType ?? item.sourceType,
    productId: item.productId ?? meta?.productId,
    blueprintLayout:
      item.blueprintLayout ?? parseBlueprintLayout(meta?.blueprintLayout),
    published,
    publishable: publishable && !published,
  };
}

const STORE_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCustomExternalId(
  item: HistoryBatchItem,
  storeProducts: StoreBackedProduct[]
): string | undefined {
  const catalog = storeProducts.filter(isCustomApiProduct);
  const meta = getBatchItemMeta(item.id);
  const known = new Set(catalog.map((product) => product.externalId));
  const metaId = meta?.externalProductId ?? item.externalProductId;
  if (metaId && known.has(metaId)) return metaId;

  if (item.beforeUrl) {
    const normalized = item.beforeUrl.split("?")[0];
    const matched = catalog.find(
      (product) => product.imageUrl.split("?")[0] === normalized
    );
    if (matched) return matched.externalId;
  }

  if (item.productId != null) {
    const byId = catalog.find(
      (product) =>
        product.id === item.productId ||
        stableProductId(product.externalId) === item.productId
    );
    if (byId) return byId.externalId;
  }

  const name = item.productName.trim().toLowerCase();
  if (name) {
    const byName = catalog.filter(
      (product) => product.name.trim().toLowerCase() === name
    );
    if (byName.length === 1) return byName[0].externalId;
  }

  return metaId && STORE_PRODUCT_ID.test(metaId) ? metaId : undefined;
}

export type PublishHistoryResult = {
  ok: number;
  failed: number;
  publishedProductIds: Map<number, string>;
  error?: string;
};

export async function publishHistoryItems(
  items: HistoryBatchItem[],
  connection: StoreConnection,
  storeProducts: StoreBackedProduct[]
): Promise<PublishHistoryResult> {
  let ok = 0;
  let failed = 0;
  let error: string | undefined;
  const publishedProductIds = new Map<number, string>();

  for (const item of items) {
    if (!item.afterUrl || item.status !== "success") {
      failed += 1;
      continue;
    }

    const meta = getBatchItemMeta(item.id);
    const base64 = await urlToBase64(item.afterUrl);
    if (!base64) {
      failed += 1;
      continue;
    }

    const safeName =
      item.productName.replace(/[^\w\u0590-\u05FF]+/g, "_").slice(0, 80) ||
      "product";

    try {
      if (connection.platform === "shopify") {
        const productId = item.shopifyProductId ?? meta?.shopifyProductId;
        if (!productId) {
          failed += 1;
          continue;
        }
        const uploadRes = await uploadShopifyImage(connection, {
          productId,
          base64,
          filename: `${safeName}.png`,
          alt: item.productName,
          replaceOriginal: true,
        });
        if (uploadRes.image?.src) {
          publishedProductIds.set(productId, uploadRes.image.src);
        }
      } else if (connection.platform === "custom-api") {
        const externalId = resolveCustomExternalId(item, storeProducts);
        if (!externalId) {
          failed += 1;
          error ??= "לא נמצא המוצר בחנות המחוברת";
          continue;
        }
        const uploadRes = await uploadCustomApiProductImage(connection, {
          productId: externalId,
          base64,
          filename: `${safeName}.png`,
          alt: item.productName,
        });
        const matched = storeProducts.find(
          (p) => isCustomApiProduct(p) && p.externalId === externalId
        );
        if (uploadRes.newImageUrl && matched) {
          publishedProductIds.set(matched.id, uploadRes.newImageUrl);
        }
      } else {
        failed += 1;
        continue;
      }

      markItemPublished(item.id, item.afterUrl);
      ok += 1;
    } catch (err) {
      console.error("[publish] history item failed", item.id, err);
      failed += 1;
      error ??= err instanceof Error ? err.message : "הפרסום נכשל";
    }
  }

  return { ok, failed, publishedProductIds, error };
}
