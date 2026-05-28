import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; PhotosProBot/1.0; +https://photospro.local) Chrome/120 Safari/537.36";

const FETCH_TIMEOUT_MS = 12000;

type ScanImage = { src: string; alt?: string };
type ScanProduct = {
  id: string;
  title: string;
  url?: string;
  images: ScanImage[];
};
type ScanCategory = {
  name: string;
  handle: string;
  products: ScanProduct[];
};
type ScanResult = {
  source: "shopify" | "html" | "sitemap";
  domain: string;
  categories: ScanCategory[];
  totalProducts: number;
  totalImages: number;
  notes?: string[];
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = FETCH_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json,*/*",
        ...(init.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function normalizeInput(raw: string): { base: string; full: string } {
  let s = raw.trim();
  if (!s) throw new Error("הכנס דומיין או כתובת");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  const base = `${u.protocol}//${u.host}`;
  return { base, full: u.toString() };
}

function absUrl(src: string, base: string): string {
  if (!src) return src;
  src = src.trim();
  if (src.startsWith("//")) return "https:" + src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return base.replace(/\/$/, "") + src;
  return base.replace(/\/$/, "") + "/" + src;
}

function upgradeShopifyImage(src: string): string {
  if (!src.includes("cdn.shopify.com")) return src;
  // הסר סיומות גודל כדי לקבל את התמונה הגדולה ביותר
  return src.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|original|1024x1024|600x600|2048x2048|master)(?=\.[a-z]+)/i, "");
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) return;
      try {
        results[my] = await fn(items[my], my);
      } catch (e) {
        // ignore individual failures
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- Shopify ----------

type ShopifyImage = { src: string; alt?: string };
type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  images?: ShopifyImage[];
};
type ShopifyCollection = { id: number; title: string; handle: string };

async function tryShopify(base: string): Promise<ScanResult | null> {
  // 1. ננסה collections.json
  let collections: ShopifyCollection[] = [];
  try {
    const colRes = await fetchWithTimeout(`${base}/collections.json?limit=250`);
    if (colRes.ok) {
      const data = (await colRes.json()) as { collections?: ShopifyCollection[] };
      if (Array.isArray(data.collections) && data.collections.length > 0) {
        collections = data.collections;
      }
    }
  } catch {}

  // 2. אם יש קולקציות – נשלוף מוצרים מכל אחת
  if (collections.length > 0) {
    const limited = collections.slice(0, 40);
    const fetched = await runWithConcurrency(limited, 5, async (col) => {
      try {
        const res = await fetchWithTimeout(
          `${base}/collections/${encodeURIComponent(col.handle)}/products.json?limit=250`
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { products?: ShopifyProduct[] };
        if (!Array.isArray(data.products) || data.products.length === 0)
          return null;
        return { col, products: data.products };
      } catch {
        return null;
      }
    });

    const cats: ScanCategory[] = [];
    for (const f of fetched) {
      if (!f) continue;
      cats.push({
        name: f.col.title,
        handle: f.col.handle,
        products: f.products.map((p) => ({
          id: String(p.id),
          title: p.title,
          url: `${base}/products/${p.handle}`,
          images: (p.images || []).map((img) => ({
            src: upgradeShopifyImage(img.src),
            alt: img.alt,
          })),
        })),
      });
    }
    if (cats.length > 0) {
      const { totalProducts, totalImages } = countTotals(cats);
      return {
        source: "shopify",
        domain: new URL(base).host,
        categories: cats,
        totalProducts,
        totalImages,
      };
    }
  }

  // 3. fallback: products.json ראשי (כל המוצרים, ללא קטגוריות)
  try {
    const allCats: ScanCategory[] = [];
    let page = 1;
    while (page <= 10) {
      const res = await fetchWithTimeout(
        `${base}/products.json?limit=250&page=${page}`
      );
      if (!res.ok) break;
      const data = (await res.json()) as { products?: ShopifyProduct[] };
      if (!Array.isArray(data.products) || data.products.length === 0) break;
      allCats.push({
        name: page === 1 ? "כל המוצרים" : `כל המוצרים – עמוד ${page}`,
        handle: `all-${page}`,
        products: data.products.map((p) => ({
          id: String(p.id),
          title: p.title,
          url: `${base}/products/${p.handle}`,
          images: (p.images || []).map((img) => ({
            src: upgradeShopifyImage(img.src),
            alt: img.alt,
          })),
        })),
      });
      if (data.products.length < 250) break;
      page++;
    }
    if (allCats.length > 0) {
      const { totalProducts, totalImages } = countTotals(allCats);
      return {
        source: "shopify",
        domain: new URL(base).host,
        categories: allCats,
        totalProducts,
        totalImages,
      };
    }
  } catch {}

  return null;
}

function countTotals(cats: ScanCategory[]): {
  totalProducts: number;
  totalImages: number;
} {
  let totalProducts = 0;
  let totalImages = 0;
  for (const c of cats) {
    totalProducts += c.products.length;
    for (const p of c.products) totalImages += p.images.length;
  }
  return { totalProducts, totalImages };
}

// ---------- HTML / generic ----------

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      out.push(parsed);
    } catch {}
  }
  return out;
}

function isProductSchema(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const t = (obj as { "@type"?: unknown })["@type"];
  if (typeof t === "string") return t.toLowerCase() === "product";
  if (Array.isArray(t)) return t.some((x) => String(x).toLowerCase() === "product");
  return false;
}

function flattenJsonLd(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  const visit = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      out.push(v);
      const graph = (v as { "@graph"?: unknown })["@graph"];
      if (Array.isArray(graph)) graph.forEach(visit);
    }
  };
  items.forEach(visit);
  return out;
}

function imageBlacklisted(src: string): boolean {
  return /(icon|logo|sprite|favicon|placeholder|spinner|loader|pixel|tracker|analytics|emoji|flag|payment|paypal|visa|mastercard)/i.test(
    src
  ) || /\.(svg)(\?|$|#)/i.test(src);
}

function extractImageTags(html: string, base: string): ScanImage[] {
  const found = new Map<string, ScanImage>();
  // עדיפות ל-data-src/srcset (תמונות בטעינה עצלה בד"כ מקור הגבוה)
  const reSrc =
    /<img\b[^>]*?\b(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reSrc.exec(html)) !== null) {
    const full = m[0];
    let src = absUrl(m[1], base);
    if (imageBlacklisted(src)) continue;

    // נסה srcset לאיכות גבוהה יותר
    const srcsetMatch = full.match(/srcset\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1]
        .split(",")
        .map((s) => s.trim())
        .map((p) => {
          const [u, w] = p.split(/\s+/);
          return { u: absUrl(u, base), w: parseInt((w || "0").replace(/\D/g, "")) || 0 };
        })
        .sort((a, b) => b.w - a.w);
      if (parts[0]?.u) src = parts[0].u;
    }

    const altMatch = full.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = altMatch?.[1];
    if (!found.has(src)) found.set(src, { src: upgradeShopifyImage(src), alt });
  }
  // גם og:image
  const ogRe =
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((m = ogRe.exec(html)) !== null) {
    const src = absUrl(m[1], base);
    if (!imageBlacklisted(src) && !found.has(src)) {
      found.set(src, { src });
    }
  }
  return Array.from(found.values());
}

async function tryGenericPage(targetUrl: string): Promise<ScanResult | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(targetUrl);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) return null;
  const html = await res.text();
  const u = new URL(targetUrl);
  const base = `${u.protocol}//${u.host}`;

  const products: ScanProduct[] = [];
  const jsonLd = flattenJsonLd(extractJsonLd(html));

  for (const item of jsonLd) {
    if (!isProductSchema(item)) continue;
    const o = item as {
      name?: string;
      sku?: string;
      productID?: string;
      url?: string;
      image?: string | string[] | { url?: string }[];
    };
    let imgs: string[] = [];
    if (typeof o.image === "string") imgs = [o.image];
    else if (Array.isArray(o.image)) {
      imgs = o.image
        .map((x) => (typeof x === "string" ? x : x?.url || ""))
        .filter(Boolean) as string[];
    }
    imgs = imgs.map((s) => upgradeShopifyImage(absUrl(s, base)));
    if (imgs.length === 0) continue;
    products.push({
      id: String(o.sku || o.productID || products.length + 1),
      title: o.name || "מוצר",
      url: o.url ? absUrl(o.url, base) : targetUrl,
      images: imgs.map((src) => ({ src })),
    });
  }

  // אם נמצאו מוצרים מובנים – נחזיר אותם
  if (products.length > 0) {
    const cat: ScanCategory = {
      name: products.length === 1 ? products[0].title : "מוצרים בעמוד",
      handle: "page",
      products,
    };
    const { totalProducts, totalImages } = countTotals([cat]);
    return {
      source: "html",
      domain: u.host,
      categories: [cat],
      totalProducts,
      totalImages,
      notes: ["נמצאו מוצרים מובנים (JSON-LD) בעמוד"],
    };
  }

  // אחרת – נחזיר את כל התמונות הפוטנציאליות מהעמוד כ"מוצר אחד"
  const imgs = extractImageTags(html, base);
  if (imgs.length === 0) return null;
  const cat: ScanCategory = {
    name: "תמונות מהעמוד",
    handle: "page",
    products: [
      {
        id: "page",
        title: "כל התמונות בעמוד",
        url: targetUrl,
        images: imgs,
      },
    ],
  };
  const { totalProducts, totalImages } = countTotals([cat]);
  return {
    source: "html",
    domain: u.host,
    categories: [cat],
    totalProducts,
    totalImages,
    notes: [
      "לא זוהו מוצרים מובנים. נשלפו כל התמונות מהעמוד – בחר את אלה שאתה רוצה.",
    ],
  };
}

// ---------- handler ----------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    if (!body?.url) {
      return NextResponse.json({ error: "חסר url" }, { status: 400 });
    }
    const { base, full } = normalizeInput(body.url);

    // אם המשתמש הזין רק דומיין (path = "/") ננסה קודם Shopify
    const u = new URL(full);
    const isRootLike = u.pathname === "/" || u.pathname === "";

    if (isRootLike) {
      const shop = await tryShopify(base);
      if (shop) return NextResponse.json(shop);
      // fallback – נסרוק את עמוד הבית
      const page = await tryGenericPage(base);
      if (page) return NextResponse.json(page);
    } else {
      // נסה גם Shopify (לפעמים יש subpath) וגם את העמוד עצמו
      const [shop, page] = await Promise.all([
        tryShopify(base),
        tryGenericPage(full),
      ]);
      if (page && (page.totalImages > 0 || page.totalProducts > 0))
        return NextResponse.json(page);
      if (shop) return NextResponse.json(shop);
    }

    return NextResponse.json(
      {
        error:
          "לא הצלחנו לזהות מוצרים בכתובת. נסה לפתוח עמוד קטגוריה/מוצר ספציפי באתר, או לוודא שהאתר נגיש.",
      },
      { status: 404 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
