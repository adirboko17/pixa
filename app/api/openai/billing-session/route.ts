import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  let body: { session?: string };
  try {
    body = (await req.json()) as { session?: string };
  } catch {
    return NextResponse.json({ error: "JSON לא תקין" }, { status: 400 });
  }

  const session = (body.session ?? "").trim();
  if (!session) {
    return NextResponse.json({ error: "חסר session key" }, { status: 400 });
  }
  if (!session.startsWith("sess-")) {
    return NextResponse.json(
      { error: "מפתח session חייב להתחיל ב-sess-" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ openai_billing_session: session })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ openai_billing_session: null })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
