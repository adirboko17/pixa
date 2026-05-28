// ניהול ההתחברות ל-Shopify בצד הלקוח בלבד (localStorage).
// טוקנים לעולם לא נשמרים בשרת – הם נשלחים בכל בקשה ל-API הפנימי שלנו שהוא רק פרוקסי.

const STORAGE_KEY = "photospro:shopify-connection";

export type ShopifyConnection = {
  shop: string; // לדוגמה "myshop.myshopify.com"
  token: string; // shpat_xxx
  shopName?: string;
  connectedAt: number;
};

/**
 * מטא-דאטה על מקור התמונה – נשמר ב-Job כדי לאפשר פעולות חזרה (כמו "הגדר כתמונה ראשית").
 */
export type ImageSource = {
  type: "shopify";
  shop: string;
  shopName?: string;
  productId: number | string;
  productTitle: string;
  originalImageId?: number;
};

export function normalizeShopDomain(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // אם הוזן רק handle (myshop) – נוסיף myshopify.com
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

export function getConnection(): ShopifyConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ShopifyConnection;
    if (!c.shop || !c.token) return null;
    c.shop = normalizeShopDomain(c.shop);
    if (!c.shop.endsWith(".myshopify.com")) return null;
    return c;
  } catch {
    return null;
  }
}

export function saveConnection(c: ShopifyConnection): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...c,
      shop: normalizeShopDomain(c.shop),
    })
  );
}

export function clearConnection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// --- API client helpers ---

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
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

export type ShopifyImage = {
  id: number;
  src: string;
  alt?: string | null;
  position: number;
  width?: number;
  height?: number;
};

export type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  status?: string;
  vendor?: string;
  featuredImageId?: number;
  createdAt?: number;
  images: ShopifyImage[];
};

export type ShopifyCollection = {
  id: number;
  handle: string;
  title: string;
  productsCount?: number | null;
  imageSrc?: string;
};

export async function validateConnection(
  shop: string,
  token: string
): Promise<{ shopName: string; domain: string; email?: string }> {
  return postJson("/api/shopify/validate", { shop, token });
}

export async function listProducts(
  conn: ShopifyConnection,
  opts: {
    pageInfo?: string;
    limit?: number;
    collectionId?: number | string;
    fetchAll?: boolean;
  } = {}
): Promise<{
  products: ShopifyProduct[];
  nextPageInfo?: string;
  total?: number;
}> {
  const fetchAll = opts.fetchAll !== false;
  return postJson("/api/shopify/products", {
    shop: conn.shop,
    token: conn.token,
    pageInfo: opts.pageInfo,
    limit: opts.limit ?? (fetchAll ? 250 : 50),
    collectionId: opts.collectionId,
    fetchAll,
  });
}

export async function listCollections(
  conn: ShopifyConnection
): Promise<{ collections: ShopifyCollection[] }> {
  return postJson("/api/shopify/collections", {
    shop: conn.shop,
    token: conn.token,
  });
}

export async function uploadProductImage(
  conn: ShopifyConnection,
  args: {
    productId: number | string;
    base64: string; // ללא קידומת data:image/png;base64,
    filename?: string;
    /**
     * Alt text לקידום אורגני (SEO). מומלץ להעביר את שם המוצר המלא
     * – זהו אחד הסיגנלים החזקים ביותר לחיפוש בגוגל ולנגישות.
     */
    alt?: string;
    replaceOriginal?: boolean;
  }
): Promise<{
  success: true;
  image: ShopifyImage;
  oldImageKeptAsSecondary?: boolean;
  oldDeleted?: boolean;
}> {
  return postJson("/api/shopify/upload-image", {
    shop: conn.shop,
    token: conn.token,
    productId: args.productId,
    base64: args.base64,
    filename: args.filename,
    alt: args.alt,
    replaceOriginal: args.replaceOriginal ?? false,
  });
}
