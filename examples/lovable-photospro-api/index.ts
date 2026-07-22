// Supabase Edge Function for Lovable projects.
// Deploy as: photospro-api
// URL: https://YOUR_PROJECT.supabase.co/functions/v1/photospro-api
//
// Required Secret (Cloud → Secrets): PHOTOSPRO_API_KEY
//
// Endpoints:
//   GET  /products              → list products with images
//   PUT  /products/:id/image    → update product image (body: { image_base64 })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, x-client-info, apikey, content-type",
};

function routePath(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const marker = "/photospro-api";
  const idx = pathname.indexOf(marker);
  if (idx >= 0) {
    return pathname.slice(idx + marker.length) || "/";
  }
  return pathname;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== Deno.env.get("PHOTOSPRO_API_KEY")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const path = routePath(req);

  if (req.method === "GET" && (path === "/products" || path === "/")) {
    const { data, error } = await supabase
      .from("products")
      .select("id, title, image_url, images")
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        products: (data ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          image_url: p.image_url,
          images: p.images ?? [],
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const imageMatch = path.match(/^\/products\/([^/]+)\/image$/);
  if (req.method === "PUT" && imageMatch) {
    const productId = imageMatch[1];
    const { image_base64, filename, alt } = await req.json();

    if (!image_base64) {
      return new Response(JSON.stringify({ error: "Missing image_base64" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0));
    const fileName =
      filename || `products/${productId}/${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      return new Response(JSON.stringify({ error: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: publicData } = supabase.storage
      .from("images")
      .getPublicUrl(fileName);

    const newImageUrl = publicData.publicUrl;

    const { error: updateError } = await supabase
      .from("products")
      .update({
        image_url: newImageUrl,
        alt_text: alt ?? null,
      })
      .eq("id", productId);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, new_image_url: newImageUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
