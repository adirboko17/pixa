// Server-side helpers for proxying requests to a Lovable / Supabase Edge Function.

import { extractDimensionsFromProduct, type ProductDimensions } from "@/lib/product-dimensions";

export const CUSTOM_API_TIMEOUT_MS = 20_000;
export const CUSTOM_API_DRAWING_TIMEOUT_MS = 60_000;

export const PRODUCT_NOT_ON_CATALOG_MESSAGE =
  "המוצר עדיין לא באתר. הוסף אותו קודם בניהול האתר.";

export class CustomApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CustomApiRequestError";
    this.status = status;
  }
}

export type CustomApiCredentials = {
  apiUrl: string;
  apiKey: string;
};

export function normalizeCustomApiUrl(input: string): string {
  let s = (input || "").trim();
  if (!s) throw new Error("חסר כתובת API");
  s = s.replace(/\\/g, "/");
  s = s.replace(/^https?:\/\/https?:\/\//i, (m) =>
    m.toLowerCase().includes("https") ? "https://" : "http://"
  );
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  return u.toString().replace(/\/+$/, "");
}

export function describeCustomApiError(err: unknown): string {
  if (err instanceof CustomApiRequestError) return err.message;
  if (!(err instanceof Error)) return "שגיאה לא ידועה";
  const cause = (err as Error & { cause?: { code?: string; message?: string } })
    .cause;
  const raw = [err.message, cause?.message, cause?.code]
    .filter(Boolean)
    .join(" ");
  if (/abort|aborted|timeout/i.test(raw)) {
    return "ה-API לא הגיב בזמן. נסה שוב בעוד רגע.";
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|ENETUNREACH|certificate|ECONNREFUSED/i.test(raw)) {
    return "לא הצלחנו להגיע ל-API. ודא שהכתובת עם / רגילים (לא \\) ושאין רווחים בסוף.";
  }
  return err.message;
}

async function customApiFetch(
  creds: CustomApiCredentials,
  path: string,
  init: RequestInit = {},
  timeoutMs = CUSTOM_API_TIMEOUT_MS
): Promise<Response> {
  const base = normalizeCustomApiUrl(creds.apiUrl);
  const url = path ? `${base}${path.startsWith("/") ? path : `/${path}`}` : base;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "x-api-key": creds.apiKey,
        accept: "application/json",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

export type ListingStatus = "active" | "draft" | "archived";

export type NormalizedCustomProduct = {
  id: string;
  title: string;
  image_url?: string | null;
  images: Array<{ url: string; position?: number; alt?: string | null }>;
  dimensions?: ProductDimensions;
  listingStatus: ListingStatus;
};

function readListingStatus(raw: Record<string, unknown>): ListingStatus {
  const status = String(
    raw.status ?? raw.publish_status ?? raw.published_status ?? raw.visibility ?? ""
  )
    .trim()
    .toLowerCase();
  if (
    status === "draft" ||
    status === "unpublished" ||
    status === "private" ||
    status === "hidden"
  ) {
    return "draft";
  }
  if (status === "archived" || status === "archive") return "archived";
  if (
    raw.published === false ||
    raw.is_published === false ||
    raw.isPublished === false ||
    raw.draft === true ||
    raw.is_draft === true ||
    raw.isDraft === true
  ) {
    return "draft";
  }
  return "active";
}

function pickImageUrl(raw: Record<string, unknown>): string | null {
  const direct =
    (raw.image_url as string) ||
    (raw.imageUrl as string) ||
    (raw.thumbnail as string) ||
    null;
  if (direct) return direct;

  const images = raw.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const obj = first as Record<string, unknown>;
      return (obj.url as string) || (obj.src as string) || null;
    }
  }
  return null;
}

function normalizeProduct(raw: Record<string, unknown>): NormalizedCustomProduct | null {
  const id = String(raw.id ?? raw.product_id ?? "").trim();
  const title = String(raw.title ?? raw.name ?? "").trim();
  if (!id || !title) return null;

  const imageUrl = pickImageUrl(raw);
  const images: NormalizedCustomProduct["images"] = [];

  if (Array.isArray(raw.images)) {
    for (const img of raw.images) {
      if (typeof img === "string") {
        images.push({ url: img });
      } else if (img && typeof img === "object") {
        const obj = img as Record<string, unknown>;
        const url = (obj.url as string) || (obj.src as string);
        if (url) {
          images.push({
            url,
            position: typeof obj.position === "number" ? obj.position : undefined,
            alt: (obj.alt as string) ?? null,
          });
        }
      }
    }
  }

  if (imageUrl && !images.some((i) => i.url === imageUrl)) {
    images.unshift({ url: imageUrl, position: 1 });
  }

  return {
    id,
    title,
    image_url: imageUrl,
    images,
    dimensions: extractDimensionsFromProduct(raw, title),
    listingStatus: readListingStatus(raw),
  };
}

