"use client";

import { createClient } from "@/lib/supabase/client";
import type { ProcessedResult } from "@/components/pixa/screens-app";
import { PRESETS, type HistoryBatch, type HistoryBatchItem } from "@/components/pixa/data";

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

  return batches.map((batch) => {
    const batchItems = itemsByBatch.get(batch.id) ?? [];
    const mappedItems: HistoryBatchItem[] = batchItems.map((item) => ({
      id: item.id,
      productName: item.product_name ?? "",
      beforeUrl: item.before_url ?? undefined,
      afterUrl: item.after_url ?? undefined,
      status: mapItemStatus(item.status),
      error: item.error ?? undefined,
    }));

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
  });
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
    });

    if (itemError) {
      console.error("[history] failed to insert batch item", itemError);
    }

    mappedItems.push({
      id: itemId,
      productName: result.name,
      beforeUrl: beforeUrl ?? undefined,
      afterUrl: afterUrl ?? undefined,
      status: result.error ? "failed" : "success",
      error: result.error,
    });
  }

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
