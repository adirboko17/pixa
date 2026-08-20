export type Category = {
  id: string;
  name: string;
  count: number;
  /** Optional preview image (used for Shopify collection thumbnails). */
  imageSrc?: string;
};

export type Product = {
  id: number;
  name: string;
  price: number;
  category: string;
  img: string;
  optimized: boolean;
  /** Unix ms — when the product was added (Shopify createdAt or local upload). */
  createdAt?: number;
};

/**
 * Product type used in the UI when the user has connected a real Shopify
 * store. Looks like a regular product (so the existing UI keeps working)
 * but carries the original Shopify image URL + ids so we can:
 *   1) display the real image instead of an Unsplash placeholder,
 *   2) re-fetch the original bytes on the server side before /api/process,
 *   3) upload the optimized result back to the right product/image.
 */
export type ShopifyBackedProduct = Product & {
  isShopify: true;
  imageUrl: string;
  imageId?: number;
  vendor?: string;
  productType?: string;
};

/**
 * Product backed by a Lovable / Supabase custom API.
 * `externalId` is the real UUID from the remote database.
 */
export type CustomBackedProduct = Product & {
  isCustomApi: true;
  externalId: string;
  imageUrl: string;
};

export type StoreBackedProduct = ShopifyBackedProduct | CustomBackedProduct;

export type Preset = {
  id: string;
  name: string;
  tag: string;
  gradient: string;
  accent: string;
  desc: string;
  /** When false, preset is visible but not selectable. */
  available?: boolean;
  comingSoon?: boolean;
};

export type ProcessingOptions = {
  presetId: string;
  removeBackground: boolean;
  keepProportion: boolean;
  /** Keep every identical unit in a pack/bundle photo (default true). */
  preservePackUnits: boolean;
};

/** @deprecated Demo-only — not used in production screens. */
export type Batch = {
  id: string;
  name: string;
  preset: string;
  count: number;
  date: string;
  status: string;
};

export type HistoryBatchItem = {
  id: string;
  productName: string;
  beforeUrl?: string;
  afterUrl?: string;
  status: "success" | "failed";
  error?: string;
  shopifyProductId?: number;
  externalProductId?: string;
  sourceType?: "shopify" | "custom-api" | "upload";
  /** Set by UI when item was already published to the store. */
  published?: boolean;
  /** Whether this item can be published from history. */
  publishable?: boolean;
};

export type HistoryBatch = {
  id: string;
  name: string;
  preset: string;
  count: number;
  successful: number;
  failed: number;
  createdAt: Date;
  status: "completed" | "partial" | "failed";
  previewUrl?: string;
  items?: HistoryBatchItem[];
};

export const CATEGORIES: Category[] = [
  { id: "all", name: "הכל", count: 248 },
  { id: "fashion", name: "אופנה", count: 84 },
  { id: "beauty", name: "יופי וקוסמטיקה", count: 36 },
  { id: "home", name: "בית ועיצוב", count: 42 },
  { id: "electronics", name: "אלקטרוניקה", count: 28 },
  { id: "jewelry", name: "תכשיטים", count: 19 },
  { id: "food", name: "מזון", count: 22 },
  { id: "sport", name: "ספורט", count: 17 },
];

export const PRODUCTS: Product[] = [
  { id: 1, name: "נעלי סניקרס לבנות", price: 349, category: "fashion", img: "photo-1542291026-7eec264c27ff", optimized: false },
  { id: 2, name: "תיק יד עור חום", price: 580, category: "fashion", img: "photo-1548036328-c9fa89d128fa", optimized: true },
  { id: 3, name: "שעון יד מינימליסטי", price: 890, category: "jewelry", img: "photo-1523275335684-37898b6baf30", optimized: false },
  { id: 4, name: "אוזניות אלחוטיות", price: 420, category: "electronics", img: "photo-1505740420928-5e560c06d30e", optimized: false },
  { id: 5, name: "בקבוק בושם פרחוני", price: 240, category: "beauty", img: "photo-1541643600914-78b084683601", optimized: false },
  { id: 6, name: "משקפי שמש קלאסיים", price: 180, category: "fashion", img: "photo-1572635196237-14b3f281503f", optimized: false },
  { id: 7, name: "כורסא קטיפה ירוקה", price: 1890, category: "home", img: "photo-1555041469-a586c61ea9bc", optimized: false },
  { id: 8, name: "נר ריחני וניל", price: 89, category: "home", img: "photo-1602874801007-bd458bb1b8b6", optimized: true },
  { id: 9, name: "מצלמה אנלוגית", price: 720, category: "electronics", img: "photo-1495121605193-b116b5b9c5fe", optimized: false },
  { id: 10, name: "טבעת זהב יהלום", price: 2400, category: "jewelry", img: "photo-1605100804763-247f67b3557e", optimized: false },
  { id: 11, name: "כובע פנמה", price: 145, category: "fashion", img: "photo-1521369909029-2afed882baee", optimized: false },
  { id: 12, name: "מיני סבון אורגני", price: 32, category: "beauty", img: "photo-1556228720-195a672e8a03", optimized: false },
  { id: 13, name: "אספרסו פרימיום 250 גרם", price: 78, category: "food", img: "photo-1559056199-641a0ac8b55e", optimized: false },
  { id: 14, name: "מחבט טניס מקצועי", price: 540, category: "sport", img: "photo-1622279457486-62dcc4a431d6", optimized: false },
  { id: 15, name: "נעלי ריצה כתומות", price: 380, category: "sport", img: "photo-1606107557195-0e29a4b5b4aa", optimized: false },
  { id: 16, name: "אגרטל קרמיקה", price: 220, category: "home", img: "photo-1578500494198-246f612d3b3d", optimized: false },
  { id: 17, name: "קרם פנים יוקרתי", price: 320, category: "beauty", img: "photo-1556228453-efd6c1ff04f6", optimized: false },
  { id: 18, name: "שרשרת זהב מעודנת", price: 690, category: "jewelry", img: "photo-1599643478518-a784e5dc4c8f", optimized: false },
  { id: 19, name: "מקלדת מכאנית", price: 480, category: "electronics", img: "photo-1587829741301-dc798b83add3", optimized: false },
  { id: 20, name: "שמלת קיץ פרחונית", price: 290, category: "fashion", img: "photo-1572804013309-59a88b7e92f1", optimized: true },
  { id: 21, name: "שוקולד פרלינים", price: 64, category: "food", img: "photo-1548907040-4baa42d10919", optimized: false },
  { id: 22, name: "מנורת שולחן מודרנית", price: 340, category: "home", img: "photo-1507473885765-e6ed057f782c", optimized: false },
  { id: 23, name: "תיק גב טכני", price: 410, category: "sport", img: "photo-1553062407-98eeb64c6a62", optimized: false },
  { id: 24, name: "יין אדום יוקרתי", price: 220, category: "food", img: "photo-1553361371-9b22f78e8b1d", optimized: false },
];

