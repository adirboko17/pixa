"use client";

import React, { useEffect, useState } from "react";
import { Icons } from "./icons";
import { fmtDate } from "./data";
import {
  validateConnection,
  normalizeShopDomain,
} from "@/lib/shopify-client";
import { validateCustomApiConnection } from "@/lib/custom-api-client";
import {
  saveStoreConnection,
  type StoreConnection,
  type StorePlatform,
} from "@/lib/store-connection";
import { authErrorToHebrew, signInWithPassword } from "@/lib/supabase/auth";
import type { OpenAIBillingSnapshot } from "@/lib/openai-balance";
import { useOpenAIBalance } from "./use-openai-balance";

const I = Icons;

function OpenAIBalanceAmount({
  data,
  loading,
  size = "md",
}: {
  data: OpenAIBillingSnapshot | null;
  loading: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const fontSize = size === "lg" ? 38 : size === "sm" ? 15 : 18;
  if (loading) {
    return (
      <span className="mono" style={{ fontSize, color: "var(--ink-3)" }}>
        …
      </span>
    );
  }
  const display =
    data?.formatted ??
    (data?.kind === "unconfigured" ? "—" : data?.kind === "error" ? "!" : "—");
  return (
    <span
      className={size === "lg" ? "serif" : "credits-num grad-text"}
      style={{
        fontSize,
        fontWeight: size === "lg" ? 800 : 700,
        lineHeight: 1,
        letterSpacing: size === "lg" ? "-0.04em" : undefined,
        fontVariantNumeric: "tabular-nums",
        color: data?.lowBalance ? "#ff8a71" : undefined,
      }}
      title={data?.message}
    >
      {display}
    </span>
  );
}

function OpenAIBalanceLabel({ data }: { data: OpenAIBillingSnapshot | null }) {
  return <span>{data?.label ?? "יתרה OpenAI"}</span>;
}

/* ============================================================
   SIDEBAR
   ============================================================ */

export type NavId = "dashboard" | "products" | "history" | "settings";

export const Sidebar: React.FC<{
  current: NavId;
  onNav: (id: NavId) => void;
  storeName?: string;
  productsCount?: number;
  productsLoading?: boolean;
  historyCount?: number;
  billing?: OpenAIBillingSnapshot | null;
  billingLoading?: boolean;
}> = ({ current, onNav, storeName, productsCount, productsLoading, historyCount, billing, billingLoading }) => {
  const items: Array<{
    id: NavId;
    label: string;
    icon: (typeof I)[keyof typeof I];
    count?: number | "" | "loading";
  }> = [
    { id: "dashboard", label: "דשבורד", icon: I.Dashboard, count: "" },
    {
      id: "products",
      label: "מוצרים",
      icon: I.Box,
      count: productsLoading ? "loading" : typeof productsCount === "number" ? productsCount : "",
    },
    { id: "history", label: "היסטוריה", icon: I.History, count: historyCount ?? "" },
    { id: "settings", label: "הגדרות", icon: I.Settings, count: "" },
  ];
  return (
    <aside className="sidebar">
      <div
        className="brand"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}
      >
        <I.Wordmark height={28} />
        <div
          className="brand-store"
          style={{
            marginTop: 0,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {storeName || "חנות אורבני"}
        </div>
      </div>

      <div className="nav-label">ניווט</div>
      {items.map((it) => {
        const Ico = it.icon as React.FC<{ size?: number }>;
        return (
          <div
            key={it.id}
            className={`nav-item ${current === it.id ? "active" : ""}`}
            onClick={() => onNav(it.id)}
          >
            <Ico size={17} />
            <span>{it.label}</span>
            {it.count !== "" && (
              <span className="meta mono">
                {it.count === "loading" ? (
                  <Spinner size={11} />
                ) : (
                  (it.count as number)
                )}
              </span>
            )}
          </div>
        );
      })}

      <div className="nav-label">פעולות מהירות</div>
      <div className="nav-item" onClick={() => onNav("products")}>
        <I.Sparkles size={17} />
        <span>עיצוב חדש</span>
      </div>

      <div className="sidebar-card">
        <div style={{ position: "relative" }}>
          <div
            className="eyebrow-num"
            style={{ fontSize: 10, marginBottom: 6, color: "var(--cream)" }}
          >
            <OpenAIBalanceLabel data={billing ?? null} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <OpenAIBalanceAmount
              data={billing ?? null}
              loading={!!billingLoading}
              size="lg"
            />
          </div>
          <div
            style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 12 }}
          >
            {billing?.message ??
              (billing?.kind === "balance"
                ? "מתעדכן מ-OpenAI"
                : "הגדר session key בחיוב")}
          </div>
          <a
            className="btn btn-ghost"
            style={{ width: "100%", height: 32, fontSize: 12, textDecoration: "none" }}
            href={
              billing?.billingUrl ??
              "https://platform.openai.com/settings/organization/billing/overview"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            טען יתרה ב-OpenAI
          </a>
        </div>
      </div>
    </aside>
  );
};

/* ============================================================
   TOPBAR
   ============================================================ */

export const Topbar: React.FC<{
  onLogout: () => void;
  storeName?: string;
  billing?: OpenAIBillingSnapshot | null;
  billingLoading?: boolean;
}> = ({ onLogout, billing, billingLoading }) => {
  return (
    <div className="topbar">
      <div className="search">
        <span className="search-i">
          <I.Search size={14} />
        </span>
        <input placeholder="חפש מוצר, עיצוב או הגדרה" />
      </div>

      <div
        style={{
          marginInlineStart: "auto",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <span className="credits" title={billing?.message}>
          <OpenAIBalanceAmount
            data={billing ?? null}
            loading={!!billingLoading}
            size="sm"
          />
          <OpenAIBalanceLabel data={billing ?? null} />
        </span>
        <span
          style={{ width: 1, height: 18, background: "var(--hair-2)" }}
        />
        <button className="icon-btn" title="התראות">
          <I.Bell size={15} />
        </button>
        <button className="icon-btn" title="עזרה">
          <I.Help size={15} />
        </button>
        <div className="avatar" onClick={onLogout}>
          או
        </div>
      </div>
    </div>
  );
};

export const Layout: React.FC<{
  current: NavId;
  onNav: (id: NavId) => void;
  children: React.ReactNode;
  onLogout: () => void;
  storeName?: string;
  productsCount?: number;
  productsLoading?: boolean;
  historyCount?: number;
}> = ({
  current,
  onNav,
  children,
  onLogout,
  storeName,
  productsCount,
  productsLoading,
  historyCount,
}) => {
  const { data: billing, loading: billingLoading } = useOpenAIBalance(true);
  return (
  <div className="shell-grid">
    <Sidebar
      current={current}
      onNav={onNav}
      storeName={storeName}
      productsCount={productsCount}
      productsLoading={productsLoading}
      historyCount={historyCount}
      billing={billing}
      billingLoading={billingLoading}
    />
    <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Topbar
        onLogout={onLogout}
        storeName={storeName}
        billing={billing}
        billingLoading={billingLoading}
      />
      <div className="content anim-up">{children}</div>
    </main>
  </div>
  );
};

/* ============================================================
   LOGIN — magazine cover style
   ============================================================ */

export const LoginScreen: React.FC<{
  onLogin: (email: string) => void;
  onRegister: () => void;
}> = ({ onLogin, onRegister }) => {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    if (!email.trim() || !pw) {
      setError("נא למלא אימייל וסיסמה");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signInWithPassword({ email, password: pw });
      onLogin(email);
    } catch (err) {
      setError(authErrorToHebrew(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        zIndex: 2,
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr",
        alignItems: "stretch",
      }}
    >
      <section
        style={{
          padding: "56px 64px",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "20%",
            insetInlineEnd: "-20%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "var(--grad)",
            filter: "blur(120px)",
            opacity: 0.35,
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            marginBottom: "auto",
          }}
        >
          <I.Wordmark height={28} />
          <span className="topbar-meta">גיליון N°02 · {fmtDate()}</span>
        </div>

        <div style={{ position: "relative", maxWidth: 720, paddingTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 32 }}>
            גיליון מאי · מהדורה דיגיטלית
          </div>
          <h1 className="h-hero">
            תמונות מוצר
            <br />
            <span style={{ fontStyle: "italic", fontWeight: 500 }}>שמוכרות</span>
            <span className="grad-text">.</span>
          </h1>
          <p
            style={{
              marginTop: 32,
              marginBottom: 0,
              fontSize: 17,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              maxWidth: 480,
            }}
          >
            התחבר לחנות Shopify, בחר מוצרים, וקבל תמונות סטודיו מקצועיות — הכל
            באוטומט, ישר לאתר. בלי מצלמה, בלי תאורה, בלי תירוצים.
          </p>
        </div>

        <div
          style={{ marginTop: "auto", paddingTop: 56, position: "relative" }}
        >
          <hr className="hr-grad" style={{ marginBottom: 24 }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", gap: 36 }}>
              <Stat n="248" l="חנויות פעילות" />
              <Stat n="62K" l="תמונות נוצרו" />
              <Stat n="4.9" l="דירוג ממוצע" />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 11,
                color: "var(--ink-3)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              <span className="aster">✱</span>
              ב-AI גאה אנגלית-עברית
            </div>
          </div>
        </div>
      </section>

      <section
        style={{
          background: "var(--bg-paper)",
          borderInlineStart: "1px solid var(--hair)",
          padding: "56px 56px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            כניסה · חברי מערכת
          </div>
          <h2 className="h-display" style={{ marginBottom: 12 }}>
            ברוכים{" "}
            <span style={{ fontStyle: "italic", fontWeight: 500 }}>השבים</span>
          </h2>
          <p className="text-2" style={{ marginBottom: 36, fontSize: 14 }}>
            עוד עיצוב ממתין. שניות ממך.
          </p>

          <form
            onSubmit={submit}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <FormField label="אימייל">
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@store.co.il"
              />
            </FormField>
            <FormField label="סיסמה">
              <input
                className="input"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••••••"
              />
            </FormField>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 18,
                marginBottom: 24,
                fontSize: 12,
              }}
            >
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  defaultChecked
                  style={{ accentColor: "#B040E0" }}
                />
                זכור אותי במכשיר הזה
              </label>
              <a style={{ color: "var(--cream)" }}>שכחתי סיסמה</a>
            </div>

            {error && (
              <div
                style={{
                  background: "rgba(255,61,139,.08)",
                  border: "1px solid rgba(255,61,139,.4)",
                  color: "#ff8eb3",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 13,
                  marginBottom: 14,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary lg"
              style={{ width: "100%" }}
              disabled={loading}
            >
              {loading ? (
                <Spinner size={18} />
              ) : (
                <>
                  היכנס למערכת <I.ArrowLeft size={15} />
                </>
              )}
            </button>
          </form>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "24px 0",
              color: "var(--ink-3)",
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{ flex: 1, height: 1, background: "var(--hair)" }}
            />
            או
            <div
              style={{ flex: 1, height: 1, background: "var(--hair)" }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 46 }}
            >
              <I.Shopify size={16} /> Shopify
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 46 }}
            >
              <span style={{ fontWeight: 700 }}>G</span> Google
            </button>
          </div>

          <p
            style={{
              marginTop: 32,
              marginBottom: 0,
              fontSize: 12,
              color: "var(--ink-3)",
              textAlign: "center",
            }}
          >
            חדש כאן?{" "}
            <a
              style={{ color: "var(--cream)", fontWeight: 600 }}
              onClick={onRegister}
            >
              פתח חשבון בחינם →
            </a>
          </p>
        </div>
      </section>
    </div>
  );
};

export const FormField: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <label style={{ display: "block", position: "relative", paddingTop: 18 }}>
    <span
      style={{
        position: "absolute",
        top: 0,
        insetInlineStart: 0,
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    {children}
  </label>
);

const Stat: React.FC<{ n: string; l: string }> = ({ n, l }) => (
  <div>
    <div
      className="serif"
      style={{
        fontSize: 32,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {n}
    </div>
    <div
      style={{
        fontSize: 10.5,
        color: "var(--ink-3)",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginTop: 6,
      }}
    >
      {l}
    </div>
  </div>
);

export const Spinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <span
    style={{
      display: "inline-block",
      width: size,
      height: size,
      border: "2px solid rgba(255,255,255,.3)",
      borderTopColor: "white",
      borderRadius: "50%",
      animation: "spin .8s linear infinite",
    }}
  />
);

/* ============================================================
   CONNECT — Shopify + Lovable / Custom API
   ============================================================ */

export const ConnectScreen: React.FC<{
  onConnected: (conn: StoreConnection) => void;
  onSkip?: () => void;
}> = ({ onConnected, onSkip }) => {
  const [platform, setPlatform] = useState<StorePlatform>("shopify");
  const [store, setStore] = useState("");
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [stage, setStage] = useState<"input" | "connecting" | "success">(
    "input"
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string>("");

  const connect = async () => {
    setError(null);
    setStage("connecting");
    setProgress(8);

    let p = 8;
    const ticker = setInterval(() => {
      p = Math.min(90, p + Math.random() * 12 + 4);
      setProgress(p);
    }, 280);

    try {
      if (platform === "shopify") {
        const s = store.trim();
        const t = token.trim();
        if (!s || !t) {
          clearInterval(ticker);
          setError("חסר שם חנות או Access Token");
          setStage("input");
          return;
        }

        const res = await validateConnection(s, t);
        clearInterval(ticker);
        setProgress(100);

        const conn: StoreConnection = {
          platform: "shopify",
          shop: normalizeShopDomain(res.domain || s),
          token: t,
          shopName: res.shopName,
          connectedAt: Date.now(),
        };
        saveStoreConnection(conn);
        setConnectedName(res.shopName);
        setStage("success");
        setTimeout(() => onConnected(conn), 900);
        return;
      }

      const url = apiUrl.trim();
      const key = apiKey.trim();
      if (!url || !key) {
        clearInterval(ticker);
        setError("חסר כתובת API או API Key");
        setStage("input");
        return;
      }

      const res = await validateCustomApiConnection(url, key);
      clearInterval(ticker);
      setProgress(100);

      const conn: StoreConnection = {
        platform: "custom-api",
        apiUrl: url,
        apiKey: key,
        storeName: res.storeName,
        connectedAt: Date.now(),
      };
      saveStoreConnection(conn);
      setConnectedName(res.storeName);
      setStage("success");
      setTimeout(() => onConnected(conn), 900);
    } catch (e) {
      clearInterval(ticker);
      const msg = e instanceof Error ? e.message : "החיבור נכשל";
      setError(msg);
      setStage("input");
      setProgress(0);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        zIndex: 2,
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 580 }}>
        <div style={{ marginBottom: 56 }}>
          <I.Wordmark height={28} />
        </div>

        {stage === "input" && (
          <div className="anim-up">
            <div className="eyebrow" style={{ marginBottom: 24 }}>
              שלב 01 / 02 · חיבור חנות
            </div>
            <h1 className="h-display" style={{ marginBottom: 18 }}>
              חבר את החנות.
              <br />
              <span style={{ fontStyle: "italic", fontWeight: 500 }}>תוך</span>{" "}
              <span className="grad-text">30 שניות</span>.
            </h1>
            <p
              className="text-2"
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                marginBottom: 24,
                maxWidth: 460,
              }}
            >
              {platform === "shopify"
                ? "הזן את כתובת החנות שלך ואת ה-Access Token של אפליקציית ה-Admin בתוך Shopify. החיבור נשמר בחשבון שלך ויטען בכל התחברות."
                : "חבר אתר Lovable עם מוצרים ב-Supabase. הזן את כתובת ה-Edge Function ואת ה-API Key שיצרת בפרויקט."}
            </p>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 24,
                background: "var(--bg-card)",
                border: "1px solid var(--hair-2)",
                borderRadius: 12,
                padding: 4,
              }}
            >
              {(
                [
                  { id: "shopify" as const, label: "Shopify", icon: I.Shopify },
                  { id: "custom-api" as const, label: "Lovable / API", icon: I.Globe },
                ] as const
              ).map((tab) => {
                const TabIcon = tab.icon as React.FC<{ size?: number }>;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setPlatform(tab.id);
                      setError(null);
                      setShowHelp(false);
                    }}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      height: 44,
                      borderRadius: 8,
                      border: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                      background:
                        platform === tab.id ? "var(--grad)" : "transparent",
                      color: platform === tab.id ? "#fff" : "var(--ink-3)",
                      transition: "all .2s",
                    }}
                  >
                    <TabIcon size={16} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {platform === "shopify" ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    gap: 0,
                    background: "var(--bg-card)",
                    border: "1px solid var(--hair-2)",
                    borderRadius: 14,
                    paddingInlineEnd: 6,
                    marginBottom: 12,
                  }}
                >
                  <input
                    type="text"
                    value={store}
                    onChange={(e) => setStore(e.target.value)}
                    placeholder="my-store"
                    style={{
                      flex: 1,
                      height: 60,
                      background: "transparent",
                      border: 0,
                      outline: "none",
                      color: "var(--ink)",
                      fontSize: 17,
                      padding: "0 18px",
                      direction: "ltr",
                      textAlign: "left",
                      fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                      fontWeight: 600,
                    }}
                  />
                  <span
                    style={{
                      alignSelf: "center",
                      color: "var(--ink-3)",
                      fontSize: 14,
                      paddingInlineEnd: 14,
                      direction: "ltr",
                      fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                    }}
                  >
                    .myshopify.com
                  </span>
                </div>

                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--hair-2)",
                    borderRadius: 14,
                    marginBottom: 14,
                  }}
                >
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="shpat_••••••••••••••••••••••••"
                    style={{
                      width: "100%",
                      height: 60,
                      background: "transparent",
                      border: 0,
                      outline: "none",
                      color: "var(--ink)",
                      fontSize: 15,
                      padding: "0 18px",
                      direction: "ltr",
                      textAlign: "left",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 500,
                      letterSpacing: "0.05em",
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--hair-2)",
                    borderRadius: 14,
                    marginBottom: 12,
                  }}
                >
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="https://xxx.supabase.co/functions/v1/photospro-api"
                    style={{
                      width: "100%",
                      height: 60,
                      background: "transparent",
                      border: 0,
                      outline: "none",
                      color: "var(--ink)",
                      fontSize: 14,
                      padding: "0 18px",
                      direction: "ltr",
                      textAlign: "left",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 500,
                    }}
                  />
                </div>

                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--hair-2)",
                    borderRadius: 14,
                    marginBottom: 14,
                  }}
                >
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API Key (PHOTOSPRO_API_KEY)"
                    style={{
                      width: "100%",
                      height: 60,
                      background: "transparent",
                      border: 0,
                      outline: "none",
                      color: "var(--ink)",
                      fontSize: 15,
                      padding: "0 18px",
                      direction: "ltr",
                      textAlign: "left",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 500,
                      letterSpacing: "0.05em",
                    }}
                  />
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              style={{
                background: "none",
                border: 0,
                padding: 0,
                color: "var(--ink-3)",
                fontSize: 12,
                cursor: "pointer",
                marginBottom: 18,
                textDecoration: "underline",
                textUnderlineOffset: 4,
              }}
            >
              {platform === "shopify"
                ? `איפה משיגים את ה-Access Token? ${showHelp ? "▲" : "▼"}`
                : `איך מכינים את ה-API ב-Lovable? ${showHelp ? "▲" : "▼"}`}
            </button>
            {showHelp && platform === "shopify" && (
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--hair)",
                  borderRadius: 12,
                  padding: 16,
                  fontSize: 13,
                  color: "var(--ink-2)",
                  lineHeight: 1.7,
                  marginBottom: 18,
                }}
              >
                <ol
                  style={{
                    margin: 0,
                    paddingInlineStart: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <li>
                    בלוח הניהול של Shopify לך אל{" "}
                    <span className="mono">Settings → Apps and sales channels → Develop apps</span>
                  </li>
                  <li>
                    לחץ <b>Create an app</b>, תן לה שם (למשל "PhotosPro")
                  </li>
                  <li>
                    בלשונית <b>Configuration → Admin API access scopes</b>{" "}
                    סמן: <span className="mono">read_products</span> ו-
                    <span className="mono">write_products</span>
                  </li>
                  <li>
                    שמור, ואז בלשונית <b>API credentials</b> לחץ{" "}
                    <b>Install app</b> והעתק את ה-
                    <span className="mono">Admin API access token</span> (מתחיל
                    ב-<span className="mono">shpat_</span>)
                  </li>
                </ol>
              </div>
            )}
            {showHelp && platform === "custom-api" && (
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--hair)",
                  borderRadius: 12,
                  padding: 16,
                  fontSize: 13,
                  color: "var(--ink-2)",
                  lineHeight: 1.7,
                  marginBottom: 18,
                }}
              >
                <ol
                  style={{
                    margin: 0,
                    paddingInlineStart: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <li>
                    ב-Lovable, בקש מה-AI ליצור Edge Function בשם{" "}
                    <span className="mono">photospro-api</span>
                  </li>
                  <li>
                    ה-API צריך לתמוך ב-<span className="mono">GET /products</span>{" "}
                    ו-<span className="mono">PUT /products/:id/image</span>
                  </li>
                  <li>
                    ב-<span className="mono">Cloud → Secrets</span> הוסף{" "}
                    <span className="mono">PHOTOSPRO_API_KEY</span> (מפתח סודי)
                  </li>
                  <li>
                    העתק את כתובת ה-Function (למשל{" "}
                    <span className="mono">.../functions/v1/photospro-api</span>)
                  </li>
                  <li>הדבק כאן את הכתובת ואת ה-API Key שיצרת</li>
                </ol>
              </div>
            )}

            {error && (
              <div
                style={{
                  background: "rgba(255,61,139,.08)",
                  border: "1px solid rgba(255,61,139,.4)",
                  color: "#ff3d8b",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 13,
                  marginBottom: 18,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            <button
              className="btn btn-primary xl"
              onClick={connect}
              style={{ width: "100%" }}
            >
              {platform === "shopify" ? (
                <>
                  <I.Shopify size={18} /> חבר את חנות Shopify
                </>
              ) : (
                <>
                  <I.Globe size={18} /> חבר אתר Lovable / API
                </>
              )}
            </button>

            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                style={{
                  width: "100%",
                  marginTop: 14,
                  background: "none",
                  border: 0,
                  padding: "10px 0",
                  color: "var(--ink-3)",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <span>דלג בינתיים</span>
                <span style={{ color: "var(--ink-3)", opacity: 0.7 }}>·</span>
                <span style={{ color: "var(--ink-3)", opacity: 0.7 }}>
                  אפשר לחבר מאוחר יותר מהגדרות
                </span>
              </button>
            )}

            <hr className="hr" style={{ margin: "40px 0 24px" }} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 24,
              }}
            >
              <PromiseLine
                n="01"
                t="ללא נזק לתמונות"
                d="המקור נשמר בענן עד שתאשר בעצמך"
              />
              <PromiseLine
                n="02"
                t="חיבור לחשבון"
                d="פרטי החיבור נשמרים בחשבון שלך ב-Supabase ונגישים רק לך"
              />
            </div>
          </div>
        )}

        {stage === "connecting" && (
          <div
            className="anim-up"
            style={{ textAlign: "center", padding: "60px 0" }}
          >
            <ConnectingOrb />
            <div
              className="eyebrow"
              style={{ marginTop: 36, justifyContent: "center" }}
            >
              סנכרון פעיל
            </div>
            <h2 className="h-2" style={{ marginTop: 14, marginBottom: 6 }}>
              מתחבר לחנות שלך…
            </h2>
            <p
              className="text-3 mono"
              style={{ fontSize: 13, marginBottom: 32 }}
              dir="ltr"
            >
              {platform === "shopify"
                ? store.includes(".")
                  ? store
                  : `${store}.myshopify.com`
                : apiUrl || "API"}
            </p>
            <div style={{ maxWidth: 380, margin: "0 auto" }}>
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                <span>מאמת הרשאות</span>
                <span className="mono">{Math.round(progress)}%</span>
              </div>
            </div>
          </div>
        )}

        {stage === "success" && (
          <div
            className="anim-up"
            style={{ textAlign: "center", padding: "60px 0" }}
          >
            <div
              style={{
                width: 92,
                height: 92,
                margin: "0 auto",
                borderRadius: "50%",
                background: "var(--grad)",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 24px 60px -10px rgba(176,64,224,.55)",
              }}
            >
              <I.Check size={44} strokeWidth={2.5} />
            </div>
            <h2 className="h-2" style={{ marginTop: 28 }}>
              {connectedName ? `שלום, ${connectedName}` : "החנות מחוברת."}
            </h2>
            <p className="text-2">מעביר אותך לדשבורד…</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const PromiseLine: React.FC<{
  n: string;
  t: string;
  d: string;
}> = ({ n, t, d }) => (
  <div>
    <span
      className="eyebrow-num"
      style={{ marginBottom: 8, display: "block" }}
    >
      {n}
    </span>
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{t}</div>
    <div
      style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55 }}
    >
      {d}
    </div>
  </div>
);

const ConnectingOrb: React.FC = () => (
  <div
    style={{
      position: "relative",
      width: 140,
      height: 140,
      margin: "0 auto",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        background: "var(--grad)",
        filter: "blur(35px)",
        opacity: 0.5,
        animation: "pulse 1.8s ease-in-out infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 20,
        borderRadius: "50%",
        background: "var(--grad)",
        display: "grid",
        placeItems: "center",
        animation: "floaty 3s ease-in-out infinite",
      }}
    >
      <I.Sparkles size={36} strokeWidth={1.5} />
    </div>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          inset: -(i + 1) * 16,
          border: "1px solid var(--hair)",
          borderRadius: "50%",
          opacity: 0.5 - i * 0.15,
        }}
      />
    ))}
  </div>
);
