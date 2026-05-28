"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Icons } from "./icons";
import {
  authErrorToHebrew,
  signUpWithPassword,
} from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/client";

const IR = Icons;

const TOTAL_STEPS = 7;

/* ============================================================
   ANSWER OPTIONS — content definitions
   ============================================================ */

type IndustryOption = { id: string; label: string; icon: string; tone: string };
const INDUSTRY_OPTIONS: IndustryOption[] = [
  { id: "fashion", label: "אופנה ובגדים", icon: "👕", tone: "linear-gradient(135deg,#FFB6C7,#FF8A47)" },
  { id: "beauty", label: "יופי וקוסמטיקה", icon: "💄", tone: "linear-gradient(135deg,#FFC9DD,#B040E0)" },
  { id: "jewelry", label: "תכשיטים", icon: "💍", tone: "linear-gradient(135deg,#F0EDE8,#C8C1B5)" },
  { id: "home", label: "בית ועיצוב", icon: "🛋️", tone: "linear-gradient(135deg,#88C9A1,#3D4BFF)" },
  { id: "electronics", label: "אלקטרוניקה", icon: "📱", tone: "linear-gradient(135deg,#1a1a2e,#B040E0)" },
  { id: "food", label: "מזון ומשקאות", icon: "🍷", tone: "linear-gradient(135deg,#FFB36E,#FF6B6B)" },
  { id: "sport", label: "ספורט וכושר", icon: "🏃", tone: "linear-gradient(135deg,#3D4BFF,#88C9A1)" },
  { id: "other", label: "משהו אחר", icon: "✨", tone: "linear-gradient(135deg,#B040E0,#FF3D8B,#FF8A47)" },
];

type AudienceOption = { id: string; label: string; desc: string };
const AUDIENCE_OPTIONS: AudienceOption[] = [
  { id: "genz", label: "דור Z, 18-26", desc: "אורבני, Instagram, TikTok, ערך/אסתטיקה" },
  { id: "millennial", label: "מילניאלס, 27-40", desc: "מודעי-מותג, נאמני-לייפסטייל, רוכשים מקוון" },
  { id: "parents", label: "הורים צעירים", desc: "פרקטיים, נוחות, מומלצי-חברים" },
  { id: "pros", label: "אנשי מקצוע 30-50", desc: "יעילות, איכות, ערך לאורך זמן" },
  { id: "luxe", label: "קהל יוקרה", desc: "מודעי מותג, פרימיום, חוויה שלמה" },
  { id: "value", label: "מחפשי ערך", desc: "מחיר/תועלת, השוואות, מבצעים" },
  { id: "mature", label: "בוגרים 50+", desc: "אמינות, פשטות, שירות אנושי" },
  { id: "creators", label: "יוצרים ואומנים", desc: "אסתטיקה, ייחודיות, איכות חומרים" },
];

type VibeOption = {
  id: string;
  label: string;
  desc: string;
  preview: string;
  accent: string;
};
const VIBE_OPTIONS: VibeOption[] = [
  { id: "minimal", label: "מינימלי ונקי", desc: "הרבה אוויר, צבעים נייטרליים", preview: "linear-gradient(135deg,#FAFAFA,#E5E5E5)", accent: "#000" },
  { id: "lush", label: "תוסס וצבעוני", desc: "בולט, אנרגטי, סקרולי", preview: "linear-gradient(135deg,#FF3D8B,#FF8A47,#B040E0)", accent: "#fff" },
  { id: "editorial", label: "מגזיני יוקרה", desc: "סריף, רחב, מתואם", preview: "linear-gradient(135deg,#0A030F,#3A2E22)", accent: "#EBDCC0" },
  { id: "vintage", label: "וינטג׳ ופילם", desc: "גרעיני, חמים, נוסטלגי", preview: "linear-gradient(135deg,#D4A574,#8B5E3C)", accent: "#fff" },
  { id: "organic", label: "אורגני וטבעי", desc: "גוונים אדמתיים, רך", preview: "linear-gradient(135deg,#88C9A1,#D4C5A0)", accent: "#0A030F" },
  { id: "futuristic", label: "עתידני / טק", desc: "כחול עמוק, נאון, חד", preview: "linear-gradient(135deg,#0A0E2A,#3D4BFF,#25D396)", accent: "#fff" },
  { id: "playful", label: "שובב ופופ", desc: "גרפי, ילדותי, מצחיק", preview: "linear-gradient(135deg,#FFD93D,#FF6B6B,#4ECDC4)", accent: "#0A030F" },
  { id: "edgy", label: "דארק וקשוח", desc: "שחור עמוק, נועז", preview: "linear-gradient(135deg,#0A030F,#2A0A20)", accent: "#FF3D8B" },
];

type PriceOption = { id: string; label: string; range: string; desc: string };
const PRICE_OPTIONS: PriceOption[] = [
  { id: "budget", label: "תקציבי", range: "עד ₪150", desc: "נפח גבוה" },
  { id: "mid", label: "אמצע", range: "₪150-500", desc: "הקהל הרחב" },
  { id: "premium", label: "פרימיום", range: "₪500-2000", desc: "איכות לפני מחיר" },
  { id: "luxury", label: "יוקרה", range: "₪2000+", desc: "מותג, חוויה, סטטוס" },
];

