import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeShopDomain } from "@/lib/shopify-client";
import type { Database } from "@/lib/supabase/types";
import {
  normalizeApiUrl,
  type StoreConnection,
} from "@/lib/store-connection";

type Client = SupabaseClient<Database>;

export async function loadRemoteStoreConnection(
  supabase: Client,
  userId: string
): Promise<StoreConnection | null> {
  const { data: shopifyRows, error: shopifyErr } = await supabase
    .from("shopify_connections")
    .select("shop, shop_name, access_token, connected_at, updated_at")
    .eq("user_id", userId)
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (shopifyErr) {
    console.warn("[store-connection] load shopify failed", shopifyErr.message);
  }

  const shopify = shopifyRows?.[0];
  if (shopify?.access_token) {
    return {
      platform: "shopify",
      shop: normalizeShopDomain(shopify.shop),
      token: shopify.access_token,
      shopName: shopify.shop_name ?? undefined,
      connectedAt: new Date(shopify.connected_at).getTime(),
    };
  }

  const { data: custom, error: customErr } = await supabase
    .from("custom_api_connections")
    .select("api_url, api_key, store_name, connected_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (customErr) {
    console.warn("[store-connection] load custom api failed", customErr.message);
  }

  if (custom?.api_url && custom.api_key) {
    return {
      platform: "custom-api",
      apiUrl: normalizeApiUrl(custom.api_url),
      apiKey: custom.api_key,
      storeName: custom.store_name ?? undefined,
      connectedAt: new Date(custom.connected_at).getTime(),
    };
  }

  return null;
}

export async function persistRemoteStoreConnection(
  supabase: Client,
  userId: string,
  conn: StoreConnection
): Promise<void> {
  if (conn.platform === "shopify") {
    const { error: upsertErr } = await supabase.from("shopify_connections").upsert(
      {
        user_id: userId,
        shop: normalizeShopDomain(conn.shop),
        shop_name: conn.shopName ?? null,
        access_token: conn.token,
        connected_at: new Date(conn.connectedAt).toISOString(),
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,shop" }
    );
    if (upsertErr) throw upsertErr;

    await supabase.from("custom_api_connections").delete().eq("user_id", userId);
    return;
  }

  const { error: upsertErr } = await supabase.from("custom_api_connections").upsert(
    {
      user_id: userId,
      api_url: normalizeApiUrl(conn.apiUrl),
      api_key: conn.apiKey,
      store_name: conn.storeName ?? null,
      connected_at: new Date(conn.connectedAt).toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (upsertErr) throw upsertErr;

  await supabase.from("shopify_connections").delete().eq("user_id", userId);
}

export async function clearRemoteStoreConnection(
  supabase: Client,
  userId: string
): Promise<void> {
  await Promise.all([
    supabase.from("shopify_connections").delete().eq("user_id", userId),
    supabase.from("custom_api_connections").delete().eq("user_id", userId),
  ]);
}
