import { NextResponse } from "next/server";
import { getOpenAIBillingSnapshot } from "@/lib/openai-balance";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("openai_billing_session")
    .eq("id", user.id)
    .maybeSingle();

  const snapshot = await getOpenAIBillingSnapshot({
    billingSessionKey:
      process.env.OPENAI_BILLING_SESSION_KEY ??
      profile?.openai_billing_session ??
      null,
    adminApiKey: process.env.OPENAI_ADMIN_API_KEY ?? null,
  });

  return NextResponse.json(snapshot);
}
