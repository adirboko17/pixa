import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; PhotosProBot/1.0; +https://photospro.local) Chrome/120 Safari/537.36";

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: "חסר url" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "url לא תקין" }, { status: 400 });
    }

    const referer = `${parsed.protocol}//${parsed.host}/`;
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "image/*,*/*;q=0.8",
        referer,
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `שגיאה ${res.status} בהורדת התמונה` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "ה-URL לא מצביע על תמונה" },
        { status: 415 }
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // הגבלה: עד 25MB לקובץ
    if (buf.length > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "התמונה גדולה מ-25MB" },
        { status: 413 }
      );
    }

    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-length": String(buf.length),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
