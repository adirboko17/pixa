"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "./icons";
import {
  PRESETS,
  CATALOG_PRO_PRESET_ID,
  CATALOG_STYLE_PRESET_IDS,
  EMPTY_INTERIOR_PRESET_ID,
  PRODUCT_RECOLOR_PRESET_ID,
  buildImgUrl,
  fmtDate,
  fmtMonthYear,
  fmtRelativeTime,
  type Product,
  type CustomBackedProduct,
  type ShopifyBackedProduct,
  type StoreBackedProduct,
  DRAFTS_CATEGORY_ID,
  type Category,
  type Preset,
  type HistoryBatch,
  type HistoryBatchItem,
  type ProcessingOptions,
  type RecolorScope,
  type ProductFixOptions,
  appendProductFixToForm,
  pickProductFix,
} from "./data";
import {
  ProductFixModal,
  ProductFixSection,
  runProductFix,
  type ProductFixTarget,
} from "./ProductFix";
import type { StoreConnection } from "@/lib/store-connection";
import {
  getConnectionLabel,
  getConnectionPlatformLabel,
} from "@/lib/store-connection";
import { uploadFlattenedDrawing } from "@/lib/upload-blueprint-drawing";
import { stableProductId } from "@/lib/custom-api-client";
import { getBatchItemMeta } from "@/lib/batch-item-meta";
import { type Quality, type ImageSize } from "@/lib/pricing";
import { Spinner } from "./screens-shell";
import { useOpenAIBalance } from "./use-openai-balance";
import { StarLoader } from "./StarLoader";
import { BulkBar } from "./BulkBar";
import {
  BlueprintEditorModal,
  BlueprintPreview,
  flattenBlueprint,
} from "./BlueprintEditor";
import type { BlueprintLayout } from "@/lib/blueprint-annotations";
import { isItemPublished } from "@/lib/publish-tracker";
import {
  enrichHistoryItem,
  publishHistoryItems,
} from "@/lib/publish-to-store";
import ImageViewer, { type ViewerImage } from "@/components/ImageViewer";
import SiteCatalogScan, {
  type ScannedImport,
} from "./SiteCatalogScan";
import {
  isLegacyBatchProductName,
  lookupAfterProductMap,
} from "@/lib/product-name-resolver";

const II = Icons;

export const MAX_BATCH_SELECT = 100;

function formatCatalogPrice(p: { price: number; currency?: string }) {
  if (!p.price) return "—";
  const n = p.price.toLocaleString("he-IL", { maximumFractionDigits: 2 });
  const cur = (p.currency || "ILS").toUpperCase();
  if (cur === "ILS" || cur === "NIS") return `₪${n}`;
  if (cur === "USD") return `$${n}`;
  if (cur === "EUR") return `€${n}`;
  if (cur === "GBP") return `£${n}`;
  return `${n} ${cur}`;
}

/* ============================================================
   SHARED: Sparkline (tiny inline chart)
   ============================================================ */

const Sparkline: React.FC<{ data?: number[]; color?: string }> = ({
  data = [12, 18, 14, 24, 22, 30, 28, 38, 35, 44],
  color = "var(--cream)",
}) => {
  const w = 92,
    h = 28;
  const max = Math.max(...data),
    min = Math.min(...data);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={w}
        cy={(h - ((data[data.length - 1] - min) / (max - min || 1)) * h).toFixed(
          1
        )}
        r="2.2"
        fill={color}
      />
    </svg>
  );
};

/* ============================================================
   DASHBOARD — editorial magazine layout
   ============================================================ */

function expandBatchItems(batch: HistoryBatch): HistoryBatchItem[] {
  const items = batch.items ?? [];
  const withUrls = items.filter((i) => i.afterUrl || i.beforeUrl);
  if (withUrls.length > 0) return withUrls;
  if (items.length > 0) return items;

  const count = Math.max(batch.successful, batch.count, 0);
  if (count <= 0 && !batch.previewUrl) return [];

  return Array.from({ length: Math.max(count, 1) }, (_, idx) => ({
    id: `${batch.id}-${idx}`,
    productName: batch.name,
    afterUrl: idx === 0 ? batch.previewUrl : undefined,
    beforeUrl: idx === 0 ? batch.previewUrl : undefined,
    status: "success" as const,
  }));
}

function formatDesignStyleLabel(presetId?: string): string {
  const preset = presetId ? PRESETS.find((p) => p.id === presetId) : undefined;
  return preset ? `עיצוב ${preset.name}` : "עיצוב";
}

function isLegacyBatchTitle(name: string): boolean {
  return isLegacyBatchProductName(name);
}

function resolveRecentItemTitle(
  item: {
    name: string;
    beforeUrl?: string;
    afterUrl?: string;
    presetId?: string;
    isShopify?: boolean;
    productId: number;
    shopifyProductId?: number;
  },
  shopifyProducts: StoreBackedProduct[]
): string {
  const shopifyId =
    item.shopifyProductId ?? (item.isShopify ? item.productId : undefined);
  if (shopifyId && shopifyProducts.length > 0) {
    const match = shopifyProducts.find((p) => p.id === shopifyId);
    if (match) return match.name;
  }
  if (item.beforeUrl && shopifyProducts.length > 0) {
    const normalized = item.beforeUrl.split("?")[0];
    const match = shopifyProducts.find(
      (p) => p.imageUrl.split("?")[0] === normalized
    );
    if (match) return match.name;
  }
  const mapped = lookupAfterProductMap(item.afterUrl);
  if (mapped?.name) return mapped.name;
  if (isLegacyBatchTitle(item.name)) {
    return shopifyProducts.length > 0 ? "טוען…" : item.name;
  }
  return item.name;
}

