"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "./icons";
import {
  type Category,
  type CustomBackedProduct,
  type HistoryBatch,
  type ShopifyBackedProduct,
  type StoreBackedProduct,
  type ProcessingOptions,
  PRESETS,
} from "./data";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/lib/supabase/auth";
import type { Session } from "@supabase/supabase-js";
import {
  Layout,
  LoginScreen,
  ConnectScreen,
  type NavId,
} from "./screens-shell";
import {
  DashboardScreen,
  ProductsScreen,
  ResultsScreen,
  HistoryScreen,
  SettingsScreen,
  PresetPickerModal,
  ProcessingOverlay,
  MAX_BATCH_SELECT,
  type UploadedProduct,
  type AnyProduct,
  type ProcessedResult,
} from "./screens-app";
import { RegisterScreen } from "./screens-register";
import {
  listCollections,
  listProducts,
  uploadProductImage,
  type ShopifyCollection,
  type ShopifyProduct,
} from "@/lib/shopify-client";
import {
  listCustomApiProducts,
  stableProductId,
  uploadCustomApiProductImage,
  type CustomApiProduct,
} from "@/lib/custom-api-client";
import {
  clearStoreConnection,
  getConnectionLabel,
  getConnectionPlatformLabel,
  saveStoreConnection,
  type StoreConnection,
} from "@/lib/store-connection";
import {
  clearRemoteStoreConnection,
  loadRemoteStoreConnection,
  persistRemoteStoreConnection,
} from "@/lib/store-connection-remote";
import type { Quality } from "@/lib/pricing";
import { loadBatchHistory, persistBatch, repairBatchHistoryNames } from "@/lib/batch-history";
import { markItemPublished } from "@/lib/publish-tracker";
import { isLegacyBatchProductName } from "@/lib/product-name-resolver";

type Stage = "login" | "register" | "onboarding" | "connect" | "app";
type AppRoute = NavId | "results";

let uploadIdSeed = 1_000_000;

function mapShopifyToProducts(
  shopify: ShopifyProduct[]
): ShopifyBackedProduct[] {
  return shopify
    .map((p): ShopifyBackedProduct | null => {
      const featured =
        p.images.find((img) => img.id === p.featuredImageId) || p.images[0];
      if (!featured) return null;
      return {
        id: p.id,
        name: p.title,
        price: 0,
        category: "all",
        img: "",
        optimized: false,
        isShopify: true,
        imageUrl: featured.src,
        imageId: featured.id,
        vendor: p.vendor,
        productType: p.product_type,
        createdAt: p.createdAt,
      };
    })
    .filter((p): p is ShopifyBackedProduct => p !== null);
}

function mapCustomApiToProducts(
  products: CustomApiProduct[]
): CustomBackedProduct[] {
  return products
    .map((p): CustomBackedProduct | null => {
      const imageUrl =
        p.image_url ||
        p.images?.find((img) => img.url)?.url ||
        p.images?.[0]?.url;
      if (!imageUrl) return null;
      return {
        id: stableProductId(p.id),
        externalId: p.id,
        name: p.title,
        price: 0,
        category: "all",
        img: "",
        optimized: false,
        isCustomApi: true,
        imageUrl,
      };
    })
    .filter((p): p is CustomBackedProduct => p !== null);
}

function mapShopifyCollections(collections: ShopifyCollection[]): Category[] {
  return collections.map((c) => ({
    id: String(c.id),
    name: c.title,
    count: typeof c.productsCount === "number" ? c.productsCount : 0,
    imageSrc: c.imageSrc,
  }));
}