export async function fetchCustomApiProducts(
  creds: CustomApiCredentials
): Promise<{ products: NormalizedCustomProduct[]; storeName?: string }> {
  const res = await customApiFetch(creds, "/products", { method: "GET" });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "אימות נכשל. ה-API Key השמור לא תואם ל-PHOTOSPRO_API_KEY בפונקציה photospro-api. חבר מחדש בהגדרות עם המפתח העדכני."
    );
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`שגיאה ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const list = Array.isArray(data.products)
    ? data.products
    : Array.isArray(data)
      ? data
      : [];

  const products = list
    .map((item) =>
      normalizeProduct(
        item && typeof item === "object" ? (item as Record<string, unknown>) : {}
      )
    )
    .filter(
      (p): p is NormalizedCustomProduct =>
        p !== null && (p.listingStatus === "draft" || !!p.image_url)
    );

  const storeName =
    typeof data.store_name === "string"
      ? data.store_name
      : typeof data.storeName === "string"
        ? data.storeName
        : undefined;

  return { products, storeName };
}

export async function uploadCustomApiImage(
  creds: CustomApiCredentials,
  args: {
    productId: string;
    base64: string;
    filename?: string;
    alt?: string;
  }
): Promise<{ newImageUrl: string }> {
  const res = await customApiFetch(creds, `/products/${args.productId}/image`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_base64: args.base64,
      filename: args.filename,
      alt: args.alt,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`שגיאה בהעלאה ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const newImageUrl =
    (data.new_image_url as string) ||
    (data.newImageUrl as string) ||
    (data.image_url as string) ||
    "";

  if (!newImageUrl) {
    throw new Error("ה-API לא החזיר כתובת תמונה חדשה");
  }

  return { newImageUrl };
}

export async function updateCustomApiProductByName(
  creds: CustomApiCredentials,
  args: {
    title: string;
    price?: number;
    currency?: string;
    imageBase64?: string;
    images?: Array<{ imageBase64: string; position: number; primary: boolean }>;
  }
): Promise<{ id: string; title: string; imageUrl?: string }> {
  const res = await customApiFetch(
    creds,
    "/products/by-name",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: args.title,
        price: args.price,
        currency: args.currency,
        image_base64: args.imageBase64,
        images: (args.images ?? []).map((img) => ({
          image_base64: img.imageBase64,
          position: img.position,
          primary: img.primary,
        })),
      }),
    },
    60_000
  );

  const text = await res.text().catch(() => "");
  if (text.trim().startsWith("<")) {
    throw new Error(
      "האתר עדיין לא מגיש את הנתיב /products/by-name. צריך להעלות את ה-CMS ל-Vercel ולהגדיר שם את משתני הסביבה."
    );
  }
  if (res.status === 404) {
    throw new CustomApiRequestError(
      `לא נמצא מוצר בשם "${args.title}"`,
      404
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new CustomApiRequestError("אימות נכשל. בדוק את ה-API Key.", res.status);
  }
  if (!res.ok) {
    throw new Error(
      `שגיאה בעדכון ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }

  const data = JSON.parse(text) as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? args.title),
    imageUrl: typeof data.image_url === "string" ? data.image_url : undefined,
  };
}

export async function uploadCustomApiDrawing(
  creds: CustomApiCredentials,
  args: {
    productId: string;
    base64: string;
    filename?: string;
  }
): Promise<{ listingId: string; drawingUrl: string }> {
  const res = await customApiFetch(
    creds,
    `/products/${args.productId}/drawing`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image_base64: args.base64,
        filename: args.filename ?? "drawing.png",
      }),
    },
    CUSTOM_API_DRAWING_TIMEOUT_MS
  );

  if (res.status === 404) {
    throw new CustomApiRequestError(PRODUCT_NOT_ON_CATALOG_MESSAGE, 404);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CustomApiRequestError("אימות נכשל. בדוק את ה-API Key.", res.status);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`שגיאה בהעלאת שרטוט ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const drawingUrl =
    (data.drawing_url as string) ||
    (data.drawingUrl as string) ||
    "";
  const listingId = String(data.listing_id ?? data.listingId ?? "");

  if (!drawingUrl) {
    throw new Error("ה-API לא החזיר כתובת שרטוט");
  }

  return { listingId, drawingUrl };
}