type ChannelOption = { id: string; label: string; icon: string };
const CHANNEL_OPTIONS: ChannelOption[] = [
  { id: "instagram", label: "Instagram", icon: "IG" },
  { id: "tiktok", label: "TikTok", icon: "TT" },
  { id: "facebook", label: "Facebook", icon: "FB" },
  { id: "google", label: "Google", icon: "G" },
  { id: "youtube", label: "YouTube", icon: "YT" },
  { id: "word", label: "מפה לאוזן", icon: "✱" },
  { id: "newsletter", label: "דיוור", icon: "✉" },
  { id: "physical", label: "חנות פיזית", icon: "⌂" },
];

type RegisterData = {
  businessName: string;
  email: string;
  password: string;
  domain: string;
  country: string;
  years: string;
  industries: string[];
  audience: string[];
  vibe: string;
  price: string;
  channels: string[];
  catalog?: string;
};

export const RegisterScreen: React.FC<{
  onComplete: () => void;
  onLogin: () => void;
  onCancel: () => void;
  /**
   * "full" — full sign-up flow including email/password.
   * "brand-only" — user is already authenticated, only collect brand-avatar.
   */
  mode?: "full" | "brand-only";
  /** Pre-fill the business name (used in brand-only mode). */
  initialBusinessName?: string;
}> = ({ onComplete, onLogin, onCancel, mode = "full", initialBusinessName = "" }) => {
  const isBrandOnly = mode === "brand-only";
  // In brand-only mode the user already has an account, so we skip step 0.
  const [step, setStep] = useState(isBrandOnly ? 1 : 0);
  const isFirstStep = step === (isBrandOnly ? 1 : 0);
  const [data, setData] = useState<RegisterData>({
    businessName: initialBusinessName,
    email: "",
    password: "",
    domain: "",
    country: "IL",
    years: "1-3 שנים",
    industries: [],
    audience: [],
    vibe: "",
    price: "",
    channels: [],
  });

  const update = <K extends keyof RegisterData>(k: K, v: RegisterData[K]) =>
    setData((prev) => ({ ...prev, [k]: v }));
  const toggleArr = (k: "industries" | "audience" | "channels", v: string) =>
    setData((prev) => ({
      ...prev,
      [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v],
    }));

  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  /**
   * Save the brand avatar row for the signed-in user. Idempotent via upsert on user_id.
   */
  const saveBrandAvatar = async () => {
    const supabase = createClient();
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase
      .from("brand_avatars")
      .upsert(
        {
          user_id: userId,
          domain: data.domain || null,
          industries: data.industries,
          audience: data.audience,
          vibe: data.vibe || null,
          price: data.price || null,
          channels: data.channels,
        },
        { onConflict: "user_id" }
      );
  };

  const next = async () => {
    setAuthError(null);

    // Step 0 → step 1: create the Supabase account first.
    if (step === 0) {
      setSubmitting(true);
      try {
        const res = await signUpWithPassword({
          email: data.email,
          password: data.password,
          businessName: data.businessName,
        });
        if (res.alreadyRegistered) {
          setAuthError(
            "המייל הזה כבר רשום במערכת. עבור למסך הכניסה כדי להתחבר."
          );
          return;
        }
        if (res.needsEmailConfirmation) {
          setPendingEmail(data.email);
          return;
        }
      } catch (err) {
        setAuthError(authErrorToHebrew(err));
        return;
      } finally {
        setSubmitting(false);
      }
    }

    // Step 5 → step 6: persist the brand avatar before the "building" animation.
    if (step === 5) {
      setSubmitting(true);
      try {
        await saveBrandAvatar();
      } catch (err) {
        // Non-fatal — the wizard can still complete. Just log it for now.
        console.error("[register] saveBrandAvatar failed", err);
      } finally {
        setSubmitting(false);
      }
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS + 1));
  };
  const back = () =>
    setStep((s) => Math.max(s - 1, isBrandOnly ? 1 : 0));

  const canContinue = useMemo(() => {
    if (submitting) return false;
    if (step === 0)
      return !!(data.businessName && data.email && data.password.length >= 6);
    if (step === 1) return !!data.domain;
    if (step === 2) return data.industries.length > 0;
    if (step === 3) return data.audience.length > 0;
    if (step === 4) return !!data.vibe;
    if (step === 5) return !!data.price && data.channels.length > 0;
    return true;
  }, [step, data, submitting]);

  return (
    <div
      style={{
        position: "relative",
        zIndex: 2,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "28px 56px",
          borderBottom: "1px solid var(--hair)",
          position: "sticky",
          top: 0,
          background: "rgba(6,3,10,.7)",
          backdropFilter: "blur(20px)",
          zIndex: 10,
        }}
      >
        <IR.Wordmark height={28} />

        {step <= 5 && <Stepper current={step} mode={mode} />}

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            className="topbar-meta"
            style={{ display: step <= 5 ? "inline" : "none" }}
          >
            שלב {String(isBrandOnly ? step : step + 1).padStart(2, "0")} /{" "}
            {String(isBrandOnly ? TOTAL_STEPS - 1 : TOTAL_STEPS).padStart(
              2,
              "0"
            )}
          </span>
          {!isBrandOnly ? (
            <a
              className="btn-line"
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
              }}
              onClick={onLogin}
            >
              כבר רשום?{" "}
              <strong style={{ color: "var(--cream)" }}>היכנס</strong>
            </a>
          ) : (
            <a
              className="btn-line"
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
              }}
              onClick={onCancel}
            >
              ביטול{" "}
              <strong style={{ color: "var(--cream)" }}>והתחברות</strong>
            </a>
          )}
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "64px 56px 40px",
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
        }}
        key={step}
      >
        <div className="anim-up" style={{ flex: 1 }}>
          {step === 0 && <AccountStep data={data} update={update} />}
          {step === 1 && <BusinessStep data={data} update={update} />}
          {step === 2 && <IndustriesStep data={data} toggle={toggleArr} />}
          {step === 3 && <AudienceStep data={data} toggle={toggleArr} />}
          {step === 4 && <VibeStep data={data} update={update} />}
          {step === 5 && (
            <PricingChannelsStep
              data={data}
              update={update}
              toggle={toggleArr}
            />
          )}
          {step === 6 && <BuildingStep onDone={next} />}
          {step === 7 && <RevealStep data={data} onComplete={onComplete} />}
        </div>

        {step === 0 && authError && (
          <div
            style={{
              background: "rgba(255,61,139,.08)",
              border: "1px solid rgba(255,61,139,.4)",
              color: "#ff8eb3",
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13,
              marginTop: 24,
              lineHeight: 1.5,
            }}
          >
            {authError}
          </div>
        )}

        {step <= 5 && (
          <footer
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 56,
              paddingTop: 24,
              borderTop: "1px solid var(--hair)",
            }}
          >
            <button
              className="btn btn-ghost"
              onClick={isFirstStep ? onCancel : back}
              disabled={submitting}
            >
              {isFirstStep ? (
                <>
                  חזור להתחברות <IR.ArrowRight size={14} />
                </>
              ) : (
                <>
                  <IR.ArrowRight size={14} /> חזור
                </>
              )}
            </button>

            <span className="topbar-meta">
              {isBrandOnly ? step : step + 1} מתוך{" "}
              {isBrandOnly ? TOTAL_STEPS - 1 : TOTAL_STEPS}
            </span>

            <button
              className="btn btn-primary lg"
              onClick={next}
              disabled={!canContinue}
              style={{
                opacity: canContinue ? 1 : 0.4,
                pointerEvents: canContinue ? "auto" : "none",
                minWidth: 220,
              }}
            >
              {submitting ? (
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    border: "2px solid rgba(255,255,255,.3)",
                    borderTopColor: "white",
                    borderRadius: "50%",
                    animation: "spin .8s linear infinite",
                  }}
                />
              ) : (
                <>
                  {step === 5 ? "בנה לי Brand Avatar" : "המשך"}{" "}
                  <IR.ArrowLeft size={15} />
                </>
              )}
            </button>
          </footer>
        )}
      </div>

      {pendingEmail && (
        <ConfirmEmailOverlay
          email={pendingEmail}
          onDismiss={() => setPendingEmail(null)}
          onGoLogin={onLogin}
        />
      )}
    </div>
  );
};