export const PRESETS: Preset[] = [
  {
    id: "studio-white",
    name: "סטודיו לבן",
    tag: "הכי פופולרי",
    gradient: "linear-gradient(135deg, #f8f8f8, #e0e0e0)",
    accent: "#fff",
    desc: "רקע לבן נקי, צל רך",
    available: true,
  },
  {
    id: "lifestyle",
    name: "לייפסטייל",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #FFD8C2, #F4A584)",
    accent: "#FF8A47",
    desc: "סצנה אותנטית עם תאורת יום",
    available: false,
    comingSoon: true,
  },
  {
    id: "outdoor",
    name: "חוץ / טבע",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #88C9A1, #4B9F7C)",
    accent: "#25D396",
    desc: "רקע ירוק, אור שמש",
    available: false,
    comingSoon: true,
  },
  {
    id: "marble",
    name: "שיש מבריק",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #F0EDE8, #C8C1B5)",
    accent: "#C8C1B5",
    desc: "משטח שיש מהודר",
    available: false,
    comingSoon: true,
  },
  {
    id: "sunset",
    name: "שקיעה חמה",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #FFB36E, #FF6B6B, #B040E0)",
    accent: "#FF6B6B",
    desc: "גרדיאנט חם וזוהר",
    available: false,
    comingSoon: true,
  },
  {
    id: "dark-luxe",
    name: "דארק לקס",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #1a1a2e, #16213e)",
    accent: "#0E0B17",
    desc: "רקע שחור מבריק",
    available: false,
    comingSoon: true,
  },
  {
    id: "pastel-pink",
    name: "פסטל ורוד",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #FFD6E0, #FFB6C7)",
    accent: "#FF3D8B",
    desc: "רך, נשי, יוקרתי",
    available: false,
    comingSoon: true,
  },
  {
    id: "gradient-pop",
    name: "גרדיאנט נועז",
    tag: "Coming Soon",
    gradient: "linear-gradient(135deg, #3D4BFF, #B040E0, #FF3D8B)",
    accent: "#B040E0",
    desc: "צבעוני, אנרגטי, סקרולי",
    available: false,
    comingSoon: true,
  },
];

export const RECENT_BATCHES: Batch[] = [
  { id: "b1", name: "קולקציית קיץ — אופנה", preset: "lifestyle", count: 18, date: "לפני שעתיים", status: "sent" },
  { id: "b2", name: "תכשיטי זהב חדשים", preset: "dark-luxe", count: 6, date: "אתמול", status: "sent" },
  { id: "b3", name: "מבחר נרות ובישומים", preset: "marble", count: 12, date: "אתמול", status: "sent" },
  { id: "b4", name: "נעלי ריצה — קמפיין", preset: "outdoor", count: 9, date: "לפני 3 ימים", status: "sent" },
  { id: "b5", name: "אלקטרוניקה — שיפוץ קטלוג", preset: "studio-white", count: 24, date: "לפני שבוע", status: "sent" },
];

export const buildImgUrl = (id: string, w = 600) =>
  `https://images.unsplash.com/${id}?w=${w}&h=${w}&fit=crop&q=80&auto=format`;

export const fmtDate = (d: Date = new Date()) => {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const months = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
  ];
  return `${days[d.getDay()]} · ${d.getDate()} ב${months[d.getMonth()]}`;
};

export const fmtTime = (d: Date = new Date()) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

export const fmtMonthYear = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export const fmtRelativeTime = (d: Date) => {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
  return fmtDate(d);
};
