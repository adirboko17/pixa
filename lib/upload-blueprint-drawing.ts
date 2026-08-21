"use client";

import { flattenBlueprint } from "@/components/pixa/BlueprintEditor";
import type { BlueprintLayout } from "@/lib/blueprint-annotations";
import { uploadCustomApiProductDrawing } from "@/lib/custom-api-client";
import type { CustomApiStoreConnection } from "@/lib/store-connection";

async function urlToDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;

  const res = await fetch("/api/fetch-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `שגיאה בהורדת השרטוט (${res.status})`);
  }
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("לא הצלחנו לקרוא את קובץ השרטוט"));
    };
    reader.onerror = () => reject(new Error("לא הצלחנו לקרוא את קובץ השרטוט"));
    reader.readAsDataURL(blob);
  });
}

export async function prepareDrawingDataUri(
  imageUrl: string,
  layout?: BlueprintLayout
): Promise<string> {
  const local = await urlToDataUri(imageUrl);
  if (!layout) return local;
  return flattenBlueprint(local, layout);
}

export async function uploadFlattenedDrawing(
  conn: CustomApiStoreConnection,
  args: {
    productId: string;
    imageUrl: string;
    layout?: BlueprintLayout;
    filename?: string;
  }
): Promise<{ listing_id: string; drawing_url: string }> {
  const image_base64 = await prepareDrawingDataUri(args.imageUrl, args.layout);
  return uploadCustomApiProductDrawing(conn, {
    productId: args.productId,
    base64: image_base64,
    filename: args.filename ?? "drawing.png",
  });
}
