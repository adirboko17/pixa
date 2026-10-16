const UA =
  "Mozilla/5.0 (compatible; PhotosProBot/1.0; +https://photospro.local) Chrome/120 Safari/537.36";

const FETCH_TIMEOUT_MS = 12000;
const DEADLINE_MS = 45000;
const MAX_PRODUCTS = 400;
const MAX_PAGE_FETCHES = 60;

export type CatalogScanImage = {
  src: string;
  alt?: string;
  primary: boolean;
  position: number;
};

export type CatalogScanProduct = {
  id: string;
  title: string;
  url?: string;
  priceAmount?: number;
  currency?: string;
  priceLabel?: string;
  images: CatalogScanImage[];
};

export type CatalogScanCategory = {
  name: string;
  handle: string;
  products: CatalogScanProduct[];
};

export type CatalogScanResult = {
  source: "shopify" | "woocommerce" | "html" | "sitemap";
  domain: string;
  categories: CatalogScanCategory[];
  totalProducts: number;
  totalImages: number;
  focusHandle?: string;
  truncated?: boolean;
  notes?: string[];
};

function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("אפשר לסרוק רק כתובת http או https");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "metadata.google.internal"
  ) {
    throw new Error("אפשר לסרוק רק אתר ציבורי");
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const privateNet =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (privateNet) throw new Error("אפשר לסרוק רק אתר ציבורי");
  }
}

