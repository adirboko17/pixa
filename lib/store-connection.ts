// Unified store connection — supports Shopify and custom API (Lovable / Supabase).

import {
  clearConnection as clearShopifyConnection,
  getConnection as getShopifyConnection,
  saveConnection as saveShopifyConnection,
  type ShopifyConnection,
} from "@/lib/shopify-client";

const STORAGE_KEY = "photospro:store-connection";
const LEGACY_SHOPIFY_KEY = "photospro:shopify-connection";

export type StorePlatform = "shopify" | "custom-api";

export type ShopifyStoreConnection = ShopifyConnection & {
  platform: "shopify";
};

export type CustomApiStoreConnection = {
  platform: "custom-api";
  /** Full URL to the Edge Function, e.g. https://xxx.supabase.co/functions/v1/photospro-api */
  apiUrl: string;
  apiKey: string;
  storeName?: string;
  connectedAt: number;
};

export type StoreConnection = ShopifyStoreConnection | CustomApiStoreConnection;

export function normalizeApiUrl(input: string): string {
  let s = (input || "").trim();
  if (!s) return s;
  s = s.replace(/\/+$/, "");
  return s;
}

export function getStoreConnection(): StoreConnection | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as StoreConnection;
      if (c.platform === "shopify" && c.shop && c.token) {
        return { ...c, platform: "shopify" };
      }
      if (c.platform === "custom-api" && c.apiUrl && c.apiKey) {
        return { ...c, apiUrl: normalizeApiUrl(c.apiUrl), platform: "custom-api" };
      }
    }
  } catch {
    // fall through to legacy
  }

  const legacy = getShopifyConnection();
  if (legacy) {
    return { ...legacy, platform: "shopify" };
  }
  return null;
}

export function saveStoreConnection(c: StoreConnection): void {
  if (typeof window === "undefined") return;

  if (c.platform === "shopify") {
    saveShopifyConnection(c);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...c, platform: "shopify" })
    );
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...c,
      apiUrl: normalizeApiUrl(c.apiUrl),
      platform: "custom-api",
    })
  );
  window.localStorage.removeItem(LEGACY_SHOPIFY_KEY);
}

export function clearStoreConnection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  clearShopifyConnection();
}

export function getConnectionLabel(conn: StoreConnection): string {
  if (conn.platform === "shopify") {
    return conn.shopName || conn.shop;
  }
  return conn.storeName || "Lovable / API";
}

export function getConnectionPlatformLabel(conn: StoreConnection): string {
  return conn.platform === "shopify" ? "Shopify" : "Lovable / API";
}
