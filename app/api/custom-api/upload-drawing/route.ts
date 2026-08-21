import { NextRequest, NextResponse } from "next/server";

import {
  CustomApiRequestError,
  describeCustomApiError,
  uploadCustomApiDrawing,
} from "@/lib/custom-api-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { apiUrl, apiKey, productId, base64, filename } =
      (await req.json()) as {
        apiUrl?: string;
        apiKey?: string;
        productId?: string;
        base64?: string;
        filename?: string;
      };

    if (!apiUrl || !apiKey || !productId || !base64) {
      return NextResponse.json(
        { error: "חסרים פרמטרים: apiUrl, apiKey, productId, base64" },
        { status: 400 }
      );
    }

    const { listingId, drawingUrl } = await uploadCustomApiDrawing(
      { apiUrl, apiKey },
      { productId, base64, filename }
    );

    return NextResponse.json({
      success: true,
      listing_id: listingId,
      drawing_url: drawingUrl,
    });
  } catch (err: unknown) {
    const status = err instanceof CustomApiRequestError ? err.status : 502;
    return NextResponse.json(
      { error: describeCustomApiError(err) },
      { status }
    );
  }
}