const ConfirmEmailOverlay: React.FC<{
  email: string;
  onDismiss: () => void;
  onGoLogin: () => void;
}> = ({ email, onDismiss, onGoLogin }) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(6,3,10,.92)",
      backdropFilter: "blur(20px)",
      display: "grid",
      placeItems: "center",
      zIndex: 100,
      padding: 24,
    }}
    onClick={onDismiss}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--hair-2)",
        borderRadius: 16,
        padding: "40px 36px",
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          margin: "0 auto 24px",
          borderRadius: "50%",
          background: "var(--grad)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <IR.Bell size={32} strokeWidth={1.8} />
      </div>
      <h2 className="h-2" style={{ marginBottom: 12 }}>
        אומת את האימייל שלך
      </h2>
      <p className="text-2" style={{ fontSize: 14, lineHeight: 1.6 }}>
        שלחנו קישור אישור ל-
        <strong style={{ color: "var(--cream)" }} dir="ltr">
          {email}
        </strong>
        . לחץ עליו ואז חזור לכאן כדי להמשיך.
      </p>
      <div
        style={{
          marginTop: 28,
          display: "flex",
          gap: 10,
          justifyContent: "center",
        }}
      >
        <button className="btn btn-ghost" onClick={onDismiss}>
          סגור
        </button>
        <button className="btn btn-primary" onClick={onGoLogin}>
          עבור לכניסה <IR.ArrowLeft size={14} />
        </button>
      </div>
    </div>
  </div>
);

const Stepper: React.FC<{ current: number; mode?: "full" | "brand-only" }> = ({
  current,
  mode = "full",
}) => {
  // Hide the account-step dot when the wizard skips it.
  const length = mode === "brand-only" ? TOTAL_STEPS - 1 : TOTAL_STEPS;
  const offset = mode === "brand-only" ? 1 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length }).map((_, i) => {
        const stepIndex = i + offset;
        return (
          <span
            key={i}
            style={{
              width: stepIndex === current ? 24 : 8,
              height: 4,
              borderRadius: 999,
              background:
                stepIndex <= current ? "var(--cream)" : "var(--hair-2)",
              transition: "all .3s var(--ease)",
            }}
          />
        );
      })}
    </div>
  );
};

