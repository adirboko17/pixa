"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpenAIBillingSnapshot } from "@/lib/openai-balance";

const POLL_MS = 5 * 60 * 1000;

export function useOpenAIBalance(enabled = true) {
  const [data, setData] = useState<OpenAIBillingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/openai/balance", { cache: "no-store" });
      if (res.status === 401) {
        setData(null);
        return;
      }
      const json = (await res.json()) as OpenAIBillingSnapshot;
      setData(json);
    } catch {
      setData({
        kind: "error",
        usd: null,
        formatted: null,
        label: "OpenAI",
        lowBalance: false,
        billingUrl:
          "https://platform.openai.com/settings/organization/billing/overview",
        message: "שגיאה בטעינת יתרה",
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { data, loading, refresh };
}
