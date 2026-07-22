// Tracks which history items were published to the connected store.

const PUBLISHED_IDS_KEY = "photospro:published-item-ids";
const PUBLISHED_URLS_KEY = "photospro:published-after-urls";

function readIdSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(
      localStorage.getItem(PUBLISHED_IDS_KEY) || "[]"
    ) as string[];
    return new Set(raw);
  } catch {
    return new Set();
  }
}

function readUrlSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(
      localStorage.getItem(PUBLISHED_URLS_KEY) || "[]"
    ) as string[];
    return new Set(raw);
  } catch {
    return new Set();
  }
}

function writeIdSet(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PUBLISHED_IDS_KEY, JSON.stringify([...ids]));
}

function writeUrlSet(urls: Set<string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PUBLISHED_URLS_KEY, JSON.stringify([...urls]));
}

export function markItemPublished(itemId: string, afterUrl?: string): void {
  if (itemId) {
    const ids = readIdSet();
    ids.add(itemId);
    writeIdSet(ids);
  }
  if (afterUrl) {
    const urls = readUrlSet();
    urls.add(afterUrl.split("?")[0]);
    writeUrlSet(urls);
  }
}

export function isItemPublished(itemId: string, afterUrl?: string): boolean {
  if (itemId && readIdSet().has(itemId)) return true;
  if (afterUrl && readUrlSet().has(afterUrl.split("?")[0])) return true;
  return false;
}

export function getPublishedItemIds(): Set<string> {
  return readIdSet();
}
