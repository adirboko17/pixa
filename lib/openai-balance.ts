import { fmtUSD } from "@/lib/pricing";

const BILLING_OVERVIEW_URL =
  "https://platform.openai.com/settings/organization/billing/overview";

const CREDIT_GRANT_URLS = [
  "https://api.openai.com/v1/dashboard/billing/credit_grants",
  "https://api.openai.com/dashboard/billing/credit_grants",
] as const;

type CreditGrantsResponse = {
  total_available?: number;
  total_paid_available?: number;
  total_granted?: number;
  total_used?: number;
  error?: { message?: string };
};

type CostsBucket = {
  results?: Array<{
    amount?: { value?: string; currency?: string };
  }>;
};

type CostsResponse = {
  data?: CostsBucket[];
  has_more?: boolean;
  next_page?: string;
  error?: { message?: string };
};

export type OpenAIBillingSnapshot = {
  kind: "balance" | "month_spend" | "unconfigured" | "error";
  usd: number | null;
  formatted: string | null;
  label: string;
  lowBalance: boolean;
  message?: string;
  billingUrl: string;
};

function monthStartUnix(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0) / 1000
  );
}

async function fetchCreditBalanceUsd(
  billingSessionKey: string
): Promise<{ usd: number } | { error: string }> {
  let lastError = "לא ניתן לקרוא יתרה מ-OpenAI";

  for (const url of CREDIT_GRANT_URLS) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${billingSessionKey}` },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as CreditGrantsResponse;
    if (!res.ok) {
      lastError = data.error?.message || lastError;
      continue;
    }
    const available =
      typeof data.total_paid_available === "number"
        ? data.total_paid_available
        : typeof data.total_available === "number"
          ? data.total_available
          : null;
    if (available !== null && Number.isFinite(available)) {
      return { usd: available };
    }
  }

  return { error: lastError };
}

async function fetchMonthSpendUsd(adminKey: string): Promise<number | null> {
  let startTime = monthStartUnix();
  let total = 0;
  let pages = 0;

  while (pages < 24) {
    pages += 1;
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${adminKey}` },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as CostsResponse;
    if (!res.ok) {
      throw new Error(data.error?.message || "שגיאה בקריאת עלויות מ-OpenAI");
    }

    for (const bucket of data.data ?? []) {
      for (const row of bucket.results ?? []) {
        const v = Number(row.amount?.value);
        if (Number.isFinite(v)) total += v;
      }
    }

    if (!data.has_more || !data.next_page) break;
    try {
      const next = new URL(data.next_page);
      const st = next.searchParams.get("start_time");
      if (st) startTime = Number(st);
      else break;
    } catch {
      break;
    }
  }

  return total;
}

export async function getOpenAIBillingSnapshot(options: {
  billingSessionKey?: string | null;
  adminApiKey?: string | null;
}): Promise<OpenAIBillingSnapshot> {
  const billingSessionKey = options.billingSessionKey?.trim();
  const adminApiKey = options.adminApiKey?.trim();

  if (billingSessionKey) {
    const result = await fetchCreditBalanceUsd(billingSessionKey);
    if ("usd" in result) {
      const lowBalance = result.usd < 5;
      return {
        kind: "balance",
        usd: result.usd,
        formatted: fmtUSD(result.usd),
        label: "יתרה OpenAI",
        lowBalance,
        billingUrl: BILLING_OVERVIEW_URL,
        message: lowBalance
          ? "היתרה נמוכה — כדאי להטעין ב-OpenAI"
          : undefined,
      };
    }
    return {
      kind: "error",
      usd: null,
      formatted: null,
      label: "יתרה OpenAI",
      lowBalance: false,
      billingUrl: BILLING_OVERVIEW_URL,
      message:
        "מפתח ה-session פג תוקף או לא תקין. עדכן בהגדרות → חיוב.",
    };
  }

  if (adminApiKey) {
    try {
      const spend = await fetchMonthSpendUsd(adminApiKey);
      if (spend === null) {
        return {
          kind: "error",
          usd: null,
          formatted: null,
          label: "הוצאה החודש",
          lowBalance: false,
          billingUrl: BILLING_OVERVIEW_URL,
          message: "לא ניתן לחשב הוצאה החודש",
        };
      }
      return {
        kind: "month_spend",
        usd: spend,
        formatted: fmtUSD(spend),
        label: "הוצאה החודש (OpenAI)",
        lowBalance: false,
        billingUrl: BILLING_OVERVIEW_URL,
        message:
          "OpenAI לא חושף יתרה דרך Admin API — הוסף session key בהגדרות ליתרה מדויקת.",
      };
    } catch (e) {
      return {
        kind: "error",
        usd: null,
        formatted: null,
        label: "OpenAI",
        lowBalance: false,
        billingUrl: BILLING_OVERVIEW_URL,
        message:
          e instanceof Error
            ? e.message
            : "נדרש Admin API key עם scope api.usage.read",
      };
    }
  }

  return {
    kind: "unconfigured",
    usd: null,
    formatted: null,
    label: "יתרה OpenAI",
    lowBalance: false,
    billingUrl: BILLING_OVERVIEW_URL,
    message:
      "חבר session key מהדשבורד של OpenAI (הגדרות → חיוב) כדי להציג יתרה.",
  };
}

export { BILLING_OVERVIEW_URL };
