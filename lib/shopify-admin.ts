export const SHOPIFY_API_VERSION = "2025-01";

export function normalizeShopHost(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

export function assertMyshopifyHost(host: string): string {
  const normalized = normalizeShopHost(host);
  if (!normalized.endsWith(".myshopify.com")) {
    throw new Error(
      "כתובת חנות לא תקינה. השתמש בכתובת myshop.myshopify.com."
    );
  }
  return normalized;
}

export function gidToNum(gid: string | number | null | undefined): number {
  if (typeof gid === "number") return gid;
  if (!gid) return 0;
  const m = String(gid).match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

export function collectionGid(id: number | string): string {
  return `gid://shopify/Collection/${id}`;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export async function shopifyGraphql<T>(
  host: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const shop = assertMyshopifyHost(host);
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );

  const text = await res.text().catch(() => "");
  let payload: GraphQLResponse<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as GraphQLResponse<T>) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail =
      payload?.errors?.[0]?.message ||
      (text.includes("Only HTML requests")
        ? "Shopify דורש GraphQL API. נסה לחבר מחדש את החנות."
        : text.slice(0, 200));
    throw new Error(`שגיאה ${res.status} ${detail}`);
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  if (!payload?.data) {
    throw new Error("תגובה ריקה מ-Shopify GraphQL");
  }

  return payload.data;
}

export type ShopifyAdminProduct = {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  status?: string;
  vendor?: string;
  featuredImageId?: number;
  createdAt?: number;
  images: Array<{
    id: number;
    src: string;
    alt: string | null;
    position: number;
    width?: number;
    height?: number;
  }>;
};

type GraphQLMediaImage = {
  id?: string;
  image?: {
    url?: string;
    altText?: string | null;
    width?: number;
    height?: number;
  } | null;
};

type GraphQLProductNode = {
  id: string;
  title: string;
  handle: string;
  productType?: string | null;
  status?: string | null;
  vendor?: string | null;
  createdAt?: string | null;
  featuredImage?: {
    id?: string;
    url?: string;
    altText?: string | null;
    width?: number;
    height?: number;
  } | null;
  images?: {
    edges?: Array<{
      node?: {
        id?: string;
        url?: string;
        altText?: string | null;
        width?: number;
        height?: number;
      } | null;
    }>;
  };
  media?: {
    edges?: Array<{ node?: GraphQLMediaImage | null }>;
  };
};

const PRODUCTS_QUERY = `
  query ListProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          productType
          status
          vendor
          createdAt
          featuredImage {
            id
            url
            altText
            width
            height
          }
          images(first: 20) {
            edges {
              node {
                id
                url
                altText
                width
                height
              }
            }
          }
          media(first: 20) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query CollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            productType
            status
            vendor
            createdAt
            featuredImage {
              id
              url
              altText
              width
              height
            }
            images(first: 20) {
              edges {
                node {
                  id
                  url
                  altText
                  width
                  height
                }
              }
            }
            media(first: 20) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image {
                      url
                      altText
                      width
                      height
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function mapGraphqlProduct(
  node: GraphQLProductNode,
  opts?: { allowWithoutImage?: boolean }
): ShopifyAdminProduct | null {
  const images: ShopifyAdminProduct["images"] = [];

  for (const edge of node.images?.edges || []) {
    const img = edge?.node;
    if (!img?.url) continue;
    images.push({
      id: gidToNum(img.id),
      src: img.url,
      alt: img.altText ?? null,
      position: images.length + 1,
      width: img.width,
      height: img.height,
    });
  }

  if (images.length === 0) {
    for (const edge of node.media?.edges || []) {
      const media = edge?.node;
      const img = media?.image;
      if (!img?.url || !media) continue;
      images.push({
        id: gidToNum(media.id),
        src: img.url,
        alt: img.altText ?? null,
        position: images.length + 1,
        width: img.width,
        height: img.height,
      });
    }
  }

  if (node.featuredImage?.url) {
    const featuredId = gidToNum(node.featuredImage.id);
    const exists = images.some((img) => img.id === featuredId);
    if (!exists) {
      images.unshift({
        id: featuredId,
        src: node.featuredImage.url,
        alt: node.featuredImage.altText ?? null,
        position: 0,
        width: node.featuredImage.width,
        height: node.featuredImage.height,
      });
    }
  }

  if (images.length === 0 && !opts?.allowWithoutImage) return null;

  images.forEach((img, i) => {
    img.position = i + 1;
  });

  const featuredImageId =
    gidToNum(node.featuredImage?.id) || images[0]?.id || undefined;

  return {
    id: gidToNum(node.id),
    title: node.title,
    handle: node.handle,
    product_type: node.productType || undefined,
    status: node.status?.toLowerCase() || undefined,
    vendor: node.vendor || undefined,
    featuredImageId,
    createdAt: node.createdAt ? Date.parse(node.createdAt) : undefined,
    images,
  };
}

async function fetchProductPage(
  host: string,
  token: string,
  args: {
    first: number;
    after?: string;
    collectionId?: number | string;
    query?: string;
    allowWithoutImage?: boolean;
  }
): Promise<{ products: ShopifyAdminProduct[]; hasNextPage: boolean; endCursor?: string }> {
  const mapNode = (node: GraphQLProductNode) =>
    mapGraphqlProduct(node, { allowWithoutImage: args.allowWithoutImage });
  if (args.collectionId) {
    const data = await shopifyGraphql<{
      collection?: {
        products?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          edges?: Array<{ node?: GraphQLProductNode | null }>;
        } | null;
      } | null;
    }>(host, token, COLLECTION_PRODUCTS_QUERY, {
      id: collectionGid(args.collectionId),
      first: args.first,
      after: args.after || null,
    });

    const connection = data.collection?.products;
    const products = (connection?.edges || [])
      .map((edge) => (edge?.node ? mapNode(edge.node) : null))
      .filter((p): p is ShopifyAdminProduct => p !== null);

    return {
      products,
      hasNextPage: !!connection?.pageInfo?.hasNextPage,
      endCursor: connection?.pageInfo?.endCursor || undefined,
    };
  }

  const data = await shopifyGraphql<{
    products?: {
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      edges?: Array<{ node?: GraphQLProductNode | null }>;
    };
  }>(host, token, PRODUCTS_QUERY, {
    first: args.first,
    after: args.after || null,
    query: args.query || "status:active",
  });

  const connection = data.products;
  const products = (connection?.edges || [])
    .map((edge) => (edge?.node ? mapNode(edge.node) : null))
    .filter((p): p is ShopifyAdminProduct => p !== null);

  return {
    products,
    hasNextPage: !!connection?.pageInfo?.hasNextPage,
    endCursor: connection?.pageInfo?.endCursor || undefined,
  };
}

export async function fetchAllProductsGraphql(
  host: string,
  token: string,
  opts: {
    limit?: number;
    collectionId?: number | string;
    fetchAll?: boolean;
    pageInfo?: string;
    query?: string;
  } = {}
): Promise<{ products: ShopifyAdminProduct[]; nextPageInfo?: string }> {
  const limit = Math.max(1, Math.min(250, opts.limit || 250));
  const fetchAll = opts.fetchAll !== false && !opts.pageInfo;
  const all: ShopifyAdminProduct[] = [];
  let after: string | undefined = opts.pageInfo;
  const MAX_PAGES = 60;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchProductPage(host, token, {
      first: limit,
      after,
      collectionId: opts.collectionId,
      query: opts.query,
      allowWithoutImage: opts.query === "status:draft",
    });
    all.push(...result.products);

    if (!fetchAll || !result.hasNextPage || !result.endCursor) {
      return {
        products: all,
        nextPageInfo: fetchAll ? undefined : result.endCursor,
      };
    }
    after = result.endCursor;
  }

  return { products: all };
}

export type ShopifyAdminCollection = {
  id: number;
  handle: string;
  title: string;
  productsCount: number;
  imageSrc?: string;
};

const COLLECTIONS_QUERY = `
  query ListCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          productsCount {
            count
          }
          image {
            url
          }
        }
      }
    }
  }