export default function PixaApp() {
  const [stage, setStage] = useState<Stage>("login");
  const [route, setRoute] = useState<AppRoute>("dashboard");
  const [connection, setConnection] = useState<StoreConnection | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  /**
   * Whether the user has finished the brand-avatar onboarding wizard
   * (a row exists in `public.brand_avatars` for them).
   * - null  → unknown, still loading
   * - true  → completed, can proceed
   * - false → never finished, must run the wizard
   */
  const [hasBrandAvatar, setHasBrandAvatar] = useState<boolean | null>(null);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [uploads, setUploads] = useState<UploadedProduct[]>([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showProcessing, setShowProcessing] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("studio-white");
  const [processingOptions, setProcessingOptions] = useState<ProcessingOptions>({
    presetId: "studio-white",
    removeBackground: true,
    keepProportion: true,
    preservePackUnits: true,
  });
  const processingQuality: Quality = "low";
  const [processingProducts, setProcessingProducts] = useState<AnyProduct[]>(
    []
  );
  const [pendingBatchIds, setPendingBatchIds] = useState<number[]>([]);
  const [results, setResults] = useState<ProcessedResult[]>([]);
  const [batchHistory, setBatchHistory] = useState<HistoryBatch[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Live store catalog (Shopify or custom API).
  const [shopifyProducts, setShopifyProducts] = useState<StoreBackedProduct[]>(
    []
  );
  const [shopifyCategories, setShopifyCategories] = useState<Category[]>([]);
  const [shopifyCatalogTotal, setShopifyCatalogTotal] = useState(0);
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [shopifyError, setShopifyError] = useState<string | null>(null);

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  /* ---------- Boot: read Supabase session + stored Shopify connection ---------- */
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const applySignedIn = (s: Session) => {
      if (!mounted) return;
      setSession(s);
      setUserEmail(s.user.email ?? null);
    };

    const applySignedOut = () => {
      if (!mounted) return;
      setSession(null);
      setUserEmail(null);
      setConnection(null);
      setConnectionLoaded(false);
      clearStoreConnection();
      setHasBrandAvatar(null);
      setStage((curr) => (curr === "register" ? "register" : "login"));
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) applySignedIn(data.session);
      else applySignedOut();
      setAuthChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        applySignedOut();
        setAuthChecked(true);
        return;
      }
      if (s) {
        applySignedIn(s);
        setAuthChecked(true);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ---------- Load saved store connection from Supabase (per account) ---------- */
  useEffect(() => {
    if (!session?.user?.id) {
      setConnectionLoaded(false);
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    setConnectionLoaded(false);

    void (async () => {
      try {
        const remote = await loadRemoteStoreConnection(supabase, session.user.id);
        if (cancelled) return;
        if (remote) {
          saveStoreConnection(remote);
          setConnection(remote);
        } else {
          clearStoreConnection();
          setConnection(null);
        }
      } catch (e) {
        console.warn("[pixa] failed to load store connection", e);
        if (!cancelled) setConnection(null);
      } finally {
        if (!cancelled) setConnectionLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  /* ---------- Load profile (business_name) once signed in ---------- */
  useEffect(() => {
    if (!session?.user?.id) {
      setProfileName(null);
      setHasBrandAvatar(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("business_name")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.business_name) setProfileName(data.business_name);
      });
    supabase
      .from("brand_avatars")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setHasBrandAvatar(!!data);
      });
  }, [session?.user?.id]);

  /* ---------- Load processing history from Supabase ---------- */
  useEffect(() => {
    if (!session?.user?.id) {
      setBatchHistory([]);
      return;
    }
    let cancelled = false;
    loadBatchHistory(session.user.id).then((batches) => {
      if (!cancelled) setBatchHistory(batches);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  /** Resolved screen while signed in (avoids login flash on refresh). */
  const routeStage = useMemo((): Stage => {
    if (!session) {
      return stage === "register" ? "register" : "login";
    }
    if (hasBrandAvatar === null || !connectionLoaded) {
      return "app";
    }
    if (!hasBrandAvatar) return "onboarding";
    if (!connection) return "connect";
    return "app";
  }, [session, stage, hasBrandAvatar, connectionLoaded, connection]);

  /* ---------- Decide stage once we know auth + brand-avatar status ---------- */
  useEffect(() => {
    if (!session) return;
    if (hasBrandAvatar === null) return;
    if (!connectionLoaded) return;
    setStage((curr) => {
      // Don't yank users out of the active app once they're in.
      if (curr === "app") return "app";
      if (!hasBrandAvatar) return "onboarding";
      return connection ? "app" : "connect";
    });
    if (connection && hasBrandAvatar) setRoute("dashboard");
  }, [session, hasBrandAvatar, connection, connectionLoaded]);

  /* ---------- Cleanup object URLs on unmount ---------- */
  useEffect(() => {
    return () => {
      uploads.forEach((u) => URL.revokeObjectURL(u.fileUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Load store catalog whenever connection changes ---------- */
  const loadShopifyCatalog = useCallback(
    async (conn: StoreConnection, collectionId?: string) => {
      setLoadingShopify(true);
      setShopifyError(null);
      try {
        if (conn.platform === "custom-api") {
          const { products } = await listCustomApiProducts(conn);
          const mapped = mapCustomApiToProducts(products);
          setShopifyProducts(mapped);
          setShopifyCatalogTotal(mapped.length);
          setShopifyCategories([]);
          return;
        }

        const collectionNum =
          collectionId && collectionId !== "all"
            ? Number(collectionId)
            : undefined;
        const [{ products }, { collections }] = await Promise.all([
          listProducts(conn, {
            fetchAll: true,
            ...(collectionNum ? { collectionId: collectionNum } : {}),
          }),
          collectionNum
            ? Promise.resolve({ collections: [] as ShopifyCollection[] })
            : listCollections(conn).catch((err) => {
                console.warn("[pixa] failed to load Shopify collections:", err);
                return { collections: [] as ShopifyCollection[] };
              }),
        ]);
        const mapped = mapShopifyToProducts(products);
        setShopifyProducts(mapped);
        if (!collectionNum) {
          setShopifyCatalogTotal(mapped.length);
          setShopifyCategories(mapShopifyCollections(collections));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "שגיאה לא ידועה";
        setShopifyError(msg);
        setShopifyProducts([]);
        if (!collectionId) {
          setShopifyCategories([]);
          setShopifyCatalogTotal(0);
        }
      } finally {
        setLoadingShopify(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!connection || !session?.user?.id) {
      if (!connection) {
        setShopifyProducts([]);
        setShopifyCategories([]);
        setShopifyCatalogTotal(0);
      }
      return;
    }
    void loadShopifyCatalog(connection);
  }, [connection, session?.user?.id, loadShopifyCatalog]);

  /* ---------- Resolve Shopify product names for legacy history rows ---------- */
  useEffect(() => {
    if (!connection || shopifyProducts.length === 0 || batchHistory.length === 0) {
      return;
    }
    const needsRepair = batchHistory.some((b) =>
      b.items?.some((i) => isLegacyBatchProductName(i.productName))
    );
    if (!needsRepair) return;

    let cancelled = false;
    void repairBatchHistoryNames(batchHistory, shopifyProducts).then((repaired) => {
      if (!cancelled && repaired !== batchHistory) {
        setBatchHistory(repaired);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection, shopifyProducts, batchHistory]);

  /* ---------- Auth flow ----------
   * Note: most stage transitions are driven by the `onAuthStateChange`
   * subscription above. These handlers exist for UI affordances only.
   */
  const handleLogin = () => {
    // The session listener will set stage to "connect" or "app".
    // This is a no-op fallback in case the listener races.
    setStage(connection ? "app" : "connect");
  };
  const handleRegisterComplete = () => {
    // After the registration wizard finishes, the user is signed-in
    // (Supabase set the session at step 0) AND the brand_avatars row
    // has been written at step 5. Mark it locally so we don't loop back.
    setHasBrandAvatar(true);
    setStage("connect");
  };
  const goToRegister = () => setStage("register");
  const goToLogin = () => setStage("login");

  const handleRegisterCancel = async () => {
    if (session) {
      await handleLogout();
      return;
    }
    goToLogin();
  };

  /**
   * Called when the user finishes the brand-only wizard (after login).
   * The wizard already saved the brand_avatar row, so we just flip the flag.
   */
  const handleOnboardingComplete = () => {
    setHasBrandAvatar(true);
    // Effect above will route them to "connect" or "app".
  };

  const handleConnected = async (conn: StoreConnection) => {
    saveStoreConnection(conn);
    setConnection(conn);
    setConnectionLoaded(true);
    setStage("app");
    setRoute("dashboard");
    pushToast(`החנות "${getConnectionLabel(conn)}" חוברה בהצלחה!`);

    if (session?.user?.id) {
      try {
        const supabase = createClient();
        await persistRemoteStoreConnection(supabase, session.user.id, conn);
      } catch (e) {
        console.error("[pixa] failed to save store connection", e);
        pushToast("החנות חוברה, אך השמירה בענן נכשלה — נסה שוב מההגדרות");
      }
    }
  };

  /**
   * The Shopify connection step is optional. If the user skips it, send them
   * straight to the app — they'll work with mock products + their own uploads
   * until they decide to connect from settings later on.
   */
  const handleSkipConnect = () => {
    setStage("app");
    setRoute("dashboard");
    pushToast("דילגת על חיבור החנות. אפשר לחבר מאוחר יותר מההגדרות.");
  };

  const handleLogout = async () => {
    clearStoreConnection();
    setConnection(null);
    setShopifyProducts([]);
    setShopifyCategories([]);
    setSelectedIds([]);
    setResults([]);
    setBatchHistory([]);
    setProfileName(null);
    await signOut();
    // The auth listener will switch stage to "login" automatically.
  };

  const handleDisconnectShopify = () => {
    const label = connection ? getConnectionPlatformLabel(connection) : "החנות";
    if (!confirm(`להתנתק מ-${label}? תצטרך לחבר מחדש כדי לסנכרן מוצרים.`)) {
      return;
    }
    clearStoreConnection();
    setConnection(null);
    setShopifyProducts([]);
    setShopifyCategories([]);
    setShopifyCatalogTotal(0);
    setShopifyError(null);
    if (session?.user?.id) {
      void clearRemoteStoreConnection(createClient(), session.user.id);
    }
    pushToast("החנות נותקה");
  };

  const handleNav = (id: NavId) => {
    setRoute(id);
    if (id !== "products") setSelectedIds([]);
  };

  /* ---------- Uploads ---------- */
  const handleAddUploads = (files: File[]) => {
    const newOnes: UploadedProduct[] = files.map((file) => {
      const id = uploadIdSeed++;
      const fileUrl = URL.createObjectURL(file);
      return {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        price: 0,
        category: "all",
        img: "",
        optimized: false,
        isUpload: true,
        fileUrl,
        file,
        createdAt: Date.now(),
      };
    });
    setUploads((prev) => [...newOnes, ...prev]);
    setSelectedIds((prev) => [...newOnes.map((n) => n.id), ...prev]);
    setRoute("products");
    pushToast(`${newOnes.length} תמונות נוספו · בחר סגנון ולחץ עצב`);
  };

  /* ---------- Catalog ---------- */
  const allAvailable: AnyProduct[] = useMemo(() => {
    const base: AnyProduct[] = connection ? shopifyProducts : [];
    return [...uploads, ...base];
  }, [uploads, connection, shopifyProducts]);

  const productsCountForSidebar = useMemo(
    () => (connection ? shopifyProducts.length : 0) + uploads.length,
    [connection, shopifyProducts.length, uploads.length]
  );

  const startBatch = (ids?: number[]) => {
    const useIds = ids && ids.length ? ids : selectedIds;
    if (!useIds.length) {
      const pool = connection ? shopifyProducts : uploads;
      const auto: number[] = pool
        .filter((p) => !p.optimized)
        .slice(0, 8)
        .map((p) => p.id);
      if (auto.length === 0) {
        pushToast("אין מוצרים לעיצוב — העלה תמונות או חבר חנות");
        setRoute("products");
        return;
      }
      setSelectedIds(auto);
      setRoute("products");
      pushToast(
        `נבחרו ${auto.length} מוצרים שטרם עוצבו — לחץ "עצב תמונות" להמשך`
      );
      return;
    }
    setSelectedIds(useIds.slice(0, MAX_BATCH_SELECT));
    setPendingBatchIds(useIds.slice(0, MAX_BATCH_SELECT));
    setShowPresetModal(true);
  };

  const confirmPreset = (options: ProcessingOptions) => {
    setActivePreset(options.presetId);
    setProcessingOptions(options);
    const items = allAvailable.filter((p) => pendingBatchIds.includes(p.id));
    if (items.length === 0) {
      pushToast("לא נבחרו מוצרים לעיבוד");
      setShowPresetModal(false);
      return;
    }
    setProcessingProducts(items);
    setShowPresetModal(false);
    setShowProcessing(true);
  };

  const finishProcessing = useCallback((res: ProcessedResult[]) => {
    setResults(res);
    setShowProcessing(false);
    setRoute("results");

    const successfulIds = new Set(
      res.filter((r) => r.isReal && !r.error && r.afterBase64).map((r) => r.productId)
    );
    if (successfulIds.size > 0) {
      setUploads((prev) =>
        prev.map((p) =>
          successfulIds.has(p.id) ? { ...p, optimized: true } : p
        )
      );
      setShopifyProducts((prev) =>
        prev.map((p) =>
          successfulIds.has(p.id) ? { ...p, optimized: true } : p
        )
      );
    }

    const successful = res.filter((r) => !r.error).length;
    const failed = res.filter((r) => r.error).length;
    const presetName =
      PRESETS.find((p) => p.id === activePreset)?.name ?? activePreset;
    const batchId = crypto.randomUUID();
    const optimisticBatch: HistoryBatch = {
      id: batchId,
      name: `עיצוב · ${presetName}`,
      preset: activePreset,
      count: res.length,
      successful,
      failed,
      createdAt: new Date(),
      status:
        failed === res.length
          ? "failed"
          : failed > 0
            ? "partial"
            : "completed",
      previewUrl: res.find((r) => r.afterUrl && !r.error)?.afterUrl,
      items: res.map((r) => ({
        id: `${batchId}-${r.productId}`,
        productName: r.name,
        beforeUrl: r.beforeUrl,
        afterUrl: r.error ? undefined : r.afterUrl,
        status: r.error ? "failed" : "success",
        error: r.error,
        shopifyProductId: r.isShopify ? r.productId : undefined,
        externalProductId: r.externalProductId,
        sourceType: r.isCustomApi
          ? "custom-api"
          : r.isShopify
            ? "shopify"
            : "upload",
      })),
    };

    setBatchHistory((prev) => [optimisticBatch, ...prev]);

    if (session?.user?.id) {
      void persistBatch(
        session.user.id,
        res,
        activePreset,
        processingQuality,
        batchId,
        connection?.platform === "shopify" ? connection.shop : undefined
      )
        .then((saved) => {
          if (!saved) return;
          setBatchHistory((prev) =>
            prev.map((b) => (b.id === batchId ? saved : b))
          );
        })
        .catch((err) => {
          console.error("[pixa] failed to persist batch history", err);
        });
    }
  }, [
    activePreset,
    session?.user?.id,
    connection?.platform === "shopify" ? connection.shop : undefined,
    processingQuality,
  ]);

  /* ---------- Publish back to connected store ---------- */
  const publishResults = async (approvedIds: number[]) => {
    const toPublish = results.filter(
      (r) => approvedIds.includes(r.productId) && r.isReal && !r.error
    );
    if (toPublish.length === 0) {
      pushToast("אין תוצאות לפרסום");
      return;
    }

    if (!connection) {
      for (const r of toPublish) {
        const a = document.createElement("a");
        a.href = r.afterUrl;
        a.download = `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((res) => setTimeout(res, 120));
      }
      pushToast(`${toPublish.length} תמונות הורדו`);
      setRoute("history");
      return;
    }

    let ok = 0;
    let failed = 0;
    const publishedImageUrls = new Map<number, string>();
    const platformLabel = getConnectionPlatformLabel(connection);

    for (const r of toPublish) {
      const publishable = (r.isShopify || r.isCustomApi) && r.afterBase64;
      if (!publishable) {
        const a = document.createElement("a");
        a.href = r.afterUrl;
        a.download = `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        continue;
      }

      try {
        if (connection.platform === "shopify" && r.isShopify) {
          const uploadRes = await uploadProductImage(connection, {
            productId: r.productId,
            base64: r.afterBase64!,
            filename: `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}.png`,
            alt: r.name,
            replaceOriginal: true,
          });
        if (uploadRes.image?.src) {
          publishedImageUrls.set(r.productId, uploadRes.image.src);
        }
        markItemPublished("", r.afterUrl);
      } else if (
          connection.platform === "custom-api" &&
          r.isCustomApi &&
          r.externalProductId
        ) {
          const uploadRes = await uploadCustomApiProductImage(connection, {
            productId: r.externalProductId,
            base64: r.afterBase64!,
            filename: `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}.png`,
            alt: r.name,
          });
        if (uploadRes.newImageUrl) {
          publishedImageUrls.set(r.productId, uploadRes.newImageUrl);
        }
        markItemPublished("", r.afterUrl);
      }
        ok += 1;
      } catch (e) {
        console.error("publish failed", e);
        failed += 1;
      }
    }

    if (publishedImageUrls.size > 0) {
      setShopifyProducts((prev) =>
        prev.map((p) => {
          const src = publishedImageUrls.get(p.id);
          if (!src) return p;
          return { ...p, optimized: true, imageUrl: src };
        })
      );
    }

    if (ok > 0 && failed === 0) {
      pushToast(`${ok} תמונות פורסמו ל-${platformLabel} בהצלחה!`);
    } else if (ok > 0 && failed > 0) {
      pushToast(`${ok} פורסמו · ${failed} נכשלו`);
    } else {
      pushToast(`כל הפרסומים נכשלו (${failed})`);
    }

    setSelectedIds([]);
    setUploads((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u.fileUrl));
      return [];
    });
    if (connection) loadShopifyCatalog(connection);
    setRoute("history");
  };

  /* ---------- Render ---------- */

  const bootstrappingApp =
    !!session?.user?.id &&
    (hasBrandAvatar === null || !connectionLoaded);

  if (!authChecked || bootstrappingApp) {
    return (
      <Frame>
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "var(--bg)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "2px solid var(--hair-2)",
              borderTopColor: "var(--cream)",
              animation: "spin .8s linear infinite",
            }}
          />
        </div>
      </Frame>
    );
  }

  if (routeStage === "login")
    return (
      <Frame>
        <LoginScreen onLogin={handleLogin} onRegister={goToRegister} />
      </Frame>
    );
  if (routeStage === "register")
    return (
      <Frame>
        <RegisterScreen
          onComplete={handleRegisterComplete}
          onLogin={goToLogin}
          onCancel={handleRegisterCancel}
        />
      </Frame>
    );
  if (routeStage === "onboarding")
    return (
      <Frame>
        <RegisterScreen
          mode="brand-only"
          initialBusinessName={profileName ?? ""}
          onComplete={handleOnboardingComplete}
          onLogin={goToLogin}
          onCancel={handleRegisterCancel}
        />
      </Frame>
    );
  if (routeStage === "connect")
    return (
      <Frame>
        <ConnectScreen
          onConnected={handleConnected}
          onSkip={handleSkipConnect}
        />
      </Frame>
    );

  const currentNav: NavId =
    route === "results" ? "products" : (route as NavId);

  return (
    <Frame>
      <Layout
        current={currentNav}
        onNav={handleNav}
        onLogout={handleLogout}
        storeName={
          (connection && getConnectionLabel(connection)) ||
          profileName ||
          userEmail ||
          undefined
        }
        productsCount={productsCountForSidebar}
        productsLoading={!!connection && loadingShopify}
        historyCount={batchHistory.length || undefined}
      >
        {route === "dashboard" && (
          <DashboardScreen
            firstName={profileName ?? userEmail ?? null}
            catalogCount={
              uploads.length +
              (connection
                ? Math.max(shopifyCatalogTotal, shopifyProducts.length)
                : 0)
            }
            loadingCatalog={!!connection && loadingShopify}
            recentResults={results}
            batchHistory={batchHistory}
            shopifyProducts={shopifyProducts}
            connected={!!connection}
            storePlatform={
              connection ? getConnectionPlatformLabel(connection) : undefined
            }
            onStartBatch={() => startBatch()}
            onConnect={() => setStage("connect")}
            onGoToProducts={() => setRoute("products")}
          />
        )}
        {route === "products" && (
          <ProductsScreen
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onStartBatch={startBatch}
            uploads={uploads}
            onAddUploads={handleAddUploads}
            shopifyProducts={shopifyProducts}
            shopifyCategories={shopifyCategories}
            shopifyCatalogTotal={shopifyCatalogTotal}
            loadingShopify={loadingShopify}
            shopifyError={shopifyError}
            onReloadShopify={
              connection ? () => loadShopifyCatalog(connection) : undefined
            }
            onFilterCollection={
              connection
                ? (collectionId) => loadShopifyCatalog(connection, collectionId)
                : undefined
            }
            connected={!!connection}
            onConnect={() => setStage("connect")}
            hideBulkBar={showPresetModal || showProcessing}
          />
        )}
        {route === "history" && (
          <HistoryScreen
            batches={batchHistory}
            connection={connection}
            storeProducts={shopifyProducts}
            onToast={pushToast}
            onPublishComplete={(publishedProductIds) => {
              if (publishedProductIds.size > 0) {
                setShopifyProducts((prev) =>
                  prev.map((p) => {
                    const src = publishedProductIds.get(p.id);
                    if (!src) return p;
                    return { ...p, optimized: true, imageUrl: src };
                  })
                );
              }
              if (connection) loadShopifyCatalog(connection);
            }}
          />
        )}
        {route === "settings" && (
          <SettingsScreen
            onLogout={handleLogout}
            userEmail={userEmail}
            connection={connection}
            onConnect={() => setStage("connect")}
            onDisconnect={handleDisconnectShopify}
          />
        )}
        {route === "results" && (
          <ResultsScreen
            results={results}
            presetId={activePreset}
            connection={connection}
            onPublish={publishResults}
            onBack={() => setRoute("products")}
          />
        )}
      </Layout>

      {showPresetModal && (
        <PresetPickerModal
          count={selectedIds.length}
          onClose={() => setShowPresetModal(false)}
          onConfirm={confirmPreset}
        />
      )}

      {showProcessing && (
        <ProcessingOverlay
          key={processingProducts.map((p) => p.id).join("-")}
          products={processingProducts}
          presetId={activePreset}
          processingOptions={processingOptions}
          quality={processingQuality}
          onDone={finishProcessing}
        />
      )}

      {toast && <Toast message={toast} />}
    </Frame>
  );
}

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="shell">{children}</div>
);

const Toast: React.FC<{ message: string }> = ({ message }) => (
  <div
    style={{
      position: "fixed",
      bottom: 100,
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(10,7,14,.95)",
      backdropFilter: "blur(20px)",
      border: "1px solid var(--hair-2)",
      padding: "12px 18px",
      borderRadius: 12,
      zIndex: 200,
      fontSize: 14,
      fontWeight: 500,
      boxShadow: "0 24px 60px -16px rgba(0,0,0,.6)",
      animation: "slideUp .35s var(--ease-out) both",
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}
  >
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "var(--grad)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Icons.Check size={13} strokeWidth={3} />
    </span>
    {message}
  </div>
);