function historyToProcessedResults(
  batches: HistoryBatch[],
  limit = 5
): Array<{
  productId: number;
  beforeUrl: string;
  afterUrl: string;
  name: string;
  isReal: boolean;
  isShopify: boolean;
  isCustomApi: boolean;
  presetId?: string;
  shopifyProductId?: number;
  error?: string;
}> {
  const results: Array<{
    productId: number;
    beforeUrl: string;
    afterUrl: string;
    name: string;
    isReal: boolean;
    isShopify: boolean;
    isCustomApi: boolean;
    presetId?: string;
    shopifyProductId?: number;
    error?: string;
  }> = [];
  for (const batch of batches) {
    for (const item of expandBatchItems(batch)) {
      const imageUrl = item.afterUrl ?? item.beforeUrl;
      results.push({
        productId: item.shopifyProductId ?? results.length,
        beforeUrl: item.beforeUrl ?? imageUrl ?? "",
        afterUrl: item.afterUrl ?? imageUrl ?? "",
        name: item.productName,
        isReal: true,
        isShopify: !!item.shopifyProductId,
        isCustomApi: false,
        presetId: batch.preset,
        shopifyProductId: item.shopifyProductId,
        error: item.status === "failed" ? item.error : undefined,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function ResultThumb({
  afterUrl,
  presetId,
  alt,
}: {
  afterUrl?: string;
  presetId?: string;
  alt: string;
}) {
  const preset = presetId ? PRESETS.find((p) => p.id === presetId) : null;
  if (afterUrl) {
    return (
      <img
        src={afterUrl}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }
  if (preset?.gradient) {
    return (
      <div
        aria-hidden
        style={{ width: "100%", height: "100%", background: preset.gradient }}
      />
    );
  }
  return null;
}

export const DashboardScreen: React.FC<{
  onStartBatch: () => void;
  /** First-name-style label for the hero greeting. */
  firstName?: string | null;
  /** Total products in the catalog (uploads + Shopify). */
  catalogCount: number;
  /** True while the Shopify catalog is loading on first paint. */
  loadingCatalog?: boolean;
  /** Most recent processed results (newest first). */
  recentResults: ProcessedResult[];
  /** Persisted batches from Supabase — used for totals when session results are empty. */
  batchHistory?: HistoryBatch[];
  /** Shopify catalog — used to resolve product names in recent list. */
  shopifyProducts?: StoreBackedProduct[];
  /** Whether the user is connected to a store. */
  connected: boolean;
  /** Platform label for the connected store. */
  storePlatform?: string;
  /** Optional CTA: take the user to the connect screen. */
  onConnect?: () => void;
  /** Optional CTA: take the user to the products tab to upload. */
  onGoToProducts?: () => void;
}> = ({
  onStartBatch,
  firstName,
  catalogCount,
  loadingCatalog = false,
  recentResults,
  batchHistory = [],
  shopifyProducts = [],
  connected,
  storePlatform,
  onConnect,
  onGoToProducts,
}) => {
  const greetingName = (firstName?.trim() || "").split(/\s+/)[0] || "";
  const completedCount = useMemo(
    () => batchHistory.reduce((sum, b) => sum + b.successful, 0),
    [batchHistory]
  );
  const pendingCount = Math.max(0, catalogCount - completedCount);
  const displayRecentResults = useMemo(() => {
    const base =
      recentResults.length > 0
        ? recentResults
        : historyToProcessedResults(batchHistory, 5);
    return base.map((r) => ({
      ...r,
      name: resolveRecentItemTitle(r, shopifyProducts),
    }));
  }, [recentResults, batchHistory, shopifyProducts]);
  const isEmpty =
    !loadingCatalog && catalogCount === 0 && completedCount === 0;

  return (
    <>
      <section
        style={{
          position: "relative",
          paddingBottom: 80,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 80,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -80,
            insetInlineEnd: -100,
            width: 480,
            height: 480,
            borderRadius: "50%",
            background:
              "radial-gradient(closest-side, rgba(255,138,71,.4), rgba(176,64,224,.25) 50%, transparent)",
            filter: "blur(50px)",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />

        <div className="eyebrow" style={{ marginBottom: 28 }}>
          01 · דשבורד · {fmtDate()}
        </div>

        <h1 className="h-hero" style={{ maxWidth: 980 }}>
          {greetingPart(new Date())}
          <span style={{ color: "var(--cream)" }}>,</span>
          {greetingName ? (
            <>
              <br />
              <span style={{ fontStyle: "italic", fontWeight: 500 }}>
                {greetingName}
              </span>
              <span className="grad-text" style={{ fontStyle: "italic" }}>
                .
              </span>
            </>
          ) : (
            <span className="grad-text" style={{ fontStyle: "italic" }}>
              .
            </span>
          )}
        </h1>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginTop: 40,
            gap: 40,
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              fontSize: 18,
              color: "var(--ink-2)",
              lineHeight: 1.5,
              maxWidth: 540,
              margin: 0,
            }}
          >
            {loadingCatalog ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Spinner size={18} />
                טוען את הקטלוג מ-Shopify…
              </span>
            ) : isEmpty ? (
              connected ? (
                <>
                  החנות מחוברת אבל עדיין אין כאן מוצרים. רענן את הקטלוג או התחל
                  ידנית עם תמונה מהמחשב.
                </>
              ) : (
                <>
                  עוד אין מוצרים בקטלוג. אפשר{" "}
                  <a
                    onClick={onConnect}
                    style={{
                      color: "var(--cream)",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    לחבר חנות Shopify
                  </a>{" "}
                  או{" "}
                  <a
                    onClick={onGoToProducts}
                    style={{
                      color: "var(--cream)",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    להעלות תמונות
                  </a>{" "}
                  מהמחשב כדי להתחיל.
                </>
              )
            ) : pendingCount > 0 ? (
              <>
                יש לך{" "}
                <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {pendingCount} {pendingCount === 1 ? "מוצר" : "מוצרים"}
                </strong>{" "}
                שמחכים לעיצוב
                {completedCount > 0 ? (
                  <>
                    , וכבר{" "}
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                      {completedCount} {completedCount === 1 ? "תמונה" : "תמונות"}
                    </strong>{" "}
                    עברו עיבוד
                  </>
                ) : null}
                . בואו נסדר.
              </>
            ) : (
              <>
                כל{" "}
                <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {catalogCount}{" "}
                  {catalogCount === 1 ? "המוצר" : "המוצרים"}
                </strong>{" "}
                שלך עברו עיבוד. הוסף תמונות חדשות כדי להמשיך.
              </>
            )}
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {!connected && onConnect && (
              <button className="btn btn-line" onClick={onConnect}>
                <II.Shopify size={14} /> חבר חנות
              </button>
            )}
            <button
              className="btn btn-primary lg"
              onClick={catalogCount === 0 ? onGoToProducts : onStartBatch}
            >
              <StarLoader size={34} scale={3.2} />
              {catalogCount === 0 ? "העלה תמונות" : "פתח עיצוב חדש"}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="eyebrow" style={{ marginBottom: 20 }}>
          02 · ביצועים
        </div>
        <div className="stat-strip stagger">
          <StatCell
            label="תמונות שעוצבו"
            num={completedCount === 0 ? "—" : pad2(completedCount)}
            trend={
              completedCount === 0
                ? "עוד לא רץ עיצוב"
                : `${completedCount} סה"כ`
            }
            highlight
          />
          <StatCell
            label="קטלוג"
            loading={loadingCatalog}
            num={catalogCount === 0 ? "—" : String(catalogCount)}
            trend={
              loadingCatalog
                ? "טוען…"
                : catalogCount === 0
                  ? "ריק"
                  : connected
                    ? "Shopify מסונכרן"
                    : "מקומי"
            }
          />
          <StatCell
            label="ממתינים לעיצוב"
            loading={loadingCatalog}
            num={pendingCount === 0 ? "—" : String(pendingCount)}
            trend={
              loadingCatalog
                ? "טוען…"
                : pendingCount === 0
                  ? "אין"
                  : "מוכנים לעיצוב"
            }
          />
          <StatCell
            label="חיבור חנות"
            num={connected ? "פעיל" : "—"}
            trend={connected ? storePlatform || "מחובר" : "לא מחובר"}
          />
        </div>
      </section>

      <section className="section col-2">
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 52,
              gap: 24,
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 14 }}>
                03 · עיצובים
              </div>
              <h2
                className="h-1"
                style={{ margin: 0, lineHeight: 1.2, paddingBottom: 10 }}
              >
                <span style={{ fontStyle: "italic", fontWeight: 500 }}>
                  אחרונות
                </span>{" "}
                במערכת
              </h2>
            </div>
            {displayRecentResults.length > 0 && (
              <a
                onClick={onGoToProducts}
                className="btn-line"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  paddingBottom: 6,
                  borderBottom: "1px solid var(--hair-2)",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                הצג הכל <II.ArrowLeft size={13} />
              </a>
            )}
          </div>

          {displayRecentResults.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--hair-2)",
                borderRadius: 14,
                padding: "44px 28px",
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
                lineHeight: 1.6,
                marginTop: 16,
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  marginBottom: 14,
                  opacity: 0.6,
                  filter: "grayscale(.4)",
                }}
              >
                ✦
              </div>
              <div style={{ marginBottom: 6, color: "var(--ink-2)" }}>
                עוד לא רצו עיצובים.
              </div>
              <div style={{ marginBottom: 18 }}>
                {connected
                  ? "בחר מוצרים מהחנות שלך, סגנון, ולחץ \"עצב\" — העיצוב הראשון יופיע כאן."
                  : "העלה תמונות מהמחשב, בחר סגנון ולחץ \"עצב\" — העיצוב הראשון יופיע כאן."}
              </div>
              <button
                className="btn btn-primary"
                onClick={catalogCount === 0 ? onGoToProducts : onStartBatch}
              >
                <II.Sparkles size={14} />{" "}
                {catalogCount === 0 ? "העלה תמונות" : "פתח עיצוב ראשון"}
              </button>
            </div>
          ) : (
            <div>
              {displayRecentResults.slice(0, 5).map((r, i) => (
                <div
                  key={`${r.productId}-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 56px 1fr auto auto",
                    gap: 20,
                    alignItems: "center",
                    padding: "20px 0",
                    borderTop: i === 0 ? "1px solid var(--hair)" : "0",
                    borderBottom: "1px solid var(--hair)",
                    transition: "all .15s",
                  }}
                >
                  <span
                    className="serif mono"
                    style={{
                      fontSize: 22,
                      color: "var(--ink-3)",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      overflow: "hidden",
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)",
                      background: "var(--bg-card)",
                    }}
                  >
                    {r.afterUrl || r.presetId ? (
                      <ResultThumb
                        afterUrl={r.afterUrl || undefined}
                        presetId={r.presetId}
                        alt={r.name}
                      />
                    ) : null}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 500,
                        marginBottom: 4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <span>{formatDesignStyleLabel(r.presetId)}</span>
                      {r.error && (
                        <>
                          <span className="aster">·</span>
                          <span style={{ color: "#ff6b8b" }}>שגיאה</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {r.isReal ? "AI" : "DEMO"}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: r.error ? "#ff6b8b" : "var(--ok)",
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: r.error ? "#ff6b8b" : "var(--ok)",
                      }}
                    />
                    {r.error ? "כשל" : "הושלם"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div
            style={{
              padding: "28px 26px",
              border: "1px solid var(--hair)",
              borderRadius: 16,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                insetInlineEnd: -40,
                top: -40,
                width: 160,
                height: 160,
                borderRadius: "50%",
                background: "var(--grad)",
                opacity: 0.12,
                filter: "blur(20px)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "relative",
                zIndex: 1,
              }}
            >
              <div className="eyebrow" style={{ marginBottom: 18 }}>
                04 · טיפ מהבית
              </div>

              <div
                style={{
                  fontFamily: '"Anek Hebrew", "Heebo", sans-serif',
                  fontWeight: 700,
                  fontSize: 22,
                  lineHeight: 1.55,
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                }}
              >
                סגנון{" "}
                <span
                  className="grad-text"
                  style={{ fontStyle: "italic", lineHeight: 1.55 }}
                >
                  &quot;לייפסטייל&quot;
                </span>{" "}
                עובד הכי טוב.
              </div>

              <p
                className="text-2"
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  margin: 0,
                  marginTop: 16,
                  paddingTop: 0,
                }}
              >
                לבגדים, אקססוריז ובית — סגנון לייפסטייל מציג את התשואה הגבוהה
                ביותר במודעות. למוצרי אלקטרוניקה ותכשיטים — סטודיו לבן.
              </p>

              <button
                type="button"
                onClick={catalogCount === 0 ? onGoToProducts : onStartBatch}
                style={{
                  marginTop: 22,
                  background: "none",
                  border: 0,
                  borderBottom: "1px solid var(--cream)",
                  padding: "0 0 4px",
                  fontSize: 12,
                  color: "var(--cream)",
                  cursor: "pointer",
                  display: "inline-flex",
                  gap: 8,
                  alignItems: "center",
                  fontFamily: "inherit",
                }}
              >
                {catalogCount === 0 ? "התחל לעצב" : "פתח עיצוב"}{" "}
                <II.ArrowLeft size={12} />
              </button>
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              05 · עיצובים אחרונים
            </div>
            {displayRecentResults.length === 0 ? (
              <div
                style={{
                  border: "1px dashed var(--hair-2)",
                  borderRadius: 12,
                  padding: "26px 18px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                העיצובים הראשונים שלך יופיעו כאן.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 10,
                  }}
                >
                  {displayRecentResults.slice(0, 3).map((r, i) => (
                    <div
                      key={`${r.productId}-thumb-${i}`}
                      style={{
                        aspectRatio: "4/5",
                        borderRadius: 8,
                        overflow: "hidden",
                        border: "1px solid var(--hair)",
                        background: "var(--bg-card)",
                      }}
                    >
                      {r.afterUrl || r.presetId ? (
                        <ResultThumb
                          afterUrl={r.afterUrl || undefined}
                          presetId={r.presetId}
                          alt={r.name}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: "1px solid var(--hair)",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  <span>
                    סה&quot;כ{" "}
                    <span
                      className="serif mono"
                      style={{
                        color: "var(--ink)",
                        fontSize: 18,
                        marginInlineStart: 8,
                      }}
                    >
                      {completedCount}
                    </span>
                  </span>
                  <span>
                    הצלחה{" "}
                    <span
                      className="serif mono"
                      style={{
                        color: "var(--ink)",
                        fontSize: 18,
                        marginInlineStart: 8,
                      }}
                    >
                      {Math.round(
                        ((completedCount -
                          batchHistory.reduce((sum, b) => sum + b.failed, 0)) /
                          Math.max(1, completedCount)) *
                          100
                      )}
                      <small style={{ fontSize: 10 }}>%</small>
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        </aside>
      </section>
    </>
  );
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const greetingPart = (d: Date) => {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 17) return "צהריים טובים";
  if (h >= 17 && h < 21) return "ערב טוב";
  return "לילה טוב";
};

const StatCell: React.FC<{
  label: string;
  num: string;
  suffix?: string;
  trend?: string;
  spark?: number[];
  highlight?: boolean;
  loading?: boolean;
}> = ({ label, num, suffix, trend, spark, highlight, loading }) => (
  <div className="stat-cell">
    <div className="stat-label">{label}</div>
    <div className="stat-num">
      {loading ? (
        <Spinner size={28} />
      ) : (
        <>
          {num}
          {suffix && (
            <span
              style={{
                fontSize: "0.5em",
                color: "var(--ink-3)",
                fontWeight: 500,
              }}
            >
              {suffix}
            </span>
          )}
        </>
      )}
    </div>
    {spark && (
      <div style={{ marginTop: 4 }}>
        <Sparkline
          data={spark}
          color={highlight ? "var(--cream)" : "var(--ink-4)"}
        />
      </div>
    )}
    {trend && (
      <div className="stat-trend">
        <II.ArrowUp size={11} /> {trend}
      </div>
    )}
  </div>
);

/* ============================================================
   PRODUCTS — real Shopify catalog + uploads
   ============================================================ */

const NEW_PRODUCTS_DAYS = 30;
const NEW_PRODUCTS_MS = NEW_PRODUCTS_DAYS * 24 * 60 * 60 * 1000;

function productCreatedAt(p: AnyProduct): number {
  return p.createdAt ?? 0;
}

function isNewProduct(p: AnyProduct): boolean {
  const ts = productCreatedAt(p);
  if (!ts) return false;
  return Date.now() - ts <= NEW_PRODUCTS_MS;
}

export type UploadedProduct = Product & {
  isUpload: true;
  fileUrl: string;
  file: File;
  gallery?: Array<{ src: string; primary: boolean; position: number }>;
  activeSrc?: string;
};

export type AnyProduct =
  | Product
  | UploadedProduct
  | ShopifyBackedProduct
  | CustomBackedProduct;

export const isUploadedProduct = (p: AnyProduct): p is UploadedProduct =>
  "isUpload" in p && (p as UploadedProduct).isUpload === true;

export const isShopifyProduct = (p: AnyProduct): p is ShopifyBackedProduct =>
  "isShopify" in p && (p as ShopifyBackedProduct).isShopify === true;

export const isCustomApiProduct = (p: AnyProduct): p is CustomBackedProduct =>
  "isCustomApi" in p && (p as CustomBackedProduct).isCustomApi === true;

export const isStoreBackedProduct = (
  p: AnyProduct
): p is StoreBackedProduct => isShopifyProduct(p) || isCustomApiProduct(p);

export const ProductsScreen: React.FC<{
  selectedIds: number[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  onStartBatch: (ids: number[]) => void;
  uploads: UploadedProduct[];
  onAddUploads: (files: File[]) => void;
  onImportScanned: (items: ScannedImport[]) => void;
  onPickGalleryImage?: (productId: number, src: string) => void;
  onPushToCms?: (ids: number[]) => void;
  pushingToCms?: boolean;
  /** Real store products. Empty when not connected or still loading. */
  shopifyProducts: StoreBackedProduct[];
  /** Unpublished store drafts. Designed here before they go live. */
  draftProducts?: StoreBackedProduct[];
  /** Real Shopify collections (used as category chips). */
  shopifyCategories: Category[];
  /** Total products in the full catalog (not the active collection filter). */
  shopifyCatalogTotal?: number;
  /** True while we are loading from Shopify. */
  loadingShopify?: boolean;
  shopifyError?: string | null;
  onReloadShopify?: () => void;
  /** Reload catalog filtered by a Shopify collection id. */
  onFilterCollection?: (collectionId?: string) => void;
  /** Whether the user is connected to a store at all. */
  connected: boolean;
  connection?: StoreConnection | null;
  /** Take the user to the connect screen. */
  onConnect?: () => void;
  /** Hide the floating selection bar (e.g. while preset/processing modal is open). */
  hideBulkBar?: boolean;
}> = ({
  selectedIds,
  setSelectedIds,
  onStartBatch,
  uploads,
  onAddUploads,
  onImportScanned,
  onPickGalleryImage,
  onPushToCms,
  pushingToCms = false,
  shopifyProducts,
  draftProducts = [],
  shopifyCategories,
  shopifyCatalogTotal = 0,
  loadingShopify,
  shopifyError,
  onReloadShopify,
  onFilterCollection,
  connected,
  connection = null,
  onConnect,
  hideBulkBar = false,
}) => {
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<
    "all" | "pending" | "optimized" | "new"
  >("all");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const handleCategory = (catId: string) => {
    setCategory(catId);
    if (catId === DRAFTS_CATEGORY_ID) return;
    if (connected && onFilterCollection) {
      onFilterCollection(catId === "all" ? undefined : catId);
    }
  };

  const showingDrafts = category === DRAFTS_CATEGORY_ID;

  // Catalog source: real Shopify products when connected, otherwise uploads only.
  const catalogProducts: AnyProduct[] = useMemo(() => {
    if (!connected) return [];
    if (showingDrafts) return draftProducts;
    return shopifyProducts;
  }, [connected, showingDrafts, shopifyProducts, draftProducts]);

  const allProducts: AnyProduct[] = useMemo(
    () => (showingDrafts ? catalogProducts : [...uploads, ...catalogProducts]),
    [uploads, catalogProducts, showingDrafts]
  );

  // Categories: real Shopify collections when connected, plus unpublished drafts.
  const categories: Category[] = useMemo(() => {
    const allCat: Category = {
      id: "all",
      name: "כל המוצרים",
      count: connected ? shopifyCatalogTotal : uploads.length,
    };
    const draftCat: Category = {
      id: DRAFTS_CATEGORY_ID,
      name: "טיוטות",
      count: draftProducts.length,
    };
    if (connected && shopifyCategories.length > 0) {
      return [allCat, draftCat, ...shopifyCategories];
    }
    if (connected) return [allCat, draftCat];
    if (uploads.length > 0) {
      return [{ ...allCat, count: uploads.length }];
    }
    return [allCat];
  }, [
    connected,
    shopifyCatalogTotal,
    shopifyCategories,
    uploads.length,
    draftProducts.length,
  ]);

  const filtered = useMemo(() => {
    const list = allProducts.filter((p) => {
      const inCategory =
        category === "all" ? true : connected && isStoreBackedProduct(p);
      const inView =
        view === "all" ||
        (view === "new"
          ? isNewProduct(p)
          : view === "optimized"
            ? p.optimized
            : !p.optimized);
      const inSearch = !search || p.name.includes(search);
      return inCategory && inView && inSearch;
    });

    if (view === "new") {
      return [...list].sort(
        (a, b) => productCreatedAt(b) - productCreatedAt(a)
      );
    }
    return list;
  }, [category, view, search, allProducts, connected]);

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_BATCH_SELECT) return prev;
      return [...prev, id];
    });
  const clearAll = () => setSelectedIds([]);
  const canDesignProduct = (p: AnyProduct) => {
    if (isUploadedProduct(p)) return true;
    if (isStoreBackedProduct(p)) return !!p.imageUrl;
    return true;
  };

  const selectAllVisible = () =>
    setSelectedIds((prev) => {
      const merged = Array.from(
        new Set([
          ...prev,
          ...filtered.filter(canDesignProduct).map((p) => p.id),
        ])
      );
      return merged.slice(0, MAX_BATCH_SELECT);
    });

  const handleFiles = (filesList: FileList | null) => {
    if (!filesList) return;
    const arr = Array.from(filesList).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    onAddUploads(arr);
  };

  const selectionPct = Math.min(
    100,
    (selectedIds.length / MAX_BATCH_SELECT) * 100
  );
  const atSelectionLimit = selectedIds.length >= MAX_BATCH_SELECT;

  return (
    <>
      <section
        style={{
          paddingBottom: 36,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 48,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              02 · קטלוג המוצרים
            </div>
            <h1 className="h-display">
              המוצרים
              <br />
              <span style={{ fontStyle: "italic", fontWeight: 500 }}>שלך</span>
              <span className="grad-text">.</span>
            </h1>
            <p className="text-2" style={{ marginTop: 16, fontSize: 14 }}>
              <span
                className="serif mono"
                style={{
                  fontSize: 18,
                  color: "var(--ink)",
                  marginInlineEnd: 6,
                }}
              >
                {allProducts.length}
              </span>{" "}
              מוצרים בקטלוג <span className="aster">·</span>{" "}
              <span
                className="serif mono"
                style={{
                  fontSize: 18,
                  color: "var(--ink)",
                  margin: "0 6px",
                }}
              >
                {allProducts.filter((p) => !p.optimized).length}
              </span>{" "}
              טרם עוצבו
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              className="btn btn-ghost"
              onClick={() => setScanOpen(true)}
            >
              <II.Globe size={15} /> סרוק אתר
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <II.Upload size={15} /> העלה תמונות
            </button>
            <button className="btn btn-ghost" onClick={selectAllVisible}>
              בחר הכל
            </button>
          </div>
        </div>
      </section>

      {connected && shopifyError && (
        <div
          style={{
            background: "rgba(255,61,139,.08)",
            border: "1px solid rgba(255,61,139,.4)",
            color: "#ff8eb3",
            borderRadius: 12,
            padding: "14px 18px",
            fontSize: 13,
            marginBottom: 24,
            lineHeight: 1.5,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span>
            שגיאה בטעינה מ-
            {connection ? getConnectionLabel(connection) : "החנות"}{" "}
            · {shopifyError}
          </span>
          {onReloadShopify && (
            <button className="btn btn-ghost" onClick={onReloadShopify}>
              נסה שוב
            </button>
          )}
        </div>
      )}

      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 24,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`chip ${category === cat.id ? "active" : ""}`}
              onClick={() => handleCategory(cat.id)}
            >
              {cat.name}
              <span className="chip-count">{cat.count}</span>
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div className="tabs-line">
            {(
              [
                { id: "all", label: "הכל", n: allProducts.length },
                {
                  id: "pending",
                  label: "טרם עוצבו",
                  n: allProducts.filter((p) => !p.optimized).length,
                },
                {
                  id: "optimized",
                  label: "מעוצבים",
                  n: allProducts.filter((p) => p.optimized).length,
                },
                {
                  id: "new",
                  label: "חדשים",
                  n: allProducts.filter(isNewProduct).length,
                },
              ] as const
            ).map((t) => (
              <div
                key={t.id}
                className={`tab-line ${view === t.id ? "active" : ""}`}
                onClick={() => setView(t.id)}
              >
                {t.label}{" "}
                <span className="tab-num mono">
                  {String(t.n).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
          <div style={{ position: "relative", width: 260 }}>
            <span
              style={{
                position: "absolute",
                insetInlineStart: 0,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--ink-3)",
              }}
            >
              <II.Search size={14} />
            </span>
            <input
              className="input"
              placeholder="חפש מוצר…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ height: 38, paddingInlineStart: 26, fontSize: 13 }}
            />
          </div>
        </div>
      </section>

      {loadingShopify && connected && filtered.length === 0 ? (
        <CatalogSkeleton />
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: "80px 20px",
            textAlign: "center",
            color: "var(--ink-3)",
            maxWidth: 480,
            margin: "0 auto",
          }}
        >
          <div
            className="aster"
            style={{
              fontSize: 32,
              color: "var(--cream-dim)",
              marginBottom: 14,
            }}
          >
            ✱
          </div>
          {!connected ? (
            <>
              <p style={{ color: "var(--ink-2)", marginBottom: 8, fontSize: 15 }}>
                אין עדיין מוצרים בקטלוג
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                חבר את חנות Shopify שלך כדי לטעון את המוצרים האמיתיים, או העלה
                תמונות מהמחשב כדי להתחיל לעצב.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                {onConnect && (
                  <button className="btn btn-primary" onClick={onConnect}>
                    <II.Shopify size={15} /> חבר חנות Shopify
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <II.Upload size={15} /> העלה תמונות
                </button>
              </div>
            </>
          ) : showingDrafts ? (
            <>
              <p style={{ color: "var(--ink-2)", marginBottom: 8, fontSize: 15 }}>
                אין מוצרים בטיוטה
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                מוצרים שעדיין לא פורסמו באתר יופיעו כאן, ואפשר לעצב להם תמונה
                לפני שהם הופכים לפעילים.
              </p>
            </>
          ) : connected && shopifyProducts.length === 0 && uploads.length === 0 ? (
            <>
              <p style={{ color: "var(--ink-2)", marginBottom: 8, fontSize: 15 }}>
                החנות מחוברת אבל לא נמצאו מוצרים
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                ודא שיש מוצרים עם תמונות בחנות, או העלה תמונות ידנית.
              </p>
              {onReloadShopify && (
                <button className="btn btn-ghost" onClick={onReloadShopify}>
                  רענן קטלוג
                </button>
              )}
            </>
          ) : (
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>
              לא נמצאו מוצרים בסינון הנוכחי. נסה קטגוריה אחרת או חיפוש שונה.
            </p>
          )}
        </div>
      ) : (
        <div className="product-grid">
          {filtered.map((p, i) => {
            const isSelected = selectedIds.includes(p.id);
            const upload = isUploadedProduct(p);
            const storeBacked = isStoreBackedProduct(p);
            const isDraft = p.listingStatus === "draft";
            const missingSource = storeBacked && !p.imageUrl;
            const imgSrc = upload
              ? p.fileUrl
              : storeBacked
                ? p.imageUrl
                : buildImgUrl(p.img, 480);
            return (
              <div
                key={p.id}
                className={`product-card ${isSelected ? "selected" : ""}${
                  atSelectionLimit && !isSelected ? " selection-capped" : ""
                } anim-up`}
                style={{ animationDelay: `${(i % 12) * 30}ms` }}
                onClick={() => {
                  if (missingSource) return;
                  toggle(p.id);
                }}
              >
                <div className="product-img">
                  {imgSrc ? (
                    <img src={imgSrc} alt={p.name} loading="lazy" />
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        color: "var(--ink-3)",
                        fontSize: 12,
                      }}
                    >
                      אין תמונת מקור
                    </div>
                  )}
                  <span
                    className={`product-tag ${p.optimized ? "opt" : ""}`}
                  >
                    {isDraft
                      ? "טיוטה"
                      : upload
                        ? "הועלה"
                        : p.optimized
                          ? "מעוצב"
                          : "חדש"}
                  </span>
                  <div className="product-check">
                    {isSelected && <II.Check size={12} strokeWidth={3} />}
                  </div>
                  {upload && p.gallery && p.gallery.length > 1 && (
                    <div
                      className="gallery-strip"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.gallery.map((img) => {
                        const active = (p.activeSrc || p.gallery?.[0]?.src) === img.src;
                        return (
                          <button
                            key={img.src}
                            type="button"
                            className={active ? "on" : ""}
                            title={active ? "התמונה שתישלח לעיצוב" : "סמן כתמונה לעיצוב"}
                            onClick={() => onPickGalleryImage?.(p.id, img.src)}
                          >
                            <img
                              src={img.src}
                              alt=""
                              onError={(e) => {
                                const el = e.currentTarget;
                                if (!el.src.includes("/api/fetch-image")) {
                                  el.src = `/api/fetch-image?url=${encodeURIComponent(img.src)}`;
                                }
                              }}
                            />
                            {active && <span className="pick-label">לעיצוב</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className="corner-marks">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <div className="product-info">
                  <div className="product-name">{p.name}</div>
                  <div className="product-price">{formatCatalogPrice(p)}</div>
                  {missingSource && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)" }}>
                      צריך תמונת מקור כדי לעצב
                    </div>
                  )}
                  {upload && p.gallery && p.gallery.length > 1 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)" }}>
                      סמן איזו תמונה תישלח לעיצוב
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SiteCatalogScan
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onImport={onImportScanned}
      />

      {selectedIds.length > 0 && !hideBulkBar && (
        <BulkBar>
          <div className="bulk-count">
            <span className="bulk-count-num">
              {String(selectedIds.length).padStart(2, "0")}
            </span>
            <div>
              <div
                style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}
              >
                מוצרים נבחרו
              </div>
              {allProducts.some(
                (p) =>
                  selectedIds.includes(p.id) &&
                  isUploadedProduct(p) &&
                  (p.gallery?.length || 0) > 1
              ) && (
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                  תעוצב התמונה שסימנת בכל מוצר
                </div>
              )}
            </div>
          </div>
          <div
            className="bulk-progress"
            aria-label={`${selectedIds.length} מתוך ${MAX_BATCH_SELECT} תמונות`}
          >
            <div className="bulk-progress-track">
              <div
                className="bulk-progress-fill"
                style={{ width: `${selectionPct}%` }}
              />
            </div>
            <span className="bulk-progress-label mono">
              {selectedIds.length}/{MAX_BATCH_SELECT}
            </span>
          </div>
          <button className="btn btn-ghost" onClick={clearAll}>
            נקה
          </button>
          {onPushToCms &&
            selectedIds.some((id) => uploads.some((u) => u.id === id)) && (
              <button
                className="btn btn-ghost"
                disabled={pushingToCms}
                onClick={() => onPushToCms(selectedIds)}
              >
                {pushingToCms ? "מעדכן באתר…" : "עדכן באתר"}
              </button>
            )}
          <button
            className="btn btn-primary lg"
            onClick={() => onStartBatch(selectedIds)}
          >
            <II.Wand size={26} scale={1.55} /> עצב {selectedIds.length} תמונות
          </button>
        </BulkBar>
      )}
    </>
  );
};

const CatalogSkeleton: React.FC = () => (
  <div className="product-grid">
    {Array.from({ length: 12 }).map((_, i) => (
      <div
        key={i}
        className="product-card"
        style={{ animationDelay: `${i * 30}ms`, cursor: "default" }}
      >
        <div
          className="product-img"
          style={{
            background:
              "linear-gradient(110deg, var(--bg-card) 30%, var(--bg-card-hi) 50%, var(--bg-card) 70%)",
            backgroundSize: "300% 100%",
            animation: "shine 1.6s linear infinite",
          }}
        />
        <div className="product-info">
          <div
            className="product-name"
            style={{
              height: 14,
              width: "70%",
              background: "var(--bg-card-hi)",
              borderRadius: 4,
            }}
          />
          <div
            className="product-price"
            style={{
              height: 12,
              width: 50,
              background: "var(--bg-card-hi)",
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ))}
  </div>
);

/* ============================================================
   PRESET PICKER MODAL
   ============================================================ */

export const PresetPickerModal: React.FC<{
  count: number;
  onClose: () => void;
  onConfirm: (options: ProcessingOptions) => void;
}> = ({ count, onClose, onConfirm }) => {
  const [picked, setPicked] = useState<string>("studio-white");
  const [removeBackground, setRemoveBackground] = useState(true);
  const [keepProportion, setKeepProportion] = useState(true);
  const [preservePackUnits, setPreservePackUnits] = useState(true);
  const [recolorHex, setRecolorHex] = useState("#111111");
  const [recolorLabel, setRecolorLabel] = useState("שחור");
  const [recolorScope, setRecolorScope] = useState<RecolorScope>("both");
  const [emptyInterior, setEmptyInterior] = useState(false);
  const [productFix, setProductFix] = useState<ProductFixOptions>({});

  const pickPreset = (id: string) => {
    setPicked(id);
    if (CATALOG_STYLE_PRESET_IDS.has(id)) {
      setRemoveBackground(true);
      setKeepProportion(false);
    }
    setEmptyInterior(id === EMPTY_INTERIOR_PRESET_ID);
  };

  const pickedPreset = PRESETS.find((p) => p.id === picked);
  const canStart =
    pickedPreset?.available !== false &&
    (picked !== PRODUCT_RECOLOR_PRESET_ID ||
      /^#?[0-9a-fA-F]{6}$/.test(recolorHex));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-preset" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head modal-preset-head">
          <div className="modal-preset-head-main">
            <div className="eyebrow">שלב 02 / 03 · בחירת סגנון</div>
            <div className="modal-preset-title-row">
              <h2 className="h-1 modal-preset-title">
                איך התמונות{" "}
                <span style={{ fontStyle: "italic", fontWeight: 500 }}>ייראו</span>
                <span className="grad-text">?</span>
              </h2>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            <II.X size={18} />
          </button>
        </div>

        <div className="modal-body modal-preset-body">
          <div className="preset-grid">
            {PRESETS.map((preset, i) => {
              const locked = preset.available === false || preset.comingSoon;
              return (
                <div
                  key={preset.id}
                  className={`preset ${picked === preset.id ? "selected" : ""}${
                    locked ? " coming-soon" : ""
                  }`}
                  onClick={() => {
                    if (!locked) pickPreset(preset.id);
                  }}
                  aria-disabled={locked}
                >
                  <div
                    className="preset-thumb"
                    style={{ background: preset.gradient }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "52%",
                          height: "64%",
                          borderRadius: 8,
                          background: "rgba(0,0,0,.16)",
                          boxShadow:
                            "0 12px 30px -8px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.18)",
                          transform: "rotate(-2deg)",
                        }}
                      />
                    </div>
                    {preset.comingSoon ? (
                      <span className="preset-tag preset-tag-soon">Coming Soon</span>
                    ) : preset.tag ? (
                      <span className="preset-tag">{preset.tag}</span>
                    ) : null}
                  </div>
                  <div className="preset-meta">
                    <div>
                      <div className="preset-name">{preset.name}</div>
                      <div className="preset-desc">{preset.desc}</div>
                    </div>
                    <span className="preset-num">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {picked === PRODUCT_RECOLOR_PRESET_ID && (
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                צבע המוצר
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {[
                  ["שחור", "#111111"],
                  ["גרפיט", "#3A3A3A"],
                  ["לבן", "#F3F3F3"],
                  ["כסף", "#C0C4C8"],
                ].map(([label, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    className={
                      recolorHex.toLowerCase() === hex.toLowerCase()
                        ? "btn btn-primary"
                        : "btn btn-ghost"
                    }
                    onClick={() => {
                      setRecolorHex(hex);
                      setRecolorLabel(label);
                    }}
                    style={{ height: 36 }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 99,
                        background: hex,
                        border: "1px solid rgba(0,0,0,.2)",
                      }}
                    />
                    {label}
                  </button>
                ))}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(recolorHex) ? recolorHex : "#111111"}
                    onChange={(e) => {
                      setRecolorHex(e.target.value);
                      setRecolorLabel("מותאם");
                    }}
                    style={{ width: 36, height: 32, border: 0, background: "none" }}
                  />
                  מותאם
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(
                  [
                    ["both", "פנים וחוץ"],
                    ["exterior", "רק חוץ"],
                    ["interior", "רק פנים"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={recolorScope === id ? "btn btn-primary" : "btn btn-ghost"}
                    onClick={() => setRecolorScope(id)}
                    style={{ height: 34 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ProductFixSection value={productFix} onChange={setProductFix} />

          <hr className="hr" style={{ margin: "18px 0" }} />

          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              הגדרות עיבוד
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <ToggleRow
                label="מחיקת רקע"
                hint="הסר את הרקע המקורי וסדר את המוצר על רקע נקי"
                on={removeBackground}
                setOn={setRemoveBackground}
              />
              <ToggleRow
                label="שמירה על פרופורציות המוצר"
                hint={
                  CATALOG_STYLE_PRESET_IDS.has(picked)
                    ? "כבוי בעיצוב קטלוג — כדי שאפשר להשלים מוצר חתוך"
                    : "שמור על יחס הגובה-רוחב והגודל היחסי בתוך התמונה"
                }
                on={keepProportion}
                setOn={setKeepProportion}
                disabled={CATALOG_STYLE_PRESET_IDS.has(picked)}
              />
              <ToggleRow
                label="שמירת כל היחידות במארז"
                hint="אם התמונה מציגה כמה יחידות זהות (מארז 2/3), שמור את כולן במקום לצמצם ליחידה אחת"
                on={preservePackUnits}
                setOn={setPreservePackUnits}
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
            }}
          >
            <span
              className="serif mono"
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              {String(count).padStart(2, "0")}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                תמונות יעובדו
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                עלות · <span className="mono">{count} קרדיטים</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button
              className="btn btn-primary"
              disabled={!canStart}
              onClick={() =>
                onConfirm({
                  presetId: picked,
                  removeBackground,
                  keepProportion,
                  preservePackUnits,
                  emptyInterior:
                    emptyInterior || picked === EMPTY_INTERIOR_PRESET_ID,
                  ...(picked === PRODUCT_RECOLOR_PRESET_ID
                    ? { recolorHex, recolorLabel, recolorScope }
                    : {}),
                  ...pickProductFix(productFix),
                })
              }
              style={{ opacity: canStart ? 1 : 0.5 }}
            >
              <II.Wand size={24} scale={1.5} /> התחל עיצוב
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  hint?: string;
  on: boolean;
  setOn: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
}> = ({ label, hint, on, setOn, disabled }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      {hint ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
          {hint}
        </div>
      ) : null}
    </div>
    <button
      onClick={() => {
        if (!disabled) setOn((v) => !v);
      }}
      disabled={disabled}
      style={{
        width: 38,
        height: 22,
        borderRadius: 999,
        opacity: disabled ? 0.45 : 1,
        position: "relative",
        background: on ? "var(--grad)" : "var(--bg-card-hi)",
        transition: "background .2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          [on ? "left" : "right"]: 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "white",
          transition: "all .2s",
        }}
      />
    </button>
  </div>
);

/* ============================================================
   PROCESSING OVERLAY — runs real /api/process for real uploads
   ============================================================ */

export type ProcessedResult = {
  productId: number;
  beforeUrl: string;
  afterUrl: string;
  /** The base64 (no data: prefix) of the AI output, ready to upload to Shopify. */
  afterBase64?: string;
  blueprintLayout?: import("@/lib/blueprint-annotations").BlueprintLayout;
  name: string;
  /** True iff we actually ran the AI on a real image. */
  isReal: boolean;
  /** True iff this is backed by a real Shopify product → can be published. */
  isShopify: boolean;
  /** True iff backed by a Lovable / custom API product. */
  isCustomApi: boolean;
  /** Remote product id for custom API publish. */
  externalProductId?: string;
  /** Original Shopify product id (same as productId when isShopify). */
  shopifyImageId?: number;
  /** Any processing error message. */
  error?: string;
  /** Preset used — for gradient placeholder when image URL is missing. */
  presetId?: string;
  shopifyProductId?: number;
};

async function urlToFile(
  url: string,
  filename: string,
  fallbackType = "image/png"
): Promise<File> {
  const res = await fetch("/api/fetch-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `שגיאה בהורדת התמונה (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || fallbackType });
}

function parseProcessedImage(data: {
  image?: string;
  imageBase64?: string;
  layout?: import("@/lib/blueprint-annotations").BlueprintLayout;
}): {
  afterUrl: string;
  afterBase64: string;
  blueprintLayout?: import("@/lib/blueprint-annotations").BlueprintLayout;
} | null {
  const raw = data.imageBase64 ?? data.image;
  if (!raw || typeof raw !== "string") return null;
  const blueprintLayout =
    data.layout && data.layout.canvasW > 0 ? data.layout : undefined;
  if (raw.startsWith("data:")) {
    const afterBase64 = raw.split(",")[1];
    if (!afterBase64) return null;
    return { afterUrl: raw, afterBase64, blueprintLayout };
  }
  return {
    afterUrl: `data:image/png;base64,${raw}`,
    afterBase64: raw,
    blueprintLayout,
  };
}

export type BlueprintDims = {
  widthCm: number;
  heightCm: number;
  depthCm: number;
};

const BLUEPRINT_CONCURRENCY = 2;

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      run()
    )
  );
}

export const ProcessingOverlay: React.FC<{
  products: AnyProduct[];
  presetId: string;
  processingOptions: ProcessingOptions;
  quality: Quality;
  onDone: (results: ProcessedResult[]) => void;
  blueprintDimsByProduct?: Record<number, BlueprintDims>;
}> = ({
  products,
  presetId,
  processingOptions,
  quality,
  onDone,
  blueprintDimsByProduct,
}) => {
  const isBlueprint = presetId === "blueprint" || !!blueprintDimsByProduct;
  const isCatalogStyle = CATALOG_STYLE_PRESET_IDS.has(presetId);
  const isCatalogPro = presetId === CATALOG_PRO_PRESET_ID;
  const useQueue = isBlueprint || isCatalogStyle;
  const [progress, setProgress] = useState(0);
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [activeIds, setActiveIds] = useState<number[]>([]);
  const [activeNames, setActiveNames] = useState<string[]>([]);
  const [phase, setPhase] = useState<"download" | "process" | "done">(
    "download"
  );
  const preset = PRESETS.find((p) => p.id === presetId);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    const slots: ProcessedResult[] = new Array(products.length);
    const size: ImageSize = "1024x1024";

    const runProcess = async (
      file: File,
      productName: string,
      dims?: BlueprintDims
    ): Promise<{
      afterUrl: string;
      afterBase64: string;
      blueprintLayout?: import("@/lib/blueprint-annotations").BlueprintLayout;
    } | null> => {
      const form = new FormData();
      form.append("image", file);
      form.append("quality", quality);
      form.append("productName", productName);

      if (dims) {
        form.append("widthCm", String(dims.widthCm));
        form.append("heightCm", String(dims.heightCm));
        form.append("depthCm", String(dims.depthCm));
      } else {
        form.append("size", size);
        form.append("mode", "single");
        form.append("preset", presetId);
        form.append(
          "removeBackground",
          processingOptions.removeBackground ? "1" : "0"
        );
        form.append(
          "keepProportion",
          processingOptions.keepProportion ? "1" : "0"
        );
        form.append(
          "preservePackUnits",
          processingOptions.preservePackUnits !== false ? "1" : "0"
        );
        if (processingOptions.recolorHex) {
          form.append("recolorHex", processingOptions.recolorHex);
          form.append("recolorLabel", processingOptions.recolorLabel || "");
          form.append("recolorScope", processingOptions.recolorScope || "both");
        }
        if (processingOptions.emptyInterior) {
          form.append("emptyInterior", "1");
        }
        appendProductFixToForm(form, processingOptions);
      }

      const res = await fetch(dims ? "/api/blueprint" : "/api/process", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `שגיאה בעיבוד (${res.status})`);
      }
      const data = await res.json();
      return parseProcessedImage(data);
    };

    const processOne = async (p: AnyProduct): Promise<ProcessedResult> => {
      const upload = isUploadedProduct(p);
      const shopify = isShopifyProduct(p);
      const customApi = isCustomApiProduct(p);
      const storeBacked = shopify || customApi;
      const dims = blueprintDimsByProduct?.[p.id];

      const beforeUrl = upload
        ? p.fileUrl
        : storeBacked
          ? p.imageUrl
          : buildImgUrl((p as Product).img, 600);
      let afterUrl = beforeUrl;
      let afterBase64: string | undefined;
      let errorMsg: string | undefined;
      let blueprintLayout: import("@/lib/blueprint-annotations").BlueprintLayout | undefined;

      try {
        if (isBlueprint && !dims) {
          throw new Error("חסרות מידות למוצר הזה");
        }
        if (upload) {
          setPhase("process");
          const processed = await runProcess(p.file, p.name, dims);
          if (processed) {
            afterBase64 = processed.afterBase64;
            afterUrl = processed.afterUrl;
            blueprintLayout = processed.blueprintLayout;
          } else {
            errorMsg = "המודל לא החזיר תמונה";
          }
        } else if (storeBacked) {
          if (!p.imageUrl) {
            throw new Error("אין תמונת מקור למוצר הטיוטה");
          }
          setPhase("download");
          const safeName =
            p.name.replace(/[^\w\u0590-\u05FF]+/g, "_").slice(0, 80) ||
            "product";
          const file = await urlToFile(p.imageUrl, `${safeName}.jpg`);
          if (cancelled) {
            throw new Error("בוטל");
          }
          setPhase("process");
          const processed = await runProcess(file, p.name, dims);
          if (processed) {
            afterBase64 = processed.afterBase64;
            afterUrl = processed.afterUrl;
            blueprintLayout = processed.blueprintLayout;
          } else {
            errorMsg = "המודל לא החזיר תמונה";
          }
        } else {
          setPhase("process");
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : "שגיאה לא ידועה";
        console.error("process failed for", p.name, err);
      }

      return {
        productId: p.id,
        beforeUrl,
        afterUrl,
        afterBase64,
        name: p.name,
        isReal: upload || storeBacked,
        isShopify: shopify,
        isCustomApi: customApi,
        externalProductId: customApi ? p.externalId : undefined,
        shopifyImageId: shopify ? p.imageId : undefined,
        error: errorMsg,
        blueprintLayout,
      };
    };

    (async () => {
      const concurrency = useQueue ? BLUEPRINT_CONCURRENCY : 1;
      await runPool(products, concurrency, async (p, i) => {
        if (cancelled) return;
        setActiveIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]));
        setActiveNames((names) =>
          names.includes(p.name) ? names : [...names, p.name]
        );
        const result = await processOne(p);
        if (cancelled) return;
        slots[i] = result;
        setActiveIds((ids) => ids.filter((id) => id !== p.id));
        setActiveNames((names) => names.filter((n) => n !== p.name));
        setDoneIds((ids) => [...ids, p.id]);
        setProgress((n) => n + 1);
      });

      if (cancelled) return;
      setPhase("done");
      const results = slots.filter(Boolean);
      setTimeout(() => onDoneRef.current(results), 600);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    products,
    presetId,
    processingOptions,
    quality,
    blueprintDimsByProduct,
    isBlueprint,
    useQueue,
  ]);

  const pct = (progress / products.length) * 100;

  return (
    <div className="overlay" style={{ background: "rgba(6,3,10,.92)" }}>
      <div style={{ width: "100%", maxWidth: 720, textAlign: "center" }}>
        <div
          className="eyebrow"
          style={{ marginBottom: 20, justifyContent: "center" }}
        >
          {isBlueprint
            ? "שלב 03 / 03 · תור שרטוטים"
            : isCatalogStyle
              ? "שלב 03 / 03 · תור עיבוד"
              : "שלב 03 / 03 · עיבוד AI"}
        </div>

        <div
          style={{
            position: "relative",
            width: 220,
            height: 220,
            margin: "0 auto 40px",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: preset?.gradient || "var(--grad)",
              filter: "blur(40px)",
              opacity: 0.5,
              animation: "pulse 1.8s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 36,
              borderRadius: "50%",
              background: preset?.gradient || "var(--grad)",
              display: "grid",
              placeItems: "center",
              animation: "floaty 3s ease-in-out infinite",
              boxShadow: "0 24px 80px -20px rgba(0,0,0,.5)",
            }}
          >
            <StarLoader size={58} scale={3.2} tint="gradient" />
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: -(i + 1) * 24,
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: "50%",
                animation: `pulse ${2 + i * 0.3}s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>

        <h2 className="h-display processing-magic-title" style={{ marginBottom: 12 }}>
          <span>הקסם</span>
          <span
            style={{ fontStyle: "italic", fontWeight: 500 }}
            className="grad-text"
          >
            קורה.
          </span>
        </h2>
        <p className="text-2" style={{ fontSize: 15, marginBottom: 36 }}>
          {isBlueprint
            ? "שרטוט קווי מקצועי"
            : isCatalogStyle
              ? `סגנון ${preset?.name ?? "עיבוד"}`
              : `סגנון ${preset?.name}`}{" "}
          <span className="aster">·</span>{" "}
          <span className="mono">{products.length} תמונות</span>
        </p>

        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            <span>
              {progress < products.length ? (
                <>
                  {phase === "download"
                    ? "מוריד תמונה ·"
                    : isBlueprint
                      ? "משרטט ·"
                      : presetId === PRODUCT_RECOLOR_PRESET_ID
                        ? "צובע ·"
                        : presetId === EMPTY_INTERIOR_PRESET_ID
                          ? "מרוקן ·"
                          : isCatalogPro
                            ? "מעצב קטלוג ·"
                            : "מעבד AI ·"}{" "}
                  <strong style={{ color: "var(--ink)" }}>
                    {activeNames.join(" · ") || "מתחיל"}
                  </strong>
                </>
              ) : (
                "מסיים"
              )}
            </span>
            <span className="mono" style={{ fontWeight: 700 }}>
              {progress} / {products.length}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            marginTop: 36,
            flexWrap: "wrap",
            maxWidth: 520,
            marginInline: "auto",
          }}
        >
          {products.map((p) => {
            const done = doneIds.includes(p.id);
            const active = activeIds.includes(p.id);
            const upload = isUploadedProduct(p);
            const storeBacked = isStoreBackedProduct(p);
            const imgSrc = upload
              ? p.fileUrl
              : storeBacked
                ? p.imageUrl
                : buildImgUrl((p as Product).img, 120);
            return (
              <div
                key={p.id}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  overflow: "hidden",
                  position: "relative",
                  opacity: done || active ? 1 : 0.3,
                  transition: "all .3s",
                  border: done
                    ? "2px solid var(--cream)"
                    : active
                      ? "2px solid rgba(176,64,224,.7)"
                      : "1px solid var(--hair-2)",
                }}
              >
                <img
                  src={imgSrc}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {done && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(0,0,0,.25)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <II.Check
                      size={14}
                      strokeWidth={3}
                      style={{ color: "white" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   RESULTS
   ============================================================ */

export const ResultsScreen: React.FC<{
  results: ProcessedResult[];
  presetId: string;
  connection: StoreConnection | null;
  onPublish: (approvedIds: number[]) => void | Promise<void>;
  onBack: () => void;
  mode?: "studio" | "blueprint";
  onLayoutChange?: (
    productId: number,
    layout: BlueprintLayout,
    imageUrl?: string
  ) => void;
  onResultUpdate?: (
    productId: number,
    update: { afterUrl: string; afterBase64: string }
  ) => void;
  onToast?: (msg: string) => void;
}> = ({
  results,
  presetId,
  connection,
  onPublish,
  onBack,
  mode = "studio",
  onLayoutChange,
  onResultUpdate,
  onToast,
}) => {
  const isBlueprint = mode === "blueprint" || presetId === "blueprint";
  const platformLabel = connection
    ? getConnectionPlatformLabel(connection)
    : "החנות";
  const preset = PRESETS.find((p) => p.id === presetId);
  const [perCard, setPerCard] = useState<Record<number, "before" | "after">>(
    () =>
      Object.fromEntries(results.map((r) => [r.productId, "after"])) as Record<
        number,
        "before" | "after"
      >
  );
  const [globalView, setGlobalView] = useState<"before" | "after">("after");
  const [statuses, setStatuses] = useState<
    Record<number, "pending" | "approved" | "rejected">
  >(() =>
    Object.fromEntries(
      // Default-approve successful real results so a single click is enough.
      results.map((r) => [
        r.productId,
        r.isReal && !r.error ? "approved" : "pending",
      ])
    ) as Record<number, "pending" | "approved" | "rejected">
  );
  const [publishing, setPublishing] = useState(false);
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  const [layouts, setLayouts] = useState<Record<number, BlueprintLayout>>(() =>
    Object.fromEntries(
      results
        .filter((r) => r.blueprintLayout)
        .map((r) => [r.productId, r.blueprintLayout!])
    )
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Set<number>>(new Set());
  const [uploadedIds, setUploadedIds] = useState<Set<number>>(new Set());
  const [fixTarget, setFixTarget] = useState<ProductFixTarget | null>(null);
  const [fixingIds, setFixingIds] = useState<Set<number>>(new Set());
  const customApiConn =
    connection?.platform === "custom-api" ? connection : null;

  const canUploadDrawing = (r: ProcessedResult) =>
    isBlueprint &&
    !!customApiConn &&
    r.isCustomApi &&
    !!r.externalProductId &&
    r.isReal &&
    !r.error &&
    !!r.afterUrl;

  const uploadDrawing = async (r: ProcessedResult, silent?: boolean) => {
    if (!customApiConn || !r.externalProductId || !r.afterUrl) return false;
    setUploadingIds((prev) => new Set(prev).add(r.productId));
    try {
      await uploadFlattenedDrawing(customApiConn, {
        productId: r.externalProductId,
        imageUrl: r.afterUrl,
        layout: layouts[r.productId],
        filename: "drawing.png",
      });
      setUploadedIds((prev) => new Set(prev).add(r.productId));
      if (!silent) onToast?.("השרטוט הועלה לאתר");
      return true;
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : "העלאת השרטוט נכשלה"
      );
      return false;
    } finally {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(r.productId);
        return next;
      });
    }
  };

  const openViewer = (r: ProcessedResult) => {
    if (!r.isReal || r.error || !r.afterUrl) return;
    if (isBlueprint && layouts[r.productId]) {
      setEditingId(r.productId);
      return;
    }
    setViewerImage({
      originalUrl: r.beforeUrl,
      resultUrl: r.afterUrl,
      fileName: r.name,
    });
  };

  const downloadFlattened = async (r: ProcessedResult) => {
    const layout = layouts[r.productId];
    const href = layout
      ? await flattenBlueprint(r.afterUrl, layout)
      : r.afterUrl;
    const a = document.createElement("a");
    a.href = href;
    a.download = `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}_blueprint.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const setView = (id: number, v: "before" | "after") =>
    setPerCard((prev) => ({ ...prev, [id]: v }));
  const setStatus = (id: number, s: "pending" | "approved" | "rejected") =>
    setStatuses((prev) => ({ ...prev, [id]: s }));
  const setGlobal = (v: "before" | "after") => {
    setGlobalView(v);
    setPerCard(
      Object.fromEntries(results.map((r) => [r.productId, v])) as Record<
        number,
        "before" | "after"
      >
    );
  };
  const approveAll = () =>
    setStatuses(
      Object.fromEntries(
        results.map((r) => [r.productId, "approved"])
      ) as Record<number, "pending" | "approved" | "rejected">
    );

  const approved = Object.values(statuses).filter(
    (s) => s === "approved"
  ).length;
  const rejected = Object.values(statuses).filter(
    (s) => s === "rejected"
  ).length;
  const pending = results.length - approved - rejected;

  const extraFixCount = fixTarget
    ? results.filter(
        (r) =>
          r.productId !== fixTarget.productId &&
          r.isReal &&
          !r.error &&
          !!r.afterUrl &&
          statuses[r.productId] === "approved"
      ).length
    : 0;

  const applyProductFixToResults = async (
    fix: ProductFixOptions,
    applyToAll: boolean
  ) => {
    if (!fixTarget) return;
    const primaryId = fixTarget.productId;
    const targets = results.filter((r) => {
      if (!r.isReal || r.error || !r.afterUrl) return false;
      if (r.productId === primaryId) return true;
      return applyToAll && statuses[r.productId] === "approved";
    });
    let primaryError: Error | null = null;
    let ok = 0;
    let failed = 0;
    await runPool(targets, 1, async (r) => {
      setFixingIds((prev) => new Set(prev).add(r.productId));
      try {
        const processed = await runProductFix({
          beforeUrl: r.beforeUrl,
          afterUrl: r.afterUrl,
          name: r.name,
          fix,
          quality: "high",
        });
        onResultUpdate?.(r.productId, processed);
        ok += 1;
      } catch (err) {
        failed += 1;
        const error =
          err instanceof Error ? err : new Error("התיקון נכשל");
        if (r.productId === primaryId) primaryError = error;
      } finally {
        setFixingIds((prev) => {
          const next = new Set(prev);
          next.delete(r.productId);
          return next;
        });
      }
    });
    if (primaryError) throw primaryError;
    if (failed > 0) {
      onToast?.(`${ok} תוקנו, ${failed} נכשלו`);
    } else {
      onToast?.(ok > 1 ? `${ok} תמונות תוקנו` : "המוצר תוקן");
    }
  };

  const downloadAll = async () => {
    const reals = results.filter((r) => r.isReal);
    if (reals.length === 0) return;
    for (const r of reals) {
      if (isBlueprint) {
        await downloadFlattened(r);
      } else {
        const a = document.createElement("a");
        a.href = r.afterUrl;
        a.download = `${r.name.replace(/[^\w\u0590-\u05FF]+/g, "_")}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      await new Promise((res) => setTimeout(res, 150));
    }
  };

  return (
    <>
      <section
        style={{
          paddingBottom: 36,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 48,
        }}
      >
        <button
          className="btn-line"
          onClick={onBack}
          style={{ marginBottom: 24, fontSize: 12 }}
        >
          <II.ArrowRight size={14} /> {isBlueprint ? "חזור לשרטוט" : "חזור למוצרים"}
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              שלב 03 / 03 · תוצאות
            </div>
            <h1 className="h-display">
              {isBlueprint ? (
                <>
                  שרטוט{" "}
                  <span
                    style={{ fontStyle: "italic", fontWeight: 500 }}
                    className="grad-text"
                  >
                    מידות
                  </span>
                </>
              ) : (
                <>
                  סגנון{" "}
                  <span
                    style={{ fontStyle: "italic", fontWeight: 500 }}
                    className="grad-text"
                  >
                    {preset?.name}
                  </span>
                </>
              )}
            </h1>
            <p className="text-2" style={{ marginTop: 14, fontSize: 14 }}>
              <span
                className="serif mono"
                style={{
                  fontSize: 18,
                  color: "var(--ink)",
                  marginInlineEnd: 6,
                }}
              >
                {results.length}
              </span>{" "}
              {isBlueprint
                ? "שרטוטים מוכנים"
                : "תמונות עובדו"}{" "}
              <span className="aster">·</span>{" "}
              {isBlueprint
                ? "השווה לפני ואחרי והורד"
                : "בחר אילו לשלוח חזרה לחנות"}
            </p>
          </div>
          <div
            style={{ display: "flex", gap: 10, alignItems: "center" }}
          >
            <div className="tabs-line" style={{ gap: 20 }}>
              <div
                className={`tab-line ${globalView === "before" ? "active" : ""}`}
                onClick={() => setGlobal("before")}
              >
                לפני (הכל)
              </div>
              <div
                className={`tab-line ${globalView === "after" ? "active" : ""}`}
                onClick={() => setGlobal("after")}
              >
                אחרי (הכל)
              </div>
            </div>
            <button className="btn btn-ghost" onClick={approveAll}>
              <II.Check size={15} /> אשר הכל
            </button>
          </div>
        </div>
      </section>

      <div style={{ display: "flex", gap: 56, marginBottom: 40 }}>
        <Sum num={approved} label="אושרו" color="var(--ok)" />
        <Sum num={rejected} label="נדחו" color="var(--bad)" />
        <Sum num={pending} label="ממתינים" color="var(--ink-3)" />
      </div>

      <div className="product-grid">
        {results.map((r) => {
          const view = perCard[r.productId];
          const status = statuses[r.productId];
          return (
            <div key={r.productId} className="result-card anim-up">
              <div
                className={`result-img-wrap${r.isReal && !r.error ? " result-img-wrap--clickable" : ""}${isBlueprint ? " result-img-wrap--checker" : ""}`}
                role={r.isReal && !r.error ? "button" : undefined}
                tabIndex={r.isReal && !r.error ? 0 : undefined}
                title={
                  r.isReal && !r.error
                    ? "לחץ להגדלה והשוואה לפני/אחרי"
                    : undefined
                }
                onClick={() => openViewer(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openViewer(r);
                  }
                }}
              >
                <img
                  src={r.beforeUrl}
                  className={`result-img ${view === "after" ? "hidden" : ""}`}
                  style={{ objectFit: isBlueprint ? "contain" : "cover" }}
                />
                {r.isReal && !r.error ? (
                  isBlueprint && layouts[r.productId] ? (
                    <div
                      className={`result-img ${view === "before" ? "hidden" : ""}`}
                    >
                      <BlueprintPreview
                        imageUrl={r.afterUrl}
                        layout={layouts[r.productId]}
                      />
                    </div>
                  ) : (
                  <img
                    src={r.afterUrl}
                    className={`result-img ${view === "before" ? "hidden" : ""}`}
                    style={{ objectFit: isBlueprint ? "contain" : "cover", background: isBlueprint ? "transparent" : "#fff" }}
                  />
                  )
                ) : r.error ? (
                  <div
                    className={`result-img ${view === "before" ? "hidden" : ""}`}
                    style={{
                      background: "var(--bg-card)",
                      display: "grid",
                      placeItems: "center",
                      padding: 20,
                      textAlign: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: "#ff8eb3",
                          fontSize: 12,
                          letterSpacing: "0.18em",
                          textTransform: "uppercase",
                          marginBottom: 8,
                          fontWeight: 700,
                        }}
                      >
                        שגיאה בעיבוד
                      </div>
                      <div
                        style={{
                          color: "var(--ink-2)",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        {r.error}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`result-img ${view === "before" ? "hidden" : ""}`}
                    style={{
                      background: preset?.gradient,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "74%",
                        height: "74%",
                        borderRadius: 10,
                        overflow: "hidden",
                        boxShadow: "0 30px 60px -20px rgba(0,0,0,.5)",
                      }}
                    >
                      <img
                        src={r.beforeUrl}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          filter: "contrast(1.05) saturate(1.05)",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="ba-toggle" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={view === "before" ? "active" : ""}
                    onClick={() => setView(r.productId, "before")}
                  >
                    לפני
                  </button>
                  <button
                    className={view === "after" ? "active" : ""}
                    onClick={() => setView(r.productId, "after")}
                  >
                    אחרי
                  </button>
                </div>

                {fixingIds.has(r.productId) && (
                  <div
                    className="result-fix-overlay"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Spinner size={18} />
                    מתקן מוצר…
                  </div>
                )}

                {status !== "pending" && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: 12,
                      insetInlineEnd: 12,
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background:
                        status === "approved" ? "var(--ok)" : "var(--bad)",
                      color: "#0A030F",
                      display: "grid",
                      placeItems: "center",
                      zIndex: 3,
                    }}
                  >
                    {status === "approved" ? (
                      <II.Check size={14} strokeWidth={3} />
                    ) : (
                      <II.X size={14} strokeWidth={3} />
                    )}
                  </div>
                )}
              </div>
              <div>
              <div className="product-info">
                <div className="product-name">{r.name}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    className="icon-btn"
                    title="דחה"
                    onClick={() => setStatus(r.productId, "rejected")}
                    style={{
                      width: 28,
                      height: 28,
                      color:
                        status === "rejected" ? "var(--bad)" : undefined,
                    }}
                  >
                    <II.X size={13} />
                  </button>
                  {isBlueprint && layouts[r.productId] && (
                    <>
                      <button
                        className="icon-btn"
                        title="ערוך מידות"
                        onClick={() => setEditingId(r.productId)}
                        style={{ width: 28, height: 28 }}
                      >
                        <II.Ruler size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        title="הורד עם השינויים"
                        onClick={() => void downloadFlattened(r)}
                        style={{ width: 28, height: 28 }}
                      >
                        <II.Download size={13} />
                      </button>
                    </>
                  )}
                  {canUploadDrawing(r) && (
                    <button
                      className="icon-btn"
                      title={
                        uploadedIds.has(r.productId)
                          ? "השרטוט הועלה לאתר"
                          : "העלה שרטוט לאתר"
                      }
                      disabled={uploadingIds.has(r.productId)}
                      onClick={() => void uploadDrawing(r)}
                      style={{
                        width: 28,
                        height: 28,
                        color: uploadedIds.has(r.productId)
                          ? "var(--ok)"
                          : undefined,
                      }}
                    >
                      {uploadingIds.has(r.productId) ? (
                        <Spinner size={13} />
                      ) : (
                        <II.Upload size={13} />
                      )}
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="אשר"
                    onClick={() => setStatus(r.productId, "approved")}
                    style={{
                      width: 28,
                      height: 28,
                      color:
                        status === "approved" ? "var(--ok)" : undefined,
                    }}
                  >
                    <II.Check size={13} />
                  </button>
                </div>
              </div>
                {!isBlueprint && r.isReal && !r.error && r.afterUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={fixingIds.has(r.productId)}
                    onClick={() =>
                      setFixTarget({
                        productId: r.productId,
                        name: r.name,
                        beforeUrl: r.beforeUrl,
                        afterUrl: r.afterUrl,
                      })
                    }
                    style={{
                      width: "100%",
                      height: 36,
                      marginTop: 10,
                      fontSize: 12,
                    }}
                  >
                    {fixingIds.has(r.productId) ? (
                      <>
                        <Spinner size={14} /> מתקן…
                      </>
                    ) : (
                      <>
                        <II.Wand size={20} scale={1.2} /> תיקון מוצר
                      </>
                    )}
                  </button>
                )}
                {canUploadDrawing(r) && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={uploadingIds.has(r.productId)}
                    onClick={() => void uploadDrawing(r)}
                    style={{
                      width: "100%",
                      height: 36,
                      marginTop: 10,
                      fontSize: 12,
                      color: uploadedIds.has(r.productId)
                        ? "var(--ok)"
                        : undefined,
                    }}
                  >
                    {uploadingIds.has(r.productId) ? (
                      <>
                        <Spinner size={14} /> מעלה שרטוט…
                      </>
                    ) : uploadedIds.has(r.productId) ? (
                      <>
                        <II.Check size={14} /> הועלה לאתר
                      </>
                    ) : (
                      <>
                        <II.Upload size={14} /> העלה שרטוט לאתר
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <BulkBar>
        <div className="bulk-count">
          <span className="bulk-count-num">
            {String(approved || results.length).padStart(2, "0")}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {isBlueprint
                ? approved > 0
                  ? "מוכנים להורדה"
                  : "שרטוטים מוכנים"
                : approved > 0
                  ? "אושרו לפרסום"
                  : "מוכנים לפרסום"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {isBlueprint ? "שרטוט מידות" : `סגנון ${preset?.name}`}
            </div>
          </div>
        </div>
        <div
          style={{ flex: 1, height: 26, width: 1, background: "var(--hair)" }}
        />
        <button className="btn btn-ghost" onClick={downloadAll}>
          <II.Download size={15} /> הורד הכל
        </button>
        {isBlueprint &&
          customApiConn &&
          results.some((r) => canUploadDrawing(r) && statuses[r.productId] === "approved") && (
            <button
              className="btn btn-ghost"
              disabled={publishing || uploadingIds.size > 0}
              onClick={async () => {
                const rows = results.filter(
                  (r) =>
                    statuses[r.productId] === "approved" && canUploadDrawing(r)
                );
                let ok = 0;
                for (const r of rows) {
                  if (await uploadDrawing(r, true)) ok += 1;
                }
                if (ok > 0) onToast?.(`${ok} שרטוטים הועלו לאתר`);
              }}
            >
              {uploadingIds.size > 0 ? (
                <>
                  <Spinner size={15} /> מעלה שרטוט…
                </>
              ) : (
                <>
                  <II.Upload size={15} /> העלה שרטוט לאתר
                </>
              )}
            </button>
          )}
        <button
          className="btn btn-primary lg"
          disabled={publishing || approved === 0}
          onClick={async () => {
            const approvedIds = Object.entries(statuses)
              .filter(([, s]) => s === "approved")
              .map(([id]) => Number(id));
            if (approvedIds.length === 0) return;
            setPublishing(true);
            try {
              if (isBlueprint) {
                for (const r of results.filter(
                  (row) =>
                    approvedIds.includes(row.productId) &&
                    row.isReal &&
                    !row.error
                )) {
                  await downloadFlattened(r);
                  await new Promise((res) => setTimeout(res, 120));
                }
              }
              await onPublish(approvedIds);
            } finally {
              setPublishing(false);
            }
          }}
          style={{
            opacity: publishing || approved === 0 ? 0.55 : 1,
            cursor:
              publishing || approved === 0 ? "not-allowed" : "pointer",
          }}
        >
          {publishing ? (
            <>
              <Spinner size={15} /> {isBlueprint ? "מוריד…" : "מפרסם…"}
            </>
          ) : isBlueprint || !connection ? (
            <>
              <II.Download size={15} /> הורד {approved} {isBlueprint ? "שרטוטים" : "תמונות"}
            </>
          ) : (
            <>
              {connection.platform === "shopify" ? (
                <II.Shopify size={15} />
              ) : (
                <II.Globe size={15} />
              )}{" "}
              פרסם {approved} ל-{platformLabel}
            </>
          )}
        </button>
      </BulkBar>

      {fixTarget && (
        <ProductFixModal
          target={fixTarget}
          extraCount={extraFixCount}
          onClose={() => setFixTarget(null)}
          onApply={applyProductFixToResults}
        />
      )}
      <ImageViewer
        image={viewerImage}
        initialMode="compare"
        onClose={() => setViewerImage(null)}
      />
      {editingId != null && layouts[editingId] && (
        <BlueprintEditorModal
          imageUrl={
            results.find((r) => r.productId === editingId)?.afterUrl ?? ""
          }
          layout={layouts[editingId]}
          productName={
            results.find((r) => r.productId === editingId)?.name ?? ""
          }
          onClose={() => setEditingId(null)}
          onSave={(next, imageUrl) => {
            setLayouts((prev) => ({ ...prev, [editingId]: next }));
            onLayoutChange?.(editingId, next, imageUrl);
          }}
          canUpload={results.some(
            (r) => r.productId === editingId && canUploadDrawing(r)
          )}
          uploading={uploadingIds.has(editingId)}
          uploaded={uploadedIds.has(editingId)}
          onUpload={async () => {
            const row = results.find((r) => r.productId === editingId);
            if (row) await uploadDrawing(row);
          }}
        />
      )}
    </>
  );
};

const Sum: React.FC<{ num: number; label: string; color: string }> = ({
  num,
  label,
  color,
}) => (
  <div>
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span
        className="serif mono"
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.03em",
        }}
      >
        {String(num).padStart(2, "0")}
      </span>
    </div>
  </div>
);

/* ============================================================
   HISTORY
   ============================================================ */

export const HistoryScreen: React.FC<{
  batches: HistoryBatch[];
  connection?: StoreConnection | null;
  storeProducts?: StoreBackedProduct[];
  onPublishComplete?: (publishedProductIds: Map<number, string>) => void;
  onToast?: (msg: string) => void;
  onBlueprintLayoutSave?: (
    itemId: string,
    layout: BlueprintLayout,
    imageUrl?: string
  ) => void;
}> = ({
  batches,
  connection = null,
  storeProducts = [],
  onPublishComplete,
  onToast,
  onBlueprintLayoutSave,
}) => {
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishTick, setPublishTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadingDrawingIds, setUploadingDrawingIds] = useState<Set<string>>(
    new Set()
  );
  const [uploadedDrawingIds, setUploadedDrawingIds] = useState<Set<string>>(
    new Set()
  );

  const customApiConn =
    connection?.platform === "custom-api" ? connection : null;

  const resolveDrawingProductId = (item: HistoryBatchItem) => {
    if (item.externalProductId) return item.externalProductId;
    const meta = getBatchItemMeta(item.id);
    if (meta?.externalProductId) return meta.externalProductId;
    const catalog = storeProducts.filter(isCustomApiProduct);
    if (item.productId != null) {
      const byId = catalog.find(
        (p) => stableProductId(p.externalId) === item.productId || p.id === item.productId
      );
      if (byId) return byId.externalId;
    }
    if (item.beforeUrl) {
      const normalized = item.beforeUrl.split("?")[0];
      const matched = catalog.find(
        (p) => p.imageUrl.split("?")[0] === normalized
      );
      if (matched) return matched.externalId;
    }
    const name = item.productName.trim().toLowerCase();
    if (name) {
      const byName = catalog.filter((p) => p.name.trim().toLowerCase() === name);
      if (byName.length === 1) return byName[0].externalId;
    }
    return undefined;
  };

  const canUploadHistoryDrawing = (batch: HistoryBatch, item: HistoryBatchItem) =>
    !!customApiConn &&
    batch.preset === "blueprint" &&
    item.status === "success" &&
    !!item.afterUrl;

  const uploadHistoryDrawing = async (item: HistoryBatchItem) => {
    if (!customApiConn || !item.afterUrl) return;
    const productId = resolveDrawingProductId(item);
    if (!productId) {
      onToast?.("לא נמצא מזהה מוצר להעלאת שרטוט");
      return;
    }
    setUploadingDrawingIds((prev) => new Set(prev).add(item.id));
    try {
      await uploadFlattenedDrawing(customApiConn, {
        productId,
        imageUrl: item.afterUrl,
        layout: item.blueprintLayout,
        filename: "drawing.png",
      });
      setUploadedDrawingIds((prev) => new Set(prev).add(item.id));
      onToast?.("השרטוט הועלה לאתר");
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : "העלאת השרטוט נכשלה"
      );
    } finally {
      setUploadingDrawingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const totalImages = useMemo(
    () =>
      batches.reduce(
        (sum, batch) => sum + (batch.items?.length ?? batch.count),
        0
      ),
    [batches]
  );

  const months = useMemo(() => {
    const groups = new Map<string, HistoryBatch[]>();
    for (const b of batches) {
      const key = fmtMonthYear(b.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    return Array.from(groups.entries()).map(([name, items]) => ({
      name,
      items,
    }));
  }, [batches]);

  const enrichedBatches = useMemo(
    () =>
      batches.map((batch) => ({
        ...batch,
        items: expandBatchItems(batch).map((item) =>
          enrichHistoryItem(
            item,
            connection,
            storeProducts,
            isItemPublished(item.id, item.afterUrl)
          )
        ),
      })),
    [batches, connection, storeProducts, publishTick]
  );

  const allItems = useMemo(
    () => enrichedBatches.flatMap((b) => b.items ?? []),
    [enrichedBatches]
  );

  const selectedItems = useMemo(
    () => allItems.filter((i) => selectedIds.has(i.id)),
    [allItems, selectedIds]
  );

  const toggleSelect = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectBatchUnpublished = (items: HistoryBatchItem[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (item.publishable && !item.published) next.add(item.id);
      }
      return next;
    });
  };

  const clearBatchSelection = (items: HistoryBatchItem[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.delete(item.id);
      return next;
    });
  };

  const handlePublishSelected = async () => {
    if (!connection || selectedItems.length === 0) return;
    setPublishing(true);
    try {
      const { ok, failed, publishedProductIds } = await publishHistoryItems(
        selectedItems,
        connection,
        storeProducts
      );
      setPublishTick((t) => t + 1);
      setSelectedIds(new Set());
      if (publishedProductIds.size > 0) {
        onPublishComplete?.(publishedProductIds);
      }
      const label = getConnectionPlatformLabel(connection);
      if (ok > 0 && failed === 0) {
        onToast?.(`${ok} תמונות פורסמו ל-${label} בהצלחה!`);
      } else if (ok > 0) {
        onToast?.(`${ok} פורסמו · ${failed} נכשלו`);
      } else {
        onToast?.(`כל הפרסומים נכשלו (${failed})`);
      }
    } finally {
      setPublishing(false);
    }
  };

  const editingItem = useMemo(() => {
    if (!editingId) return null;
    const direct = allItems.find((item) => item.id === editingId);
    if (direct) return direct;
    return (
      allItems.find(
        (item) =>
          item.productId != null &&
          editingId.endsWith(`-${item.productId}`) &&
          !!item.blueprintLayout
      ) ?? null
    );
  }, [allItems, editingId]);

  useEffect(() => {
    if (!editingId || !editingItem || editingItem.id === editingId) return;
    setEditingId(editingItem.id);
  }, [editingId, editingItem]);

  const canEditBlueprint = (batch: HistoryBatch, item: HistoryBatchItem) =>
    batch.preset === "blueprint" &&
    item.status === "success" &&
    !!item.afterUrl &&
    !!item.blueprintLayout;

  const openItem = (item: HistoryBatchItem, batch?: HistoryBatch) => {
    if (batch && canEditBlueprint(batch, item)) {
      setEditingId(item.id);
      return;
    }
    if (!item.afterUrl && !item.beforeUrl) return;
    setViewerImage({
      originalUrl: item.beforeUrl ?? item.afterUrl!,
      resultUrl: item.afterUrl,
      fileName: item.productName,
    });
  };

  const statusLabel = (b: HistoryBatch) => {
    if (b.status === "failed") return "נכשל";
    if (b.status === "partial") return "חלקי";
    return "הושלם";
  };

  const statusColor = (b: HistoryBatch) =>
    b.status === "failed" ? "#ff6b8b" : "var(--ok)";

  return (
    <>
      <section
        style={{
          paddingBottom: 36,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 48,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          03 · ארכיון
        </div>
        <h1 className="h-display">
          <span style={{ fontStyle: "italic", fontWeight: 500 }}>היסטוריה</span>
          .
        </h1>
        <p className="text-2" style={{ marginTop: 16, fontSize: 14 }}>
          {batches.length === 0
            ? "עוד לא רצו עיצובים. כשתעצב מוצרים — ההיסטוריה תופיע כאן."
            : connection
              ? `${batches.length} עיצובים · ${totalImages} תמונות. בחר תמונות שלא פורסמו ופרסם אותן לחנות.`
              : `${batches.length} עיצובים · ${totalImages} תמונות. חבר חנות כדי לפרסם מההיסטוריה.`}
        </p>
      </section>

      {batches.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--hair-2)",
            borderRadius: 14,
            padding: "64px 28px",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 14, opacity: 0.6 }}>✦</div>
          <div style={{ marginBottom: 6, color: "var(--ink-2)", fontSize: 15 }}>
            אין עדיין היסטוריה
          </div>
          <div>
            בחר מוצרים במסך &quot;מוצרים&quot;, לחץ &quot;עצב תמונות&quot;, ואז
            העיצוב הראשון יופיע כאן.
          </div>
        </div>
      ) : (
        months.map((month) => (
          <section key={month.name} className="section">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 20,
                marginBottom: 28,
              }}
            >
              <h2
                className="h-1"
                style={{ fontStyle: "italic", fontWeight: 500 }}
              >
                {month.name}
              </h2>
              <div style={{ flex: 1, height: 1, background: "var(--hair)" }} />
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                {month.items.length} עיצובים
              </span>
            </div>

            {month.items.map((b, i) => {
              const preset = PRESETS.find((p) => p.id === b.preset);
              const enriched = enrichedBatches.find((eb) => eb.id === b.id);
              const batchItems = enriched?.items ?? [];

              const unpublishedCount = batchItems.filter(
                (item) => item.publishable && !item.published
              ).length;
              const batchSelectedCount = batchItems.filter((item) =>
                selectedIds.has(item.id)
              ).length;

              return (
                <div
                  key={b.id}
                  style={{
                    padding: "24px 0",
                    borderTop: i === 0 ? "1px solid var(--hair)" : "0",
                    borderBottom: "1px solid var(--hair)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "50px 80px 1fr auto auto auto",
                      gap: 24,
                      alignItems: "center",
                      marginBottom: batchItems.length > 0 ? 20 : 0,
                    }}
                  >
                    <span
                      className="serif mono"
                      style={{
                        fontSize: 26,
                        color: "var(--ink-3)",
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 10,
                        background: b.previewUrl
                          ? `url(${b.previewUrl}) center/cover`
                          : preset?.gradient,
                        position: "relative",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          bottom: -8,
                          insetInlineEnd: -8,
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: "var(--bg-paper)",
                          border: "2px solid var(--bg)",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        className="mono"
                      >
                        {b.count}
                      </span>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 500,
                          marginBottom: 4,
                        }}
                      >
                        {b.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--ink-3)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        סגנון {preset?.name ?? b.preset}{" "}
                        <span className="aster">·</span>{" "}
                        <span className="mono">{b.successful}</span> הצליחו
                        {b.failed > 0 && (
                          <>
                            {" "}
                            <span className="aster">·</span>{" "}
                            <span className="mono">{b.failed}</span> נכשלו
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      {fmtRelativeTime(b.createdAt)}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: statusColor(b),
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: statusColor(b),
                        }}
                      />
                      {statusLabel(b)}
                    </span>
                    {connection && unpublishedCount > 0 ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ height: 34, fontSize: 12, padding: "0 12px" }}
                          onClick={() => selectBatchUnpublished(batchItems)}
                        >
                          בחר הכל ({unpublishedCount})
                        </button>
                        {batchSelectedCount > 0 ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              height: 34,
                              fontSize: 12,
                              padding: "0 12px",
                              color: "var(--ink-3)",
                            }}
                            onClick={() => clearBatchSelection(batchItems)}
                          >
                            בטל ({batchSelectedCount})
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {batchItems.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(120px, 1fr))",
                        gap: 14,
                        paddingInlineStart: 74,
                      }}
                    >
                      {batchItems.map((item) => {
                        const thumb = item.afterUrl ?? item.beforeUrl;
                        const clickable = !!thumb;
                        const isSelected = selectedIds.has(item.id);
                        const canSelect = item.publishable && !item.published;
                        return (
                          <div
                            key={item.id}
                            style={{
                              border: `1px solid ${
                                isSelected
                                  ? "rgba(176,64,224,.55)"
                                  : "var(--hair-2)"
                              }`,
                              borderRadius: 12,
                              overflow: "hidden",
                              background: "var(--bg-card)",
                              boxShadow: isSelected
                                ? "0 0 0 2px rgba(176,64,224,.2)"
                                : undefined,
                              opacity:
                                item.status === "failed"
                                  ? 0.72
                                  : item.published
                                    ? 0.82
                                    : 1,
                            }}
                          >
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                disabled={!clickable}
                                onClick={() => openItem(item, b)}
                                title={
                                  item.error
                                    ? item.error
                                    : canEditBlueprint(b, item)
                                      ? "לחץ לעריכת המידות"
                                      : clickable
                                        ? "לחץ להגדלה והשוואה"
                                        : undefined
                                }
                                style={{
                                  display: "block",
                                  width: "100%",
                                  padding: 0,
                                  border: 0,
                                  background: "transparent",
                                  cursor: clickable ? "pointer" : "default",
                                }}
                              >
                                <div
                                  style={{
                                    aspectRatio: "1 / 1",
                                    background: thumb
                                      ? `url(${thumb}) center/cover`
                                      : preset?.gradient,
                                  }}
                                />
                              </button>
                              {canEditBlueprint(b, item) ? (
                                <span
                                  style={{
                                    position: "absolute",
                                    bottom: 8,
                                    insetInlineStart: 8,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    letterSpacing: "0.08em",
                                    background: "rgba(6,3,10,.78)",
                                    color: "#fff",
                                    padding: "4px 7px",
                                    borderRadius: 6,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <II.Ruler size={10} /> ערוך
                                </span>
                              ) : null}
                              {item.published ? (
                                <span
                                  style={{
                                    position: "absolute",
                                    top: 8,
                                    insetInlineStart: 8,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    background: "rgba(37,211,150,.92)",
                                    color: "#fff",
                                    padding: "4px 7px",
                                    borderRadius: 6,
                                  }}
                                >
                                  פורסם
                                </span>
                              ) : canSelect ? (
                                <button
                                  type="button"
                                  onClick={() => toggleSelect(item.id)}
                                  aria-pressed={isSelected}
                                  style={{
                                    position: "absolute",
                                    top: 8,
                                    insetInlineEnd: 8,
                                    width: 26,
                                    height: 26,
                                    borderRadius: 7,
                                    border: isSelected
                                      ? "0"
                                      : "2px solid rgba(255,255,255,.85)",
                                    background: isSelected
                                      ? "var(--grad)"
                                      : "rgba(0,0,0,.35)",
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    boxShadow: "0 2px 8px rgba(0,0,0,.25)",
                                  }}
                                >
                                  {isSelected ? (
                                    <II.Check size={14} strokeWidth={3} />
                                  ) : null}
                                </button>
                              ) : null}
                            </div>
                            <div style={{ padding: "8px 10px" }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--ink-2)",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {item.productName}
                              </div>
                              {canEditBlueprint(b, item) ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => setEditingId(item.id)}
                                  style={{
                                    width: "100%",
                                    height: 32,
                                    marginTop: 8,
                                    fontSize: 11,
                                  }}
                                >
                                  <II.Ruler size={12} /> ערוך מידות
                                </button>
                              ) : null}
                              {canUploadHistoryDrawing(b, item) ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={uploadingDrawingIds.has(item.id)}
                                  onClick={() => void uploadHistoryDrawing(item)}
                                  style={{
                                    width: "100%",
                                    height: 32,
                                    marginTop: 8,
                                    fontSize: 11,
                                    color: uploadedDrawingIds.has(item.id)
                                      ? "var(--ok)"
                                      : undefined,
                                  }}
                                >
                                  {uploadingDrawingIds.has(item.id) ? (
                                    <>
                                      <Spinner size={12} /> מעלה…
                                    </>
                                  ) : uploadedDrawingIds.has(item.id) ? (
                                    <>
                                      <II.Check size={12} /> הועלה לאתר
                                    </>
                                  ) : (
                                    <>
                                      <II.Upload size={12} /> העלה שרטוט לאתר
                                    </>
                                  )}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}

      {connection && selectedItems.length > 0 && (
        <BulkBar>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              width: "100%",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              <span className="mono" style={{ fontWeight: 700 }}>
                {selectedItems.length}
              </span>{" "}
              תמונות נבחרו לפרסום
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={publishing}
                onClick={() => setSelectedIds(new Set())}
              >
                בטל בחירה
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={publishing}
                onClick={() => void handlePublishSelected()}
                style={{ opacity: publishing ? 0.6 : 1 }}
              >
                {publishing ? (
                  <>
                    <Spinner size={15} /> מפרסם…
                  </>
                ) : (
                  <>
                    {connection.platform === "shopify" ? (
                      <II.Shopify size={15} />
                    ) : (
                      <II.Globe size={15} />
                    )}{" "}
                    פרסם {selectedItems.length} ל-
                    {getConnectionPlatformLabel(connection)}
                  </>
                )}
              </button>
            </div>
          </div>
        </BulkBar>
      )}

      <ImageViewer
        image={viewerImage}
        initialMode="compare"
        onClose={() => setViewerImage(null)}
      />
      {editingItem?.afterUrl && editingItem.blueprintLayout && (
        <BlueprintEditorModal
          imageUrl={editingItem.afterUrl}
          layout={editingItem.blueprintLayout}
          productName={editingItem.productName}
          onClose={() => setEditingId(null)}
          onSave={(next, imageUrl) =>
            onBlueprintLayoutSave?.(editingItem.id, next, imageUrl)
          }
          canUpload={!!customApiConn}
          uploading={uploadingDrawingIds.has(editingItem.id)}
          uploaded={uploadedDrawingIds.has(editingItem.id)}
          onUpload={() => uploadHistoryDrawing(editingItem)}
        />
      )}
    </>
  );
};

/* ============================================================
   SETTINGS
   ============================================================ */

export const SettingsScreen: React.FC<{
  onLogout: () => void;
  userEmail?: string | null;
  connection: StoreConnection | null;
  onConnect: () => void;
  onDisconnect: () => void;
}> = ({ onLogout, userEmail, connection, onConnect, onDisconnect }) => {
  const sections = [
    { id: "store", name: "החנות שלי" },
    { id: "brand", name: "מיתוג" },
    { id: "billing", name: "חיוב" },
    { id: "team", name: "צוות" },
  ];
  const [tab, setTab] = useState("store");

  return (
    <>
      <section
        style={{
          paddingBottom: 36,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 48,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          04 · הגדרות
        </div>
        <h1 className="h-display">
          <span style={{ fontStyle: "italic", fontWeight: 500 }}>הגדרות</span>.
        </h1>
      </section>

      <div className="col-3" style={{ alignItems: "flex-start" }}>
        <aside>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            קטגוריה
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 0 }}
          >
            {sections.map((s, i) => (
              <div
                key={s.id}
                className={`tab-line ${tab === s.id ? "active" : ""}`}
                onClick={() => setTab(s.id)}
                style={{
                  padding: "14px 0",
                  borderBottom: "1px solid var(--hair)",
                  textAlign: "start",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{s.name}</span>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--ink-4)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 32,
              paddingTop: 20,
              borderTop: "1px solid var(--hair)",
            }}
          >
            {userEmail ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  marginBottom: 14,
                  lineHeight: 1.5,
                }}
              >
                מחובר כ{" "}
                <span dir="ltr" style={{ color: "var(--ink-2)" }}>
                  {userEmail}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onLogout}
              style={{
                width: "100%",
                justifyContent: "center",
                color: "#ff6b8b",
                borderColor: "rgba(255,107,139,.35)",
              }}
            >
              התנתק
            </button>
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {tab === "store" && (
            <StoreTab
              connection={connection}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
          )}
          {tab === "brand" && <BrandTab />}
          {tab === "billing" && <BillingTab />}
          {tab === "team" && <TeamTab />}
        </div>
      </div>
    </>
  );
};

const StoreTab: React.FC<{
  connection: StoreConnection | null;
  onConnect: () => void;
  onDisconnect: () => void;
}> = ({ connection, onConnect, onDisconnect }) => (
  <>
    <div>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        חיבור חנות
      </div>
      {connection ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "20px 0",
            borderTop: "1px solid var(--hair)",
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
              }}
            >
              {connection.platform === "shopify" ? (
                <II.Shopify size={40} />
              ) : (
                <II.Globe size={36} />
              )}
            </span>
            <div style={{ minWidth: 0, textAlign: "start" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                <span dir="ltr">
                  {getConnectionLabel(connection)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  columnGap: 10,
                  rowGap: 4,
                  marginTop: 4,
                }}
              >
                <span>
                  {getConnectionPlatformLabel(connection)}
                </span>
                {connection.platform === "shopify" && connection.shopName ? (
                  <>
                    <span className="aster" aria-hidden="true">
                      ·
                    </span>
                    <span dir="ltr">{connection.shop}</span>
                  </>
                ) : null}
                {connection.platform === "custom-api" ? (
                  <>
                    <span className="aster" aria-hidden="true">
                      ·
                    </span>
                    <span dir="ltr" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {connection.apiUrl}
                    </span>
                  </>
                ) : null}
                <span className="aster" aria-hidden="true">
                  ·
                </span>
                <span>מחובר</span>
                {connection.connectedAt ? (
                  <>
                    <span className="aster" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      חובר {fmtRelativeTime(new Date(connection.connectedAt))}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginInlineStart: "auto",
              flexShrink: 0,
            }}
          >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--ok)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--ok)",
              }}
            />
            פעיל
          </span>
          <button className="btn btn-ghost" onClick={onDisconnect}>
            נתק
          </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "28px 0",
            borderTop: "1px solid var(--hair)",
            borderBottom: "1px solid var(--hair)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "var(--ink-2)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            אין חנות Shopify מחוברת כרגע.
          </div>
          <button className="btn btn-primary" onClick={onConnect}>
            <II.Shopify size={15} /> חבר חנות
          </button>
        </div>
      )}
    </div>

    <div>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        סנכרון אוטומטי
      </div>
      <SettingRow
        label="סנכרן מוצרים חדשים"
        desc="בכל שעה"
        defaultOn={true}
      />
      <SettingRow
        label="התראת מוצרים חדשים"
        desc="במייל ובאפליקציה"
        defaultOn={true}
      />
      <SettingRow
        label="פרסום אוטומטי לאחר עיצוב"
        desc="ללא לחיצת אישור ידנית"
        defaultOn={false}
      />
    </div>
  </>
);

const BrandTab: React.FC = () => (
  <>
    <div>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        סגנון ברירת מחדל
      </div>
      <p className="text-2" style={{ fontSize: 13, marginBottom: 22 }}>
        הסגנון שיוצע ראשון בכל עיצוב חדש.
      </p>
      <div className="preset-grid">
        {PRESETS.slice(0, 4).map((preset, i) => (
          <div
            key={preset.id}
            className={`preset ${preset.id === "studio-white" ? "selected" : ""}${
              preset.comingSoon ? " coming-soon" : ""
            }`}
          >
            <div
              className="preset-thumb"
              style={{ background: preset.gradient }}
            />
            <div className="preset-meta">
              <div>
                <div className="preset-name">{preset.name}</div>
              </div>
              <span className="preset-num">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        סימן מים / לוגו
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: 20,
          borderRadius: 12,
          border: "1px dashed var(--hair-2)",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 10,
            background: "var(--bg-card)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
          }}
        >
          <II.Image size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}
          >
            העלה לוגו
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            PNG עם רקע שקוף <span className="aster">·</span> עד 2MB
          </div>
        </div>
        <button className="btn btn-ghost">
          <II.Upload size={14} /> בחר קובץ
        </button>
      </div>
    </div>
  </>
);

const BillingTab: React.FC = () => {
  const { data, loading, refresh } = useOpenAIBalance(true);
  const [sessionInput, setSessionInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const saveSession = async () => {
    setSaveMsg(null);
    setSaving(true);
    try {
      const res = await fetch("/api/openai/billing-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionInput.trim() }),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setSaveMsg(json.error || "שמירה נכשלה");
        return;
      }
      setSessionInput("");
      setSaveMsg("נשמר — מרענן יתרה…");
      await refresh();
    } catch {
      setSaveMsg("שגיאת רשת");
    } finally {
      setSaving(false);
    }
  };

  return (
  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
    <div
      style={{
        position: "relative",
        padding: 32,
        borderRadius: 16,
        border: "1px solid var(--hair-2)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -40,
          insetInlineEnd: -40,
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "var(--grad)",
          opacity: 0.15,
          filter: "blur(40px)",
        }}
      />
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        יתרה OpenAI
      </div>
      <h2 className="h-display" style={{ marginBottom: 14 }}>
        {loading ? (
          "…"
        ) : (
          <span
            className="grad-text"
            style={{ color: data?.lowBalance ? "#ff8a71" : undefined }}
          >
            {data?.formatted ?? "—"}
          </span>
        )}
      </h2>
      <p className="text-2" style={{ fontSize: 14, marginBottom: 16 }}>
        {data?.label ?? "יתרה OpenAI"}
        {data?.message ? (
          <>
            {" "}
            <span className="aster">·</span> {data.message}
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a
          className="btn btn-primary"
          href={
            data?.billingUrl ??
            "https://platform.openai.com/settings/organization/billing/overview"
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          פתח חיוב ב-OpenAI
        </a>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          רענן
        </button>
      </div>
    </div>

    <div
      style={{
        padding: 28,
        borderRadius: 16,
        border: "1px solid var(--hair-2)",
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        חיבור יתרה
      </div>
      <p className="text-2" style={{ fontSize: 13, lineHeight: 1.65, marginBottom: 16 }}>
        OpenAI לא מאפשרים לקרוא יתרה עם API key רגיל. הדבק כאן{" "}
        <strong>session key</strong> (מתחיל ב-{" "}
        <span dir="ltr" className="mono">
          sess-
        </span>
        ) מהדפדפן: פתח את{" "}
        <a
          href="https://platform.openai.com/settings/organization/billing/overview"
          target="_blank"
          rel="noopener noreferrer"
        >
          דף החיוב
        </a>
        , DevTools → Network → רענן → בקשה{" "}
        <span dir="ltr" className="mono">
          credit_grants
        </span>{" "}
        → העתק את ה-Bearer מה-Authorization. המפתח נשמר בחשבון שלך ב-Supabase.
      </p>
      <input
        className="input"
        dir="ltr"
        placeholder="sess-..."
        value={sessionInput}
        onChange={(e) => setSessionInput(e.target.value)}
        style={{ marginBottom: 12, fontFamily: "var(--font-mono)" }}
      />
      {saveMsg ? (
        <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>{saveMsg}</p>
      ) : null}
      <button
        type="button"
        className="btn btn-primary"
        disabled={saving || !sessionInput.trim()}
        onClick={() => void saveSession()}
      >
        {saving ? "שומר…" : "שמור session key"}
      </button>
      <p className="text-2" style={{ fontSize: 12, marginTop: 16 }}>
        אופציונלי בשרת:{" "}
        <span dir="ltr" className="mono">
          OPENAI_BILLING_SESSION_KEY
        </span>{" "}
        או{" "}
        <span dir="ltr" className="mono">
          OPENAI_ADMIN_API_KEY
        </span>{" "}
        (מציג רק הוצאה חודשית, לא יתרה).
      </p>
    </div>
  </div>
  );
};

const TeamTab: React.FC = () => (
  <div>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      <div className="eyebrow">חברי צוות</div>
      <button className="btn btn-primary">
        <II.Plus size={14} /> הזמן חבר
      </button>
    </div>
    <div className="text-2" style={{ fontSize: 13 }}>
      3 משתמשים פעילים
    </div>
  </div>
);

const SettingRow: React.FC<{
  label: string;
  desc: string;
  defaultOn: boolean;
}> = ({ label, desc, defaultOn }) => {
  const [on, setOn] = useState(defaultOn);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 0",
        borderTop: "1px solid var(--hair)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{desc}</div>
      </div>
      <button
        onClick={() => setOn((v) => !v)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          position: "relative",
          background: on ? "var(--grad)" : "var(--bg-card-hi)",
          transition: "background .2s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            [on ? "left" : "right"]: 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "white",
            transition: "all .2s",
          }}
        />
      </button>
    </div>
  );
};
