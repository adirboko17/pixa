"use client";

import { createClient } from "@/lib/supabase/client";
import type { ProcessedResult } from "@/components/pixa/screens-app";
import { PRESETS, type HistoryBatch, type HistoryBatchItem } from "@/components/pixa/data";
import type { StoreBackedProduct } from "@/components/pixa/data";
import {
  isLegacyBatchProductName,
  preloadShopifyFingerprints,
  resolveShopifyProductName,
  saveAfterProductMap,
} from "@/lib/product-name-resolver";
import { getBatchItemMeta, patchBatchItemMeta, saveBatchItemMeta } from "@/lib/batch-item-meta";
import {
  isPersistedItemId,
  parseBlueprintLayout,
} from "@/lib/blueprint-layout";
import type { BlueprintLayout } from "@/lib/blueprint-annotations";

const BUCKET = "processed-images";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function uploadBytes(
  userId: string,
  batchId: string,
  fileName: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  const supabase = createClient();
  const path = `${userId}/${batchId}/${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadBase64Png(
  userId: string,
  batchId: string,
  fileName: string,
  base64: string
): Promise<string> {
  return uploadBytes(userId, batchId, fileName, base64ToBytes(base64), "image/png");
}

async function uploadFromUrl(
  userId: string,
  batchId: string,
  fileName: string,
  url: string
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return uploadBytes(
      userId,
      batchId,
      fileName,
      bytes,
      blob.type || "image/png"
    );
  } catch {
    return null;
  }
}

function mapBatchStatus(
  dbStatus: string,
  failedItems: number
): HistoryBatch["status"] {
  if (dbStatus === "failed") return "failed";
  if (failedItems > 0) return "partial";
  return "completed";
}

function mapItemStatus(
  status: string
): HistoryBatchItem["status"] {
  return status === "failed" ? "failed" : "success";
}

function publicStorageUrl(path: string): string {
  const supabase = createClient();
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Recover images uploaded to storage when batch_items rows are missing. */
async function recoverItemsFromStorage(
  userId: string,
  batchId: string,
  batchName: string
): Promise<HistoryBatchItem[]> {
  const supabase = createClient();
  const folder = `${userId}/${batchId}`;
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });

  if (error || !files?.length) return [];

  const label = batchName.replace(/^עיצוב · /, "") || batchName;
  const beforeById = new Map<string, string>();
  for (const file of files) {
    if (!file.name?.endsWith("-before.png")) continue;
    const itemId = file.name.slice(0, -"-before.png".length);
    beforeById.set(itemId, publicStorageUrl(`${folder}/${file.name}`));
  }

  return files
    .filter((file) => file.name?.endsWith("-after.png"))
    .map((file) => {
      const itemId = file.name!.slice(0, -"-after.png".length);
      const afterUrl = publicStorageUrl(`${folder}/${file.name}`);
      return {
        id: itemId,
        productName: label,
        afterUrl,
        beforeUrl: beforeById.get(itemId),
        status: "success" as const,
      };
    });
}

export async function loadBatchHistory(userId: string): Promise<HistoryBatch[]> {
  const supabase = createClient();

  const { data: batches, error } = await supabase
    .from("batches")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[history] failed to load batches", error);
    return [];
  }
  if (!batches?.length) return [];

  const batchIds = batches.map((b) => b.id);
  const { data: items, error: itemsError } = await supabase
    .from("batch_items")
    .select("*")
    .in("batch_id", batchIds)
    .order("created_at", { ascending: true });

  if (itemsError) {
    console.error("[history] failed to load batch items", itemsError);
  }

  const itemsByBatch = new Map<string, NonNullable<typeof items>>();
  for (const item of items ?? []) {
    const list = itemsByBatch.get(item.batch_id) ?? [];
    list.push(item);
    itemsByBatch.set(item.batch_id, list);
  }

  return Promise.all(
    batches.map(async (batch) => {
      const batchItems = itemsByBatch.get(batch.id) ?? [];
      let mappedItems: HistoryBatchItem[] = batchItems.map((item) => {
        const meta = getBatchItemMeta(item.id);
        return {
          id: item.id,
          productName: item.product_name ?? "",
          beforeUrl: item.before_url ?? undefined,
          afterUrl: item.after_url ?? undefined,
          status: mapItemStatus(item.status),
          error: item.error ?? undefined,
          shopifyProductId:
            item.shopify_product_id ?? meta?.shopifyProductId ?? undefined,
          externalProductId: meta?.externalProductId,
          sourceType: meta?.sourceType,
          productId: meta?.productId ?? item.shopify_product_id ?? undefined,
          blueprintLayout:
            parseBlueprintLayout(item.blueprint_layout) ??
            parseBlueprintLayout(meta?.blueprintLayout),
        };
      });

      if (mappedItems.length === 0) {
        mappedItems = await recoverItemsFromStorage(
          userId,
          batch.id,
          batch.name ?? "עיצוב"
        );
      }

      return {
        id: batch.id,
        name: batch.name ?? "עיצוב",
        preset: batch.preset,
        count: batch.total_items,
        successful: batch.successful_items,
        failed: batch.failed_items,
        createdAt: new Date(batch.created_at),
        status: mapBatchStatus(batch.status, batch.failed_items),
        previewUrl:
          mappedItems.find((i) => i.afterUrl)?.afterUrl ??
          mappedItems.find((i) => i.beforeUrl)?.beforeUrl,
        items: mappedItems,
      };
    })
  );
}

export async function persistBatch(
  userId: string,
  results: ProcessedResult[],
  preset: string,
  quality: string,
  batchId: string,
  shopifyShop?: string | null
): Promise<HistoryBatch | null> {
  const supabase = createClient();
  const presetName = PRESETS.find((p) => p.id === preset)?.name ?? preset;
  const successful = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;
  const batchName = `עיצוב · ${presetName}`;

  const { error: batchError } = await supabase.from("batches").insert({
    id: batchId,
    user_id: userId,
    name: batchName,
    preset,
    quality,
    shopify_shop: shopifyShop ?? null,
    total_items: results.length,
    successful_items: successful,
    failed_items: failed,
    status: failed === results.length ? "failed" : "completed",
    total_cost_usd: 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  if (batchError) {
    console.error("[history] failed to insert batch", batchError);
    return null;
  }

  const mappedItems: HistoryBatchItem[] = [];
  let previewUrl: string | undefined;

  for (const result of results) {
    const itemId = crypto.randomUUID();
    let beforeUrl =
      result.beforeUrl.startsWith("http") ? result.beforeUrl : null;
    let afterUrl: string | null = null;

    if (
      result.beforeUrl.startsWith("blob:") ||
      result.beforeUrl.startsWith("data:")
    ) {
      const uploadedBefore = await uploadFromUrl(
        userId,
        batchId,
        `${itemId}-before.png`,
        result.beforeUrl
      );
      if (uploadedBefore) beforeUrl = uploadedBefore;
    }

    if (result.afterBase64 && !result.error) {
      try {
        afterUrl = await uploadBase64Png(
          userId,
          batchId,
          `${itemId}-after.png`,
          result.afterBase64
        );
        if (!previewUrl) previewUrl = afterUrl;
      } catch (err) {
        console.error("[history] failed to upload after image", err);
      }
    } else if (result.afterUrl && !result.error && !result.afterUrl.startsWith("data:")) {
      afterUrl = result.afterUrl;
      if (!previewUrl) previewUrl = afterUrl;
    }

    const sourceType = result.isCustomApi
      ? "custom-api"
      : result.isShopify
        ? "shopify"
        : "upload";

    const { error: itemError } = await supabase.from("batch_items").insert({
      id: itemId,
      batch_id: batchId,
      user_id: userId,
      product_name: result.name,
      before_url: beforeUrl,
      after_url: afterUrl,
      shopify_product_id: result.isShopify ? result.productId : null,
      shopify_image_id: result.shopifyImageId ?? null,
      source_type: result.isShopify ? "shopify" : "upload",
      status: result.error ? "failed" : "success",
      cost_usd: 0,
      error: result.error ?? null,
      blueprint_layout: result.blueprintLayout ?? null,
    });

    if (itemError) {
      console.error("[history] failed to insert batch item", itemError);
    } else {
      saveBatchItemMeta(itemId, {
        sourceType,
        shopifyProductId: result.isShopify ? result.productId : undefined,
        externalProductId: result.externalProductId,
        productId: result.productId,
        blueprintLayout: result.blueprintLayout,
      });
      if (afterUrl) {
        saveAfterProductMap(
          afterUrl,
          result.name,
          result.isShopify ? result.productId : undefined
        );
      }
    }

    mappedItems.push({
      id: itemId,
      productName: result.name,
      beforeUrl: beforeUrl ?? undefined,
      afterUrl: afterUrl ?? undefined,
      status: result.error ? "failed" : "success",
      error: result.error,
      shopifyProductId: result.isShopify ? result.productId : undefined,
      externalProductId: result.externalProductId,
      sourceType,
      productId: result.productId,
      blueprintLayout: result.blueprintLayout,
    });
  }

  return {
    id: batchId,
    name: batchName,
    preset,
    count: results.length,
    successful,
    failed,
    createdAt: new Date(),
    status:
      failed === results.length
        ? "failed"
        : failed > 0
          ? "partial"
          : "completed",
    previewUrl,
    items: mappedItems,
  };
}

export async function repairBatchHistoryNames(
  batches: HistoryBatch[],
  shopifyProducts: StoreBackedProduct[]
): Promise<HistoryBatch[]> {
  if (!shopifyProducts.length || !batches.length) return batches;

  const needsRepair = batches.some((b) =>
    b.items?.some((i) => isLegacyBatchProductName(i.productName))
  );
  if (!needsRepair) return batches;

  await preloadShopifyFingerprints(shopifyProducts);

  const supabase = createClient();
  let changed = false;
  const next = structuredClone(batches) as HistoryBatch[];

  for (const batch of next) {
    if (!batch.items?.length) continue;
    for (const item of batch.items) {
      if (!isLegacyBatchProductName(item.productName)) continue;

      const resolved = await resolveShopifyProductName(
        item.afterUrl,
        item.beforeUrl,
        item.productName,
        item.shopifyProductId,
        shopifyProducts
      );
      if (!resolved) continue;

      item.productName = resolved.name;
      item.shopifyProductId = resolved.shopifyProductId;
      changed = true;

      if (item.afterUrl) {
        await supabase
          .from("batch_items")
          .update({
            product_name: resolved.name,
            shopify_product_id: resolved.shopifyProductId ?? null,
            source_type: resolved.shopifyProductId ? "shopify" : "upload",
          })
          .eq("id", item.id);
      }
    }
  }

  return changed ? next : batches;
}

const layoutPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function persistBlueprintAfterImage(
  itemId: string,
  imageUrl: string
): Promise<string | null> {
  if (!itemId || !isPersistedItemId(itemId) || !imageUrl.startsWith("data:")) {
    return imageUrl.startsWith("http") ? imageUrl : null;
  }
  const base64 = imageUrl.split(",")[1];
  if (!base64) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error: rowError } = await supabase
    .from("batch_items")
    .select("batch_id")
    .eq("id", itemId)
    .maybeSingle();
  if (rowError || !row?.batch_id) {
    console.error("[history] failed to load batch item for drawing", rowError);
    return null;
  }

  try {
    const url = await uploadBase64Png(
      user.id,
      row.batch_id,
      `${itemId}-after.png`,
      base64
    );
    const { error } = await supabase
      .from("batch_items")
      .update({ after_url: url })
      .eq("id", itemId);
    if (error) {
      console.error("[history] failed to save cropped drawing", error);
      return null;
    }
    return url;
  } catch (err) {
    console.error("[history] failed to upload cropped drawing", err);
    return null;
  }
}

export async function persistBlueprintLayout(
  itemId: string,
  layout: BlueprintLayout
): Promise<void> {
  if (!itemId) return;
  patchBatchItemMeta(itemId, { blueprintLayout: layout });
  if (!isPersistedItemId(itemId)) return;

  const prev = layoutPersistTimers.get(itemId);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    layoutPersistTimers.delete(itemId);
    const supabase = createClient();
    void supabase
      .from("batch_items")
      .update({ blueprint_layout: layout })
      .eq("id", itemId)
      .then(({ error }) => {
        if (error) {
          console.error("[history] failed to save blueprint layout", error);
        }
      });
  }, 500);
  layoutPersistTimers.set(itemId, timer);
}