export function normalizeCatalogUrl(raw: string): { base: string; full: string } {
  let s = raw.trim();
  if (!s) throw new Error("הכנס דומיין או כתובת");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  assertPublicUrl(u);
  const base = `${u.protocol}//${u.host}`;
  return { base, full: u.toString() };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = FETCH_TIMEOUT_MS
): Promise<Response> {
  const parsed = new URL(url);
  assertPublicUrl(parsed);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json,application/xml,*/*",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
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
  return src.replace(
    /_(pico|icon|thumb|small|compact|medium|large|grande|original|1024x1024|600x600|2048x2048|master)(?=\.[a-z]+)/i,
    ""
  );
}

function upgradeImageUrl(src: string): string {
  const shopify = upgradeShopifyImage(src);
  const wix = shopify.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/?#]+)/i);
  if (!wix) return shopify;
  try {
    return decodeURIComponent(wix[1]);
  } catch {
    return wix[1];
  }
}

function parseAmount(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return undefined;
  let s = raw.trim().replace(/[^\d.,]/g, "");
  if (!s) return undefined;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function formatCatalogPrice(amount?: number, currency?: string): string | undefined {
  if (amount == null || !Number.isFinite(amount)) return undefined;
  const n = amount.toLocaleString("he-IL", { maximumFractionDigits: 2 });
  const cur = (currency || "").toUpperCase();
  if (cur === "ILS" || cur === "NIS" || cur === "₪") return `₪${n}`;
  if (cur === "USD") return `$${n}`;
  if (cur === "EUR") return `€${n}`;
  if (cur === "GBP") return `£${n}`;
  if (cur) return `${n} ${cur}`;
  return n;
}

function priceFields(amount?: number, currency?: string) {
  if (amount == null) return {};
  return {
    priceAmount: amount,
    currency: currency?.toUpperCase(),
    priceLabel: formatCatalogPrice(amount, currency),
  };
}

function tagImages(
  images: Array<{ src: string; alt?: string }>
): CatalogScanImage[] {
  const seen = new Set<string>();
  const out: CatalogScanImage[] = [];
  for (const img of images) {
    const src = upgradeImageUrl(img.src);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({
      src,
      alt: img.alt,
      primary: out.length === 0,
      position: out.length + 1,
    });
  }
  return out;
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
      } catch {
        // skip a single failed page
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function countTotals(cats: CatalogScanCategory[]): {
  totalProducts: number;
  totalImages: number;
} {
  const products = new Map<string, CatalogScanProduct>();
  for (const c of cats) {
    for (const p of c.products) {
      if (!products.has(p.id)) products.set(p.id, p);
    }
  }
  let totalImages = 0;
  for (const p of products.values()) totalImages += p.images.length;
  return { totalProducts: products.size, totalImages };
}

function finish(
  partial: Omit<CatalogScanResult, "totalProducts" | "totalImages">
): CatalogScanResult {
  const totals = countTotals(partial.categories);
  return { ...partial, ...totals };
}

type ShopifyImage = { src: string; alt?: string; position?: number };
type ShopifyVariant = { price?: string };
type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  images?: ShopifyImage[];
  variants?: ShopifyVariant[];
};
type ShopifyCollection = { id: number; title: string; handle: string };

function mapShopifyProduct(p: ShopifyProduct, base: string): CatalogScanProduct | null {
  const images = tagImages(
    [...(p.images || [])]
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((img) => ({ src: img.src, alt: img.alt }))
  );
  if (images.length === 0) return null;
  const prices = (p.variants || [])
    .map((v) => parseAmount(v.price))
    .filter((n): n is number => n != null);
  const amount = prices.length ? Math.min(...prices) : undefined;
  return {
    id: String(p.id),
    title: p.title,
    url: `${base}/products/${p.handle}`,
    ...priceFields(amount),
    images,
  };
}

async function tryShopify(base: string): Promise<CatalogScanResult | null> {
  let collections: ShopifyCollection[] = [];
  try {
    const colRes = await fetchWithTimeout(`${base}/collections.json?limit=250`);
    if (colRes.ok) {
      const data = (await colRes.json()) as { collections?: ShopifyCollection[] };
      if (Array.isArray(data.collections) && data.collections.length > 0) {
        collections = data.collections;
      }
    }
  } catch {
    // not a public Shopify catalog
  }

  if (collections.length > 0) {
    const limited = collections.slice(0, 40);
    const fetched = await runWithConcurrency(limited, 5, async (col) => {
      try {
        const res = await fetchWithTimeout(
          `${base}/collections/${encodeURIComponent(col.handle)}/products.json?limit=250`
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { products?: ShopifyProduct[] };
        if (!Array.isArray(data.products) || data.products.length === 0) return null;
        return { col, products: data.products };
      } catch {
        return null;
      }
    });

    const cats: CatalogScanCategory[] = [];
    for (const f of fetched) {
      if (!f) continue;
      const products = f.products
        .map((p) => mapShopifyProduct(p, base))
        .filter((p): p is CatalogScanProduct => p !== null);
      if (products.length === 0) continue;
      cats.push({ name: f.col.title, handle: f.col.handle, products });
    }
    if (cats.length > 0) {
      await applyShopifyCurrency(base, cats);
      return finish({
        source: "shopify",
        domain: new URL(base).host,
        categories: cats,
      });
    }
  }

  try {
    const allCats: CatalogScanCategory[] = [];
    let page = 1;
    while (page <= 8) {
      const res = await fetchWithTimeout(`${base}/products.json?limit=250&page=${page}`);
      if (!res.ok) break;
      const data = (await res.json()) as { products?: ShopifyProduct[] };
      if (!Array.isArray(data.products) || data.products.length === 0) break;
      const products = data.products
        .map((p) => mapShopifyProduct(p, base))
        .filter((p): p is CatalogScanProduct => p !== null);
      if (products.length) {
        allCats.push({
          name: page === 1 ? "כל המוצרים" : `כל המוצרים – עמוד ${page}`,
          handle: `all-${page}`,
          products,
        });
      }
      if (data.products.length < 250) break;
      page++;
    }
    if (allCats.length > 0) {
      await applyShopifyCurrency(base, allCats);
      return finish({
        source: "shopify",
        domain: new URL(base).host,
        categories: allCats,
      });
    }
  } catch {
    // fall through
  }
  return null;
}

type WooImage = { src?: string; name?: string; alt?: string };
type WooProduct = {
  id: number;
  name: string;
  permalink?: string;
  prices?: {
    price?: string;
    currency_code?: string;
    currency_minor_unit?: number;
  };
  images?: WooImage[];
};

function mapWooProduct(p: WooProduct): CatalogScanProduct | null {
  const images = tagImages(
    (p.images || [])
      .map((img) => ({ src: img.src || "", alt: img.alt || img.name }))
      .filter((img) => img.src)
  );
  if (images.length === 0) return null;
  const minor = p.prices?.currency_minor_unit ?? 2;
  const rawPrice = p.prices?.price || "";
  const raw = parseAmount(rawPrice);
  const amount =
    raw == null ? undefined : /[.,]/.test(rawPrice) ? raw : raw / 10 ** minor;
  return {
    id: String(p.id),
    title: p.name || "מוצר",
    url: p.permalink,
    ...priceFields(amount, p.prices?.currency_code),
    images,
  };
}

async function applyShopifyCurrency(base: string, cats: CatalogScanCategory[]) {
  let currency = "";
  try {
    const res = await fetchWithTimeout(`${base}/cart.js`, {}, 6000);
    if (res.ok) {
      const data = (await res.json()) as { currency?: string };
      if (typeof data.currency === "string") currency = data.currency;
    }
  } catch {
    // price still shows as a number
  }
  if (!currency) return;
  for (const cat of cats) {
    for (const product of cat.products) {
      if (product.priceAmount == null || product.currency) continue;
      product.currency = currency.toUpperCase();
      product.priceLabel = formatCatalogPrice(product.priceAmount, currency);
    }
  }
}

async function tryWoo(base: string): Promise<CatalogScanResult | null> {
  const roots = [
    `${base}/wp-json/wc/store/v1/products`,
    `${base}/wp-json/wc/store/products`,
  ];
  for (const root of roots) {
    const products: CatalogScanProduct[] = [];
    let pages = 1;
    for (let page = 1; page <= 8 && page <= pages; page++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(`${root}?per_page=100&page=${page}`);
      } catch {
        break;
      }
      if (!res.ok) break;
      const totalPages = Number(res.headers.get("x-wp-totalpages") || "1");
      if (Number.isFinite(totalPages) && totalPages > 0) pages = totalPages;
      const data = (await res.json()) as WooProduct[] | { code?: string };
      if (!Array.isArray(data) || data.length === 0) break;
      for (const item of data) {
        const mapped = mapWooProduct(item);
        if (mapped) products.push(mapped);
      }
      if (data.length < 100) break;
    }
    if (products.length > 0) {
      return finish({
        source: "woocommerce",
        domain: new URL(base).host,
        categories: [{ name: "כל המוצרים", handle: "all", products }],
        notes: ["נמצא קטלוג WooCommerce ציבורי"],
      });
    }
  }
  return null;
}

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // ignore broken blocks
    }
  }
  return out;
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

function schemaType(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const t = (obj as { "@type"?: unknown })["@type"];
  if (typeof t === "string") return [t.toLowerCase()];
  if (Array.isArray(t)) return t.map((x) => String(x).toLowerCase());
  return [];
}

function readOffer(offers: unknown): { amount?: number; currency?: string } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  let best: { amount: number; currency?: string } | null = null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const nested = rec.offers;
    if (nested && nested !== offers) {
      const inner = readOffer(nested);
      if (inner.amount != null && (best == null || inner.amount < best.amount)) {
        best = { amount: inner.amount, currency: inner.currency };
      }
    }
    const amount = parseAmount(rec.price ?? rec.lowPrice);
    const currency = typeof rec.priceCurrency === "string" ? rec.priceCurrency : undefined;
    if (amount != null && (best == null || amount < best.amount)) {
      best = { amount, currency };
    }
  }
  return best || {};
}

function imagesFromSchema(image: unknown, base: string): CatalogScanImage[] {
  const raw: string[] = [];
  const push = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      raw.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === "object") {
      const o = v as { url?: unknown; contentUrl?: unknown };
      if (typeof o.contentUrl === "string") raw.push(o.contentUrl);
      else if (typeof o.url === "string") raw.push(o.url);
    }
  };
  push(image);
  return tagImages(raw.map((src) => ({ src: absUrl(src, base) })));
}

function productsFromHtml(html: string, pageUrl: string): CatalogScanProduct[] {
  const u = new URL(pageUrl);
  const base = `${u.protocol}//${u.host}`;
  const products: CatalogScanProduct[] = [];
  for (const item of flattenJsonLd(extractJsonLd(html))) {
    if (!schemaType(item).includes("product")) continue;
    const o = item as {
      name?: string;
      sku?: string;
      productID?: string;
      url?: string;
      image?: unknown;
      offers?: unknown;
    };
    const images = imagesFromSchema(o.image, base);
    if (images.length === 0) continue;
    const offer = readOffer(o.offers);
    const url = o.url ? absUrl(String(o.url), base) : pageUrl;
    products.push({
      id: String(o.sku || o.productID || url),
      title: o.name || "מוצר",
      url,
      ...priceFields(offer.amount, offer.currency),
      images,
    });
  }
  return products;
}

function collectLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      if (u.host !== base.host) continue;
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      out.push(u.toString());
    } catch {
      // skip bad hrefs
    }
  }
  return out;
}

function looksLikeProductUrl(url: string): boolean {
  let path = "";
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return false;
  }
  if (/\.(jpg|jpeg|png|webp|gif|svg|css|js|pdf|xml|zip)$/.test(path)) return false;
  if (
    /(cart|checkout|account|login|wp-admin|wp-json|cdn-cgi|privacy|policy|contact|about|wishlist|search)/.test(
      path
    )
  ) {
    return false;
  }
  return path
    .split("/")
    .filter(Boolean)
    .some((seg) => /^(products?|product-page|product-pages|item|items|goods|sku)$/.test(seg));
}

function looksLikeListingUrl(url: string): boolean {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return /\/(collections?|categor(y|ies)|product-category|shop|catalog|catalogue)\//.test(path);
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

async function productUrlsFromSitemaps(base: string, deadline: number): Promise<string[]> {
  if (Date.now() > deadline) return [];
  const seeds = [
    `${base}/product-sitemap.xml`,
    `${base}/sitemap_products_1.xml`,
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/wp-sitemap.xml`,
  ];
  const productUrls: string[] = [];
  const seen = new Set<string>();
  const queue = [...seeds];
  let fetched = 0;
  while (queue.length && fetched < 6 && productUrls.length < MAX_PRODUCTS && Date.now() < deadline) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    fetched++;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {}, 8000);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const text = await res.text();
    const locs = extractLocs(text);
    const childSitemaps = locs.filter((loc) => /sitemap/i.test(loc) && loc.endsWith(".xml"));
    const productish = childSitemaps.filter((loc) => /product/i.test(loc));
    for (const child of (productish.length ? productish : childSitemaps).slice(0, 4)) {
      if (!seen.has(child)) queue.push(child);
    }
    for (const loc of locs) {
      if (looksLikeProductUrl(loc) && !seen.has(loc)) {
        productUrls.push(loc);
        if (productUrls.length >= MAX_PRODUCTS) break;
      }
    }
  }
  return productUrls;
}

function dedupeProducts(products: CatalogScanProduct[]): CatalogScanProduct[] {
  const map = new Map<string, CatalogScanProduct>();
  for (const p of products) {
    const key = (p.url || p.id).replace(/\/$/, "").toLowerCase();
    const prev = map.get(key);
    if (!prev || p.images.length > prev.images.length) map.set(key, p);
  }
  return Array.from(map.values());
}

async function readProductPages(urls: string[], deadline: number): Promise<CatalogScanProduct[]> {
  const pending = urls.filter(() => Date.now() < deadline).slice(0, MAX_PRODUCTS);
  const batches = await runWithConcurrency(pending, 6, async (url) => {
    if (Date.now() > deadline) return [] as CatalogScanProduct[];
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {}, 12000);
    } catch {
      return [] as CatalogScanProduct[];
    }
    if (!res.ok) return [] as CatalogScanProduct[];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("text")) return [] as CatalogScanProduct[];
    const html = await res.text();
    return productsFromHtml(html, url);
  });
  return batches.flat().filter(Boolean);
}

async function crawlHtml(startUrl: string): Promise<CatalogScanResult | null> {
  const origin = new URL(startUrl).origin;
  const deadline = Date.now() + DEADLINE_MS;
  const sitemapUrls = await productUrlsFromSitemaps(origin, deadline);
  let productUrls = sitemapUrls;

  if (productUrls.length === 0) {
    try {
      const res = await fetchWithTimeout(startUrl, {}, 12000);
      if (res.ok) {
        const html = await res.text();
        const found = new Set<string>();
        for (const link of collectLinks(html, startUrl)) {
          if (looksLikeProductUrl(link) || looksLikeListingUrl(link)) found.add(link);
        }
        const listings = Array.from(found).filter(looksLikeListingUrl).slice(0, 8);
        const direct = Array.from(found).filter(looksLikeProductUrl);
        for (const listing of listings) {
          if (Date.now() > deadline) break;
          try {
            const page = await fetchWithTimeout(listing, {}, 10000);
            if (!page.ok) continue;
            const listingHtml = await page.text();
            for (const link of collectLinks(listingHtml, listing)) {
              if (looksLikeProductUrl(link)) direct.push(link);
            }
            productUrls = productUrls.concat(productsFromHtml(listingHtml, listing).map((p) => p.url || ""));
          } catch {
            // skip a listing that failed
          }
        }
        productUrls = Array.from(new Set([...direct, ...productUrls.filter(Boolean)]));
        if (productUrls.length === 0) {
          const onPage = productsFromHtml(html, startUrl);
          if (onPage.length) {
            return finish({
              source: "html",
              domain: new URL(origin).host,
              categories: [{ name: "כל המוצרים", handle: "all", products: dedupeProducts(onPage) }],
            });
          }
        }
      }
    } catch {
      // fall through
    }
  }

  const products = await readProductPages(productUrls, deadline);
  const unique = dedupeProducts(products).slice(0, MAX_PRODUCTS);
  if (unique.length === 0) return null;
  const notes: string[] = [];
  if (sitemapUrls.length > unique.length) {
    notes.push(`נמשכו ${unique.length} מוצרים מתוך ${sitemapUrls.length} שמופיעים באתר`);
  }
  return finish({
    source: sitemapUrls.length ? "sitemap" : "html",
    domain: new URL(origin).host,
    categories: [{ name: "כל המוצרים", handle: "all", products: unique }],
    truncated: sitemapUrls.length > unique.length || unique.length >= MAX_PRODUCTS,
    notes,
  });
}

export async function scanCatalog(rawUrl: string): Promise<CatalogScanResult> {
  const { base, full } = normalizeCatalogUrl(rawUrl);
  const path = new URL(full).pathname;
  const focus = path.split("/").filter(Boolean).pop();

  const shop = await tryShopify(base);
  if (shop) {
    if (focus) {
      const match = shop.categories.find(
        (c) => c.handle === focus || c.handle === decodeURIComponent(focus)
      );
      if (match) shop.focusHandle = match.handle;
    }
    return shop;
  }

  const woo = await tryWoo(base);
  if (woo) return woo;

  const crawled = await crawlHtml(path === "/" ? base : full);
  if (crawled) return crawled;

  throw new Error(
    "לא הצלחנו לזהות מוצרים בכתובת. נסה את דף הבית של החנות, או עמוד קטגוריה עם המוצרים."
  );
}