/* ============================================================
   STEPS
   ============================================================ */

const AccountStep: React.FC<{
  data: RegisterData;
  update: <K extends keyof RegisterData>(k: K, v: RegisterData[K]) => void;
}> = ({ data, update }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr",
      gap: 80,
      alignItems: "center",
      maxWidth: 1100,
      margin: "0 auto",
    }}
  >
    <div>
      <div className="eyebrow" style={{ marginBottom: 24 }}>
        01 / 07 · חשבון חדש
      </div>
      <h1 className="h-display">
        בואו
        <br />
        <span style={{ fontStyle: "italic", fontWeight: 500 }}>נכיר</span>
        <span className="grad-text">.</span>
      </h1>
      <p
        className="text-2"
        style={{
          marginTop: 24,
          fontSize: 17,
          lineHeight: 1.55,
          maxWidth: 440,
        }}
      >
        עוד דקה והפרופיל החכם של העסק שלך יהיה מוכן. אנחנו לומדים את המותג שלך
        כדי שכל תמונה תתאים לקהל שלך — אוטומטית.
      </p>
      <div style={{ display: "flex", gap: 40, marginTop: 48 }}>
        <Spec n="3" l="דקות" />
        <Spec n="06" l="שאלות" />
        <Spec n="∞" l="קרדיטים-לא-נגמרים" />
      </div>
    </div>

    <form
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
      onSubmit={(e) => e.preventDefault()}
    >
      <FormBlock label="שם העסק">
        <input
          className="input input-block"
          value={data.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          placeholder="למשל: אורבני"
        />
      </FormBlock>
      <FormBlock label="אימייל">
        <input
          className="input input-block"
          type="email"
          autoComplete="email"
          value={data.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="you@store.co.il"
        />
      </FormBlock>
      <FormBlock label="סיסמה (לפחות 6 תווים)">
        <input
          className="input input-block"
          type="password"
          value={data.password}
          onChange={(e) => update("password", e.target.value)}
          placeholder="••••••••"
        />
      </FormBlock>

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
        <div style={{ flex: 1, height: 1, background: "var(--hair)" }} />
        או הירשם מהר עם
        <div style={{ flex: 1, height: 1, background: "var(--hair)" }} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <button type="button" className="btn btn-ghost" style={{ height: 50 }}>
          <IR.Shopify size={16} /> Shopify
        </button>
        <button type="button" className="btn btn-ghost" style={{ height: 50 }}>
          <span style={{ fontWeight: 700 }}>G</span> Google
        </button>
      </div>
    </form>
  </div>
);

const FormBlock: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label
    style={{
      display: "block",
      position: "relative",
      paddingTop: 22,
      marginBottom: 8,
    }}
  >
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

const Spec: React.FC<{ n: string; l: string }> = ({ n, l }) => (
  <div>
    <div
      className="serif"
      style={{
        fontSize: 36,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: "-0.03em",
      }}
    >
      {n}
    </div>
    <div
      style={{
        fontSize: 10.5,
        color: "var(--ink-3)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        marginTop: 6,
      }}
    >
      {l}
    </div>
  </div>
);

const BusinessStep: React.FC<{
  data: RegisterData;
  update: <K extends keyof RegisterData>(k: K, v: RegisterData[K]) => void;
}> = ({ data, update }) => (
  <div style={{ maxWidth: 760, margin: "0 auto" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>
      02 / 07 · פרטי העסק
    </div>
    <h1 className="h-display" style={{ marginBottom: 16 }}>
      ספר לנו על
      <br />
      <span style={{ fontStyle: "italic", fontWeight: 500 }}>העסק</span> שלך
      <span className="grad-text">.</span>
    </h1>
    <p
      className="text-2"
      style={{ fontSize: 16, marginBottom: 48, maxWidth: 540 }}
    >
      המידע הזה עוזר ל-AI להבין את ההקשר. הוא לא יפורסם בשום מקום ולא נשלח לאף
      אחד.
    </p>

    <div
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
    >
      <FormBlock label="דומיין החנות / אתר">
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            background: "var(--bg-card)",
            border: "1px solid var(--hair-2)",
            borderRadius: 12,
            paddingInlineEnd: 12,
            height: 50,
          }}
        >
          <input
            className="input"
            value={data.domain}
            onChange={(e) => update("domain", e.target.value)}
            placeholder="urbany-store"
            style={{
              flex: 1,
              height: "100%",
              background: "transparent",
              borderBottom: 0,
              paddingInline: 16,
              direction: "ltr",
              textAlign: "left",
            }}
          />
          <span
            style={{
              alignSelf: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              direction: "ltr",
            }}
          >
            .com
          </span>
        </div>
      </FormBlock>
      <FormBlock label="מדינת פעילות עיקרית">
        <SelectField
          value={data.country}
          onChange={(v) => update("country", v)}
          options={[
            { v: "IL", l: "ישראל" },
            { v: "US", l: "ארה״ב" },
            { v: "EU", l: "אירופה" },
            { v: "UK", l: "בריטניה" },
            { v: "GLOBAL", l: "גלובלי" },
          ]}
        />
      </FormBlock>

      <FormBlock label="כמה זמן העסק פעיל?">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          {["חדש", "1-3 שנים", "3-7 שנים", "7+ שנים"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => update("years", opt)}
              style={{
                height: 50,
                borderRadius: 12,
                border: "1px solid",
                borderColor:
                  data.years === opt ? "var(--cream)" : "var(--hair-2)",
                background:
                  data.years === opt ? "var(--bg-card-2)" : "var(--bg-card)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 500,
                transition: "all .15s",
                cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </FormBlock>

      <FormBlock label="מספר מוצרים בקטלוג">
        <SelectField
          value={data.catalog || "100-500"}
          onChange={(v) => update("catalog", v)}
          options={[
            { v: "0-100", l: "עד 100" },
            { v: "100-500", l: "100-500" },
            { v: "500-2000", l: "500-2,000" },
            { v: "2000+", l: "2,000+" },
          ]}
        />
      </FormBlock>
    </div>
  </div>
);

const SelectField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}> = ({ value, onChange, options }) => (
  <div style={{ position: "relative" }}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 50,
        padding: "0 40px 0 16px",
        background: "var(--bg-card)",
        border: "1px solid var(--hair-2)",
        borderRadius: 12,
        color: "var(--ink)",
        fontSize: 14,
        outline: "none",
        appearance: "none",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v} style={{ background: "#0A070E" }}>
          {o.l}
        </option>
      ))}
    </select>
    <span
      style={{
        position: "absolute",
        insetInlineStart: 14,
        top: "50%",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        color: "var(--ink-3)",
      }}
    >
      <IR.ChevronDown size={16} />
    </span>
  </div>
);

