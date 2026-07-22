// Server-side helpers for proxying requests to a Lovable / Supabase Edge Function.

export const CUSTOM_API_TIMEOUT_MS = 20_000;

export type CustomApiCredentials = {
  apiUrl: string;
  apiKey: string;
};

export function normalizeCustomApiUrl(input: string): string {
  let s = (input || "").trim();
  if (!s) throw new Error("חסר כתובת API");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  return u.toString().replace(/\/+$/, "");
}

async function customApiFetch(
  creds: CustomApiCredentials,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const base = normalizeCustomApiUrl(creds.apiUrl);
  const url = path ? `${base}${path.startsWith("/") ? path : `/${path}`}` : base;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CUSTOM_API_TIMEOUT_MS);
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

export type NormalizedCustomProduct = {
  id: string;
  title: string;
  image_url?: string | null;
  images: Array<{ url: string; position?: number; alt?: string | null }>;
};

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
  };
}

export async function fetchCustomApiProducts(
  creds: CustomApiCredentials
): Promise<{ products: NormalizedCustomProduct[]; storeName?: string }> {
  const res = await customApiFetch(creds, "/products", { method: "GET" });

  if (res.status === 401 || res.status === 403) {
    throw new Error("אימות נכשל. בדוק את ה-API Key.");
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
    .filter((p): p is NormalizedCustomProduct => p !== null && !!p.image_url);

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
