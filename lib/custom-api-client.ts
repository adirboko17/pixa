// Client helpers for Lovable / Supabase custom product API.
// Credentials stay in localStorage — sent to our server proxy on each request.

import type { CustomApiStoreConnection } from "@/lib/store-connection";
import type { ProductDimensions } from "@/lib/product-dimensions";

async function postJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export type CustomApiImage = {
  url: string;
  position?: number;
  alt?: string | null;
};

export type CustomApiProduct = {
  id: string;
  title: string;
  image_url?: string | null;
  images?: CustomApiImage[];
  dimensions?: ProductDimensions;
};

export async function validateCustomApiConnection(
  apiUrl: string,
  apiKey: string
): Promise<{ storeName: string; productCount: number }> {
  return postJson("/api/custom-api/validate", { apiUrl, apiKey });
}

export async function listCustomApiProducts(
  conn: CustomApiStoreConnection
): Promise<{ products: CustomApiProduct[]; total: number }> {
  return postJson("/api/custom-api/products", {
    apiUrl: conn.apiUrl,
    apiKey: conn.apiKey,
  });
}

export async function uploadCustomApiProductImage(
  conn: CustomApiStoreConnection,
  args: {
    productId: string;
    base64: string;
    filename?: string;
    alt?: string;
  }
): Promise<{ success: true; newImageUrl: string }> {
  return postJson("/api/custom-api/upload-image", {
    apiUrl: conn.apiUrl,
    apiKey: conn.apiKey,
    productId: args.productId,
    base64: args.base64,
    filename: args.filename,
    alt: args.alt,
  });
}

export async function uploadCustomApiProductDrawing(
  conn: CustomApiStoreConnection,
  args: {
    productId: string;
    base64: string;
    filename?: string;
  }
): Promise<{ success: true; listing_id: string; drawing_url: string }> {
  return postJson("/api/custom-api/upload-drawing", {
    apiUrl: conn.apiUrl,
    apiKey: conn.apiKey,
    productId: args.productId,
    base64: args.base64,
    filename: args.filename ?? "drawing.png",
  });
}

/** Stable numeric id for UI selection — maps back via externalId on the product. */
export function stableProductId(externalId: string): number {
  let h = 5381;
  for (let i = 0; i < externalId.length; i++) {
    h = ((h << 5) + h) ^ externalId.charCodeAt(i);
  }
  return (Math.abs(h) % 900_000_000) + 3_000_000_000;
}