const IndustriesStep: React.FC<{
  data: RegisterData;
  toggle: (k: "industries" | "audience" | "channels", v: string) => void;
}> = ({ data, toggle }) => (
  <div style={{ maxWidth: 1000, margin: "0 auto" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>
      03 / 07 · תעשיות
    </div>
    <h1 className="h-display" style={{ marginBottom: 16 }}>
      מה אתה
      <br />
      <span style={{ fontStyle: "italic", fontWeight: 500 }}>מוכר</span>
      <span className="grad-text">?</span>
    </h1>
    <p
      className="text-2"
      style={{ fontSize: 16, marginBottom: 48, maxWidth: 540 }}
    >
      בחר עד 3 קטגוריות עיקריות. ה-AI ילמד את הקטגוריות העמוקות בהמשך מתוך
      הקטלוג עצמו.
    </p>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
      }}
    >
      {INDUSTRY_OPTIONS.map((opt, i) => {
        const selected = data.industries.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle("industries", opt.id)}
            style={{
              position: "relative",
              padding: 0,
              aspectRatio: "1/1",
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid",
              borderColor: selected ? "var(--cream)" : "var(--hair-2)",
              background: "var(--bg-card)",
              cursor: "pointer",
              transition: "all .2s",
              transform: selected ? "scale(.98)" : "scale(1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: opt.tone,
                opacity: selected ? 0.45 : 0.18,
                transition: "opacity .2s",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: 18,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "0.18em",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ textAlign: "start" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>{opt.icon}</div>
                <div
                  style={{
                    fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                    fontWeight: 700,
                    fontSize: 20,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {opt.label}
                </div>
              </div>
            </div>
            {selected && <CornerMarks />}
          </button>
        );
      })}
    </div>

    {data.industries.length > 0 && (
      <div
        style={{
          marginTop: 24,
          fontSize: 12,
          color: "var(--cream)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="aster">✱</span>
        נבחרו{" "}
        <span
          className="serif mono"
          style={{ fontSize: 18, fontWeight: 700 }}
        >
          {data.industries.length}
        </span>{" "}
        קטגוריות
      </div>
    )}
  </div>
);

const CornerMarks: React.FC = () => (
  <span
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
    }}
  >
    {[0, 1, 2, 3].map((i) => {
      const base: React.CSSProperties = {
        position: "absolute",
        width: 12,
        height: 12,
        borderColor: "var(--cream)",
        borderWidth: "1.5px",
        borderStyle: "solid",
      };
      const pos: React.CSSProperties =
        i === 0
          ? { top: 6, left: 6, borderRight: 0, borderBottom: 0 }
          : i === 1
          ? { top: 6, right: 6, borderLeft: 0, borderBottom: 0 }
          : i === 2
          ? { bottom: 6, left: 6, borderRight: 0, borderTop: 0 }
          : { bottom: 6, right: 6, borderLeft: 0, borderTop: 0 };
      return <span key={i} style={{ ...base, ...pos }} />;
    })}
  </span>
);

const AudienceStep: React.FC<{
  data: RegisterData;
  toggle: (k: "industries" | "audience" | "channels", v: string) => void;
}> = ({ data, toggle }) => (
  <div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>
      04 / 07 · קהל יעד
    </div>
    <h1 className="h-display" style={{ marginBottom: 16 }}>
      מי הקונים
      <br />
      <span style={{ fontStyle: "italic", fontWeight: 500 }}>שלך</span>
      <span className="grad-text">?</span>
    </h1>
    <p
      className="text-2"
      style={{ fontSize: 16, marginBottom: 48, maxWidth: 540 }}
    >
      בחר את 2-3 הפרסונות העיקריות. כך נתאים את הסגנון לקהל המעניק לך הכי הרבה.
    </p>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
      }}
    >
      {AUDIENCE_OPTIONS.map((opt, i) => {
        const selected = data.audience.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle("audience", opt.id)}
            style={{
              position: "relative",
              textAlign: "start",
              padding: "24px 22px",
              borderRadius: 14,
              border: "1px solid",
              borderColor: selected ? "var(--cream)" : "var(--hair-2)",
              background: selected ? "var(--bg-card-2)" : "var(--bg-card)",
              color: "var(--ink)",
              cursor: "pointer",
              transition: "all .15s",
              transform: selected ? "translateY(-2px)" : "none",
              minHeight: 160,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <span className="eyebrow-num" style={{ marginBottom: 14 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <div
                style={{
                  fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                  fontWeight: 700,
                  fontSize: 18,
                  letterSpacing: "-0.015em",
                  marginBottom: 8,
                  lineHeight: 1.15,
                }}
              >
                {opt.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {opt.desc}
              </div>
            </div>
            {selected && <CornerMarks />}
          </button>
        );
      })}
    </div>
  </div>
);

const VibeStep: React.FC<{
  data: RegisterData;
  update: <K extends keyof RegisterData>(k: K, v: RegisterData[K]) => void;
}> = ({ data, update }) => (
  <div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>
      05 / 07 · אווירת המותג
    </div>
    <h1 className="h-display" style={{ marginBottom: 16 }}>
      איזו אווירה
      <br />
      <span style={{ fontStyle: "italic", fontWeight: 500 }}>מספרת</span> אותך
      <span className="grad-text">?</span>
    </h1>
    <p
      className="text-2"
      style={{ fontSize: 16, marginBottom: 48, maxWidth: 540 }}
    >
      בחירה אחת. זה הקומפס שלנו לעריכת תמונות שמרגישות נכון לקטלוג שלך.
    </p>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
      }}
    >
      {VIBE_OPTIONS.map((opt, i) => {
        const selected = data.vibe === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => update("vibe", opt.id)}
            style={{
              position: "relative",
              textAlign: "start",
              padding: 0,
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid",
              borderColor: selected ? "var(--cream)" : "var(--hair-2)",
              cursor: "pointer",
              transition: "all .15s",
              transform: selected ? "translateY(-3px)" : "none",
              boxShadow: selected
                ? "0 16px 40px -16px rgba(235,220,192,.3)"
                : "none",
            }}
          >
            <div
              style={{
                aspectRatio: "5/4",
                background: opt.preview,
                position: "relative",
                display: "grid",
                placeItems: "center",
              }}
            >
              <div
                style={{
                  width: "46%",
                  height: "58%",
                  borderRadius: 8,
                  background: "rgba(0,0,0,.18)",
                  boxShadow:
                    "0 12px 30px -8px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.18)",
                  transform: "rotate(-3deg)",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 12,
                  insetInlineStart: 12,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: opt.accent,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <div
              style={{
                padding: "16px 18px 18px",
                background: selected ? "var(--bg-card-2)" : "var(--bg-card)",
              }}
            >
              <div
                style={{
                  fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                  fontWeight: 700,
                  fontSize: 17,
                  letterSpacing: "-0.015em",
                  marginBottom: 4,
                }}
              >
                {opt.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.4,
                }}
              >
                {opt.desc}
              </div>
            </div>
            {selected && <CornerMarks />}
          </button>
        );
      })}
    </div>
  </div>
);

