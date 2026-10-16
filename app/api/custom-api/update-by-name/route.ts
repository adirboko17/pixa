import { NextRequest, NextResponse } from "next/server";

import {
  describeCustomApiError,
  updateCustomApiProductByName,
} from "@/lib/custom-api-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingImage = {
  imageBase64?: string;
  position?: number;
  primary?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      apiUrl?: string;
      apiKey?: string;
      title?: string;
      price?: number;
      currency?: string;
      imageBase64?: string;
      images?: IncomingImage[];
    };

    if (!body.apiUrl || !body.apiKey || !body.title?.trim()) {
      return NextResponse.json(
        { error: "חסרים כתובת API, מפתח או שם מוצר" },
        { status: 400 }
      );
    }

    const images = (body.images ?? [])
      .filter((img) => img.imageBase64)
      .map((img, index) => ({
        imageBase64: img.imageBase64 as string,
        position: img.position ?? index + 1,
        primary: img.primary === true,
      }));

    const result = await updateCustomApiProductByName(
      { apiUrl: body.apiUrl, apiKey: body.apiKey },
      {
        title: body.title.trim(),
        price: body.price,
        currency: body.currency,
        imageBase64: body.imageBase64,
        images,
      }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = describeCustomApiError(err);
    const status = /לא נמצא מוצר/.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
