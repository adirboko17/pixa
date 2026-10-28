import { NextRequest, NextResponse } from "next/server";

import {
  describeCustomApiError,
  uploadCustomApiImage,
} from "@/lib/custom-api-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { apiUrl, apiKey, productId, base64, filename, alt } =
      (await req.json()) as {
        apiUrl?: string;
        apiKey?: string;
        productId?: string;
        base64?: string;
        filename?: string;
        alt?: string;
      };

    if (!apiUrl || !apiKey || !productId || !base64) {
      return NextResponse.json(
        { error: "חסרים פרמטרים: apiUrl, apiKey, productId, base64" },
        { status: 400 }
      );
    }

    const { newImageUrl } = await uploadCustomApiImage(
      { apiUrl, apiKey },
      { productId, base64, filename, alt }
    );

    return NextResponse.json({
      success: true,
      newImageUrl,
    });
  } catch (err: unknown) {
    const m = describeCustomApiError(err);
    console.error("[custom-api] upload image failed", m);
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