const PricingChannelsStep: React.FC<{
  data: RegisterData;
  update: <K extends keyof RegisterData>(k: K, v: RegisterData[K]) => void;
  toggle: (k: "industries" | "audience" | "channels", v: string) => void;
}> = ({ data, update, toggle }) => (
  <div style={{ maxWidth: 980, margin: "0 auto" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>
      06 / 07 · מיצוב
    </div>
    <h1 className="h-display" style={{ marginBottom: 16 }}>
      איפה אתה
      <br />
      <span style={{ fontStyle: "italic", fontWeight: 500 }}>נפגש</span> עם
      הקונים<span className="grad-text">?</span>
    </h1>
    <p
      className="text-2"
      style={{ fontSize: 16, marginBottom: 48, maxWidth: 540 }}
    >
      שני שלבים אחרונים — תמחור וערוצים. אלה משפיעים על איך נציג את המוצרים,
      ובאיזה ניואנס.
    </p>

    <div style={{ marginBottom: 48 }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        טווח מחירים אופייני · בחירה אחת
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
        }}
      >
        {PRICE_OPTIONS.map((opt, i) => {
          const selected = data.price === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => update("price", opt.id)}
              style={{
                position: "relative",
                textAlign: "start",
                padding: 22,
                borderRadius: 14,
                border: "1px solid",
                borderColor: selected ? "var(--cream)" : "var(--hair-2)",
                background: selected ? "var(--bg-card-2)" : "var(--bg-card)",
                cursor: "pointer",
                transition: "all .15s",
                color: "var(--ink)",
                minHeight: 130,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <span className="eyebrow-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: "-0.02em",
                    marginBottom: 4,
                  }}
                >
                  {opt.label}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: selected ? "var(--cream)" : "var(--ink-3)",
                    marginBottom: 4,
                  }}
                >
                  {opt.range}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {opt.desc}
                </div>
              </div>
              {selected && <CornerMarks />}
            </button>
          );
        })}
      </div>
    </div>

    <div>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        איפה מגיעים אליך · רב-בחירה
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        {CHANNEL_OPTIONS.map((opt) => {
          const selected = data.channels.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle("channels", opt.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px",
                borderRadius: 12,
                border: "1px solid",
                borderColor: selected ? "var(--cream)" : "var(--hair-2)",
                background: selected ? "var(--bg-card-2)" : "var(--bg-card)",
                color: "var(--ink)",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  background: selected ? "var(--grad)" : "var(--bg-card-hi)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                {opt.icon}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                {opt.label}
              </span>
              {selected && (
                <span
                  style={{
                    marginInlineStart: "auto",
                    color: "var(--cream)",
                  }}
                >
                  <IR.Check size={15} strokeWidth={2.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

const BuildingStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [progress, setProgress] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);

  const phases = [
    "מנתח את ההקשר העסקי",
    "בונה פרופיל קהל יעד",
    "מתאם וויברים ופלטה",
    "אופטימיזציה לערוצי שיווק",
    "מסיים את ה-Brand Avatar",
  ];

  useEffect(() => {
    let p = 0;
    const t = setInterval(() => {
      p += Math.random() * 4 + 2;
      if (p >= 100) {
        p = 100;
        clearInterval(t);
        setTimeout(onDone, 800);
      }
      setProgress(p);
      setPhaseIdx(
        Math.min(Math.floor((p / 100) * phases.length), phases.length - 1)
      );
    }, 220);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{ maxWidth: 720, margin: "40px auto 0", textAlign: "center" }}
    >
      <div
        className="eyebrow"
        style={{ marginBottom: 24, justifyContent: "center" }}
      >
        בונה את ה-Brand Avatar שלך
      </div>

      <div
        style={{
          position: "relative",
          width: 240,
          height: 240,
          margin: "0 auto 40px",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "var(--grad)",
            filter: "blur(40px)",
            opacity: 0.55,
            animation: "pulse 1.8s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 40,
            borderRadius: "50%",
            background: "var(--grad)",
            display: "grid",
            placeItems: "center",
            animation: "floaty 3s ease-in-out infinite",
            boxShadow: "0 24px 80px -20px rgba(0,0,0,.6)",
          }}
        >
          <IR.Sparkles size={56} strokeWidth={1.5} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: -(i + 1) * 18,
              border: "1px solid rgba(255,255,255,.07)",
              borderRadius: "50%",
              animation: `pulse ${2 + i * 0.25}s ease-in-out infinite`,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>

      <h2 className="h-display" style={{ marginBottom: 14 }}>
        ה-AI{" "}
        <span
          style={{ fontStyle: "italic", fontWeight: 500 }}
          className="grad-text"
        >
          לומד
        </span>{" "}
        אותך.
      </h2>
      <p className="text-2" style={{ fontSize: 15, marginBottom: 40 }}>
        {phases[phaseIdx]}…
      </p>

      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div
          style={{
            marginTop: 14,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <span>
            שלב {phaseIdx + 1} / {phases.length}
          </span>
          <span className="mono">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
};

const RevealStep: React.FC<{
  data: RegisterData;
  onComplete: () => void;
}> = ({ data, onComplete }) => {
  const vibe =
    VIBE_OPTIONS.find((v) => v.id === data.vibe) || VIBE_OPTIONS[0];
  const price =
    PRICE_OPTIONS.find((p) => p.id === data.price) || PRICE_OPTIONS[1];
  const industries = INDUSTRY_OPTIONS.filter((i) =>
    data.industries.includes(i.id)
  );
  const audiences = AUDIENCE_OPTIONS.filter((a) =>
    data.audience.includes(a.id)
  );

  const tagline = useMemo(() => {
    const priceWord =
      ({ budget: "נגיש", mid: "מאוזן", premium: "איכותי", luxury: "יוקרתי" } as Record<string, string>)[
        data.price
      ] || "מאוזן";
    const vibeWord =
      (
        {
          minimal: "מינימליסטי",
          lush: "תוסס",
          editorial: "מגזיני",
          vintage: "וינטג׳",
          organic: "אורגני",
          futuristic: "עתידני",
          playful: "שובב",
          edgy: "נועז",
        } as Record<string, string>
      )[data.vibe] || "נקי";
    const indWord = industries[0]?.label || "מוצרים";
    return `מותג ${priceWord} ב${vibeWord}, מתמחה ב${indWord.toLowerCase()}`;
  }, [data, industries]);

  const recommendedPreset = useMemo(() => {
    if (data.vibe === "minimal")
      return {
        name: "סטודיו לבן",
        g: "linear-gradient(135deg,#f8f8f8,#e0e0e0)",
      };
    if (data.vibe === "lush" || data.vibe === "playful")
      return {
        name: "גרדיאנט נועז",
        g: "linear-gradient(135deg,#3D4BFF,#B040E0,#FF3D8B)",
      };
    if (data.vibe === "editorial" || data.vibe === "edgy")
      return {
        name: "דארק לקס",
        g: "linear-gradient(135deg,#1a1a2e,#16213e)",
      };
    if (data.vibe === "organic")
      return {
        name: "חוץ / טבע",
        g: "linear-gradient(135deg,#88C9A1,#4B9F7C)",
      };
    if (data.vibe === "vintage")
      return {
        name: "שיש מבריק",
        g: "linear-gradient(135deg,#F0EDE8,#C8C1B5)",
      };
    return {
      name: "לייפסטייל",
      g: "linear-gradient(135deg,#FFD8C2,#F4A584)",
    };
  }, [data.vibe]);

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div
          className="eyebrow"
          style={{ marginBottom: 24, justifyContent: "center" }}
        >
          <span className="aster">✱</span>
          07 / 07 · ה-Brand Avatar שלך מוכן
        </div>
        <h1 className="h-hero" style={{ marginBottom: 16 }}>
          הכר את
          <br />
          <span
            style={{ fontStyle: "italic", fontWeight: 500 }}
            className="grad-text"
          >
            {data.businessName || "המותג שלך"}
          </span>
          <span className="grad-text">.</span>
        </h1>
        <p
          className="text-2"
          style={{
            fontSize: 17,
            maxWidth: 560,
            margin: "0 auto",
            lineHeight: 1.55,
          }}
        >
          {tagline}. ה-AI שלך יודע מה לעשות עם כל תמונה כך שתדבר ישירות לקהל
          שלך.
        </p>
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: 22,
          padding: 0,
          overflow: "hidden",
          border: "1px solid var(--hair-2)",
          background: "var(--bg-paper)",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: "48px 56px",
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 56,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              position: "relative",
              aspectRatio: "1",
              borderRadius: 16,
              overflow: "hidden",
              background: vibe.preview,
              boxShadow:
                "inset 0 0 0 1px rgba(255,255,255,.08), 0 30px 60px -20px rgba(0,0,0,.4)",
            }}
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
                className="serif"
                style={{
                  fontSize: 92,
                  fontWeight: 800,
                  color: vibe.accent,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                }}
              >
                {(data.businessName || "P").charAt(0).toUpperCase()}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                bottom: 14,
                insetInlineStart: 14,
                color: vibe.accent,
                fontSize: 9,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontWeight: 700,
                opacity: 0.8,
              }}
            >
              Brand Avatar
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                פרופיל המותג
              </div>
              <h2 className="h-1" style={{ marginBottom: 16 }}>
                {data.businessName}{" "}
                <span
                  style={{
                    fontStyle: "italic",
                    fontWeight: 500,
                    color: "var(--ink-3)",
                  }}
                >
                  · {vibe.label}
                </span>
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 24,
                  marginTop: 28,
                }}
              >
                <Detail
                  label="תחום עיקרי"
                  value={industries[0]?.label || "—"}
                />
                <Detail
                  label="קהל יעד עיקרי"
                  value={audiences[0]?.label || "—"}
                />
                <Detail label="טווח מחירים" value={price.range} />
                <Detail label="מיצוב" value={price.label} />
              </div>
            </div>

            <hr className="hr" />

            <div>
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                סגנון מומלץ לפתיחה
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 16 }}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    background: recommendedPreset.g,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
                  }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
                      fontWeight: 700,
                      fontSize: 22,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {recommendedPreset.name}
                  </div>
                  <div className="text-2" style={{ fontSize: 12 }}>
                    על בסיס הוויברים והמיצוב שבחרת
                  </div>
                </div>
                <span
                  className="aster"
                  style={{
                    marginInlineStart: "auto",
                    color: "var(--cream)",
                    fontSize: 24,
                  }}
                >
                  ✱
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "24px 56px",
            borderTop: "1px solid var(--hair)",
            background: "var(--bg-card)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="eyebrow-num">ערוצים</span>
              <div style={{ display: "flex", gap: 8 }}>
                {data.channels.map((c) => {
                  const co = CHANNEL_OPTIONS.find((o) => o.id === c);
                  return (
                    <span
                      key={c}
                      style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 999,
                        border: "1px solid var(--hair-2)",
                        color: "var(--ink-2)",
                      }}
                    >
                      {co?.label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="eyebrow-num">פרסונות</span>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {audiences.map((a) => a.label.split(",")[0]).join(" · ")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <p
          className="text-2"
          style={{ fontSize: 13, maxWidth: 520, margin: 0 }}
        >
          תוכל לערוך את הפרופיל מההגדרות בכל רגע. עכשיו, בוא נחבר את חנות
          ה-Shopify ונתחיל.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost">ערוך פרופיל</button>
          <button className="btn btn-primary xl" onClick={onComplete}>
            המשך לחיבור Shopify <IR.ArrowLeft size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div>
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        marginBottom: 6,
        fontWeight: 600,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: "'Anek Hebrew', 'Heebo', sans-serif",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: "-0.015em",
      }}
    >
      {value}
    </div>
  </div>
);