`;

export async function fetchCollectionsGraphql(
  host: string,
  token: string
): Promise<ShopifyAdminCollection[]> {
  const shop = assertMyshopifyHost(host);
  const all: ShopifyAdminCollection[] = [];
  let after: string | undefined;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await shopifyGraphql<{
      collections?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        edges?: Array<{
          node?: {
            id?: string;
            title?: string;
            handle?: string;
            productsCount?: { count?: number | null } | null;
            image?: { url?: string | null } | null;
          } | null;
        }>;
      };
    }>(shop, token, COLLECTIONS_QUERY, {
      first: 250,
      after: after || null,
    });

    for (const edge of data.collections?.edges || []) {
      const node = edge?.node;
      if (!node?.title || !node.id) continue;
      all.push({
        id: gidToNum(node.id),
        handle: node.handle || String(gidToNum(node.id)),
        title: node.title,
        productsCount:
          typeof node.productsCount?.count === "number"
            ? node.productsCount.count
            : 0,
        imageSrc: node.image?.url || undefined,
      });
    }

    if (
      !data.collections?.pageInfo?.hasNextPage ||
      !data.collections.pageInfo.endCursor
    ) {
      break;
    }
    after = data.collections.pageInfo.endCursor;
  }

  all.sort((a, b) => a.title.localeCompare(b.title, "he"));
  return all;
}

type RestCollectionRow = {
  id: number;
  handle: string;
  title: string;
  products_count?: number | null;
  image?: { src?: string | null } | null;
};

async function shopifyRestGet<T>(
  host: string,
  token: string,
  path: string
): Promise<T> {
  const shop = assertMyshopifyHost(host);
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`,
    {
      headers: {
        "X-Shopify-Access-Token": token,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const text = await res.text().catch(() => "");
  let payload: T | null = null;
  try {
    payload = text ? (JSON.parse(text) as T) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(
      `REST ${res.status}: ${text.slice(0, 200) || "שגיאה לא ידועה"}`
    );
  }

  if (!payload) {
    throw new Error("תגובה ריקה מ-Shopify REST");
  }

  return payload;
}

function mapRestCollections(rows: RestCollectionRow[]): ShopifyAdminCollection[] {
  return rows.map((c) => ({
    id: c.id,
    handle: c.handle || String(c.id),
    title: c.title,
    productsCount:
      typeof c.products_count === "number" ? c.products_count : 0,
    imageSrc: c.image?.src || undefined,
  }));
}

export async function fetchCollectionsRest(
  host: string,
  token: string
): Promise<ShopifyAdminCollection[]> {
  const [custom, smart] = await Promise.all([
    shopifyRestGet<{ custom_collections?: RestCollectionRow[] }>(
      host,
      token,
      "/custom_collections.json?limit=250"
    ),
    shopifyRestGet<{ smart_collections?: RestCollectionRow[] }>(
      host,
      token,
      "/smart_collections.json?limit=250"
    ),
  ]);

  const all = [
    ...mapRestCollections(custom.custom_collections || []),
    ...mapRestCollections(smart.smart_collections || []),
  ];
  all.sort((a, b) => a.title.localeCompare(b.title, "he"));
  return all;
}

/** GraphQL first; REST fallback if GraphQL fails or returns empty. */
export async function fetchCollections(
  host: string,
  token: string
): Promise<ShopifyAdminCollection[]> {
  try {
    const gql = await fetchCollectionsGraphql(host, token);
    if (gql.length > 0) return gql;
  } catch (err) {
    console.warn("[shopify] GraphQL collections failed, trying REST:", err);
  }

  return fetchCollectionsRest(host, token);
}
