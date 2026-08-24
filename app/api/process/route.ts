import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { actualCostFromUsageUSD } from "@/lib/pricing";
import { prepareShelfCountEdit } from "@/lib/shelf-count-edit";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEXT_FIDELITY_BLOCK = `
TEXT & LABEL FIDELITY (ABSOLUTELY CRITICAL — applies especially to non-Latin scripts):
- ANY text, label, logo, branding, sticker, badge, barcode, ingredients list, warning, instructions, or printed content visible on the product MUST be preserved EXACTLY as it appears in the source image.
- Copy every character pixel-faithfully. Do NOT invent letters, do NOT "auto-correct", do NOT translate, do NOT stylize, do NOT approximate, do NOT blur, do NOT smudge, do NOT replace with random shapes.
- HEBREW text (אבגדהוזחטיכלמנסעפצקרשת and final letters ךםןףץ): reads right-to-left. The exact letter shapes are mandatory — Hebrew letters have very distinctive forms (e.g., ש has three vertical strokes, א has a diagonal, ל has a tall ascender, ם is a closed square). If you garble them they become unreadable. Keep the right-to-left reading direction.
- The same applies to Arabic (right-to-left, connected letters), Russian/Cyrillic, Chinese, Japanese, Korean, Thai, and any other non-English script — keep characters identical.
- If the text in the source is small or partially blurry, REPRODUCE IT VISUALLY AS IT APPEARS — do not guess what it "should" say. Faithful pixels beat semantic correctness.
- Preserve the font weight, size proportions, color, position, rotation, and curvature of all text relative to the product surface.`;

const LIGHT_PRODUCT_BLOCK = `
LIGHT-COLORED / WHITE PRODUCT VISIBILITY (CRITICAL — must be applied for every product):
- VERY IMPORTANT: the product MUST be 100% visible against the pure white background. NEVER let any part of the product (especially white, off-white, cream, ivory, light gray, silver, glossy, translucent, or transparent products) fade, blend, ghost, dissolve, or become semi-transparent against the white background.
- For light-colored products: actively use subtle natural form shading to give the product clear 3D volume — soft shadows on the curved sides, gentle highlights along edges, gentle reflections on glossy surfaces, and a soft contact shadow under the base. The product surface should show its true shape through light and shadow.
- A WHITE product on a WHITE background must still have a clearly visible silhouette. Use very soft (NOT harsh, NOT dark, NOT colored) ambient shading along the edges and curves to define its form. Think of how a high-end Apple / IKEA / Brabantia / Williams Sonoma product photo of a white object looks — the white product is photographed with soft directional studio light that wraps around it and creates subtle gray tones on the shaded sides, while the background stays pure #FFFFFF.
- Render every contour, handle, ridge, indentation, cap, label, button, screw, seam, and edge that exists in the source. Do NOT crop, slice, cut off, simplify, or erase any part of the product silhouette.
- NEVER leave white "holes" inside the product (e.g., a missing patch on a bottle or a fading area on a panel). Every pixel that should be product = product. Every pixel that should be background = pure white.`;

const BACKGROUND_REMOVAL_BLOCK = `
BACKGROUND REMOVAL (CRITICAL — must follow):
- Completely remove the original background, environment, floor, wall, scenery, props, hands, people, watermarks, and any NON-PRODUCT elements.
- Isolate the product cleanly with sharp, natural edges — no halos, no leftover background fragments, no colored fringes around the silhouette.
- Place the fully isolated product on a pure white #FFFFFF professional studio background.
- Center and arrange the product beautifully with balanced composition and a soft contact shadow underneath.
- IMPORTANT: extra copies of the SAME product (a 2-pack, 3-pack, bundle, מארז) are part of the product. Do NOT treat them as "packaging clutter" or "other products" to delete.`;

const KEEP_PROPORTION_BLOCK = `
PROPORTION PRESERVATION (CRITICAL — must follow):
- Maintain the EXACT aspect ratio and relative proportions of the product as shown in the source image.
- Do NOT stretch, squash, widen, narrow, flatten, or distort the product in any dimension.
- The product's width-to-height ratio must remain identical to the source — only reposition and resize uniformly (scale up/down equally) to fit the frame with white margins.
- Preserve the product's relative visual size within the frame: if the source shows a tall narrow bottle, keep it tall and narrow; if wide and flat, keep it wide and flat.`;

const LIGHT_TOUCH_BLOCK = `
BACKGROUND TREATMENT (user chose to keep background):
- Do NOT fully remove the original background. Clean it up and make it more professional, but preserve the general environment and context from the source.
- Reduce clutter, distractions, and messy elements while keeping the scene recognizable.
- Still improve lighting, sharpness, and overall presentation.`;

const COMPOSITION_BLOCK = `
COMPOSITION & PRESENTATION (must follow — applies to EVERY image):
- Photograph the product in a clean, professional e-commerce hero-shot style (think Amazon main image, Apple product page, IKEA, Williams Sonoma, premium Shopify cards).
- Use the most natural and recognizable angle for the product:
  • Bottles, jars, cans, tubes, spray bottles → upright, front-facing (or very slight 3/4 angle), label fully visible to the camera.
  • Boxes, packaging → slight 3/4 angle to show the main face plus a hint of the side.
  • Bins, baskets, containers → upright, front-facing, lid closed (unless the source shows it open).
  • Tools and appliances → in their natural usage orientation, fully visible.
  • Multi-pack of identical units → ALL units upright, labels facing camera, arranged as a tight retail pack shot (usually a neat row or slight triangular grouping). Never reduce the pack to a single unit.
- The product must look STABLE, sitting naturally on an invisible flat surface. Vertical things stand vertical. Do not tilt, lean, or float at weird angles unless the source clearly shows that.
- NO decorative artifacts whatsoever: no splashes, splatters, sparkles, paint drips, smoke, mist, motion lines, glitter, abstract shapes, color gradients, halos, lens flares, vignettes, or stylized graphic elements anywhere in the image.
- NO additional props, hands, people, body parts, plants, furniture, floors, walls, gradients, or contextual scenery. Just the product (every unit of it), a soft contact shadow under it, and pure white.
- The composition must look like a real photograph taken in a professional product photography studio, NOT like a digital illustration, render, or AI artwork.`;

const UNIT_COUNT_BLOCK = `
UNIT COUNT / PACK / BUNDLE PRESERVATION (ABSOLUTELY CRITICAL — do this FIRST):
- Count every physical unit that is part of the sellable product in the source image.
- The result MUST contain the EXACT SAME NUMBER of physical units. If the source shows 3 jars, output 3 jars. If it shows 1 bottle, output 1 bottle. If it shows 2 boxes, output 2 boxes.
- Identical copies still count separately. A 2-pack, 3-pack, bundle, kit, set, or מארז of the SAME item is N physical items sold together — NOT "one SKU photographed once".
- NEVER collapse, merge, deduplicate, or "simplify" multiple identical units into a single hero unit. This is the most common failure — do not do it.
- Do NOT invent extra units that are not in the source.
- When the product is a multi-pack of identical items, photograph ALL of them together as a professional e-commerce pack shot: every unit fully visible, typically standing side-by-side (or a tight retail grouping), labels facing the camera, unified lighting, on pure white.
- "Other products" / clutter to remove means unrelated background objects (furniture, rooms, people, random extras). Extra copies of THIS same product that form the pack are THE PRODUCT — keep them.`;

const CATALOG_REBUILD_PROMPT = `You are a senior e-commerce catalog photographer and retoucher.

Turn this source photo into a premium retail HERO SHOT of the SAME product on a perfectly clean, ABSOLUTELY PURE WHITE #FFFFFF studio background.

This is NOT a light cleanup. Many source photos are amateur, cropped, messy, or incomplete. You must REDESIGN the photograph so the product looks like a real, complete, new unit shot in a professional studio — while remaining clearly the same product.

IDENTITY (keep):
- Same product category, brand, color, materials, distinctive design, handles, doors, and overall model language.
- Do NOT swap it for a different model or a generic stock lookalike.
- Preserve logos and branding that are clearly readable on the product body.
- Do NOT render the product title or any extra marketing text in the image.

RESTYLING (you MUST improve):
- Professional soft studio lighting, sharp, photorealistic, 3D volume.
- Clean dirt, tape, price stickers, ugly reflections, clutter, and kitchen/room mess around the product.
- Center the complete product with generous pure-white margins (about 18-22% on every side). Soft short contact shadow under the base only.
- The result must look like a real photograph, not an illustration, 3D toy, or AI collage.

CROPPED / INCOMPLETE SOURCE (critical):
- If the product is cut off, cropped, or only partly in frame, RECONSTRUCT the missing parts so the FULL product appears complete — top to bottom, side to side — as a real physical object standing on a studio floor.
- Infer missing geometry from the visible parts and typical construction of this product type.
- Example: a refrigerator cropped at the top or bottom must become a complete fridge — cabinet, doors, handles, kickplate, feet — not a sliced fragment.
- Never leave a product looking chopped, floating as a fragment, or missing a side/top/base.

MESSY INTERIORS (critical — fridges, freezers, ovens, dishwashers, cabinets, open wardrobes, display cases):
- If doors/drawers are open and the interior looks messy, sparse, ugly, poorly lit, or unprofessional, RESTYLE that interior into a clean premium catalog look.
- Example: a fridge whose inner products look bad — tidy the shelves, restyle contents neatly (or present a clean, tastefully stocked / clean empty interior that matches how this appliance is sold).
- Do not leave chaotic leftover food, random clutter, dirty shelves, or ugly kitchen lighting inside.
- If an open door looks accidental or broken, prefer a professional catalog pose: usually doors closed, unless a clean open interior clearly sells the product.

APPLIANCES:
- Must look like a brand-new sellable unit photographed in studio, not a snapshot from someone's kitchen.
- Doors aligned, body complete, no cut-off top/bottom, no surrounding cabinets/walls/floors.

STILL FORBIDDEN:
- Extra props, people, rooms, floors, walls, gradients, sparkles, paint splashes.
- Changing the product into a different SKU.
- Collapsing a pack/bundle into one unit.

Output: photorealistic 1:1 square catalog photo, sharp, high resolution, retail-ready, complete product, lots of clean PURE WHITE space around it.
${LIGHT_PRODUCT_BLOCK}
${COMPOSITION_BLOCK}
${TEXT_FIDELITY_BLOCK}
${UNIT_COUNT_BLOCK}`;

function buildEmptyInteriorBlock(shelfCount = 0): string {
  const shelfRule =
    shelfCount > 0
      ? `- SHELF COUNT IS USER-SET: the empty interior MUST contain exactly ${shelfCount} main shelves. Ignore the shelf count in the source if it is different. Keep drawer and door-bin counts unchanged.`
      : `- FIRST count every interior structure in the SOURCE image (shelves, drawers, door bins, rails).
- The result MUST keep the EXACT SAME NUMBER of shelves, drawers, door bins, and racks.
- Do NOT add extra shelves. Do NOT remove shelves. Do NOT invent a different interior layout.`;

  return `
EMPTY INTERIOR / REMOVE CONTENTS (ABSOLUTELY CRITICAL — do this after identifying the product):
- Remove ALL contents from the interior: food, bottles, jars, cans, leftovers, packaging, bags, condiments, and any loose products sitting on shelves or in door bins.
- The result must show ONLY the appliance / cabinet itself — empty and clean, ready for a catalog shot of a new unit.
${shelfRule}
- Keep shelf materials (glass stays glass, wire stays wire) and support rails of this same product.
- Empty door bins stay in place — just without products inside them.
- Interior lighting should look clean and even. No leftover food ghosts, no floating items, no messy stains that look like leftover contents.
- If doors are closed in the source and the interior is not visible, keep doors closed. If doors are open, keep them open and show the empty interior.`;
}

function normalizeHex(raw: string): string {
  const trimmed = raw.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function buildInteriorLiftBlock(
  lift: "lighten" | "darken" | "",
  hex: string
): string {
  if (hex) {
    return `
INTERIOR COLOR CORRECTION (ABSOLUTELY CRITICAL):
- Recolor ONLY the INTERIOR paint: inner cabinet walls, liner, and the inside faces of the doors.
- Paint the interior this exact color: ${hex}.
- This is a real material/paint change, not a color filter overlay.
- Do NOT change the EXTERIOR body, sides, top, outer door faces, handles, logos, glass, chrome, or shelf materials.
- Do NOT change the front fascia / trim strip on each shelf unless a separate shelf-trim instruction is given.
- Show 3D lighting and soft shading so a dark/light interior does not flatten.
- Do not leave patches of the old interior color. Do not print the hex code.`;
  }

  if (lift === "lighten") {
    return `
INTERIOR BRIGHTNESS CORRECTION (ABSOLUTELY CRITICAL):
- Lighten ONLY the INTERIOR paint: inner cabinet walls, liner, and the inside faces of the doors.
- Raise the interior by about one noticeable step. If it is near-black, make it a lighter charcoal black — still clearly black/dark, just not so deep that interior details disappear.
- Keep the same color family (black stays black, white stays white). Do NOT shift hue toward blue, brown, or gray-beige.
- Do NOT change the EXTERIOR body, sides, top, outer door faces, handles, logos, glass, chrome, or shelf materials.
- Do NOT change the front fascia / trim strip on each shelf unless a separate shelf-trim instruction is given.
- Lighting and 3D shading must remain photorealistic so the interior does not flatten.`;
  }

  return `
INTERIOR BRIGHTNESS CORRECTION (ABSOLUTELY CRITICAL):
- Darken ONLY the INTERIOR paint: inner cabinet walls, liner, and the inside faces of the doors.
- Lower the interior by about one noticeable step. Keep the same color family. Do NOT shift hue.
- Do NOT change the EXTERIOR body, sides, top, outer door faces, handles, logos, glass, chrome, or shelf materials.
- Do NOT change the front fascia / trim strip on each shelf unless a separate shelf-trim instruction is given.
- Lighting and 3D shading must remain photorealistic so the interior does not flatten.`;
}

function buildShelfCountBlock(count: number): string {
  return `
SHELF COUNT — USER OVERRIDE WINS (HIGHEST PRIORITY):
- TARGET = exactly ${count} main shelves.
- If the photo has MAGENTA / PINK horizontal guide lines on the glass, there are exactly ${count} of them. Each guide becomes one real shelf. Remove all magenta lines from the output.
- Ignore the old shelf count in the photo. Follow the guides / the number ${count}.
- A "shelf" = one removable horizontal rack on the side rails. Do NOT count the floor, ceiling, fan, drawers, or door bins.
- SPACING (critical — this is the usual failure): the ${count} racks must be EVENLY spaced, like a real commercial display fridge.
- The gap above the top rack, the gaps BETWEEN racks, and the gap below the bottom rack must all look similar. No giant empty hole between the last two racks.
- FORBIDDEN: dropping the lowest rack onto the cabinet floor. FORBIDDEN: three racks clustered up top and one stuck at the bottom. The bottom rack floats on the side rails, well above the floor.
- Copy this product's shelf style.
- After editing, a person counting racks must get ${count}. No pink/magenta lines may remain.`;
}

function buildShelfLedBlock(combinedWithRebuild: boolean): string {
  const scope = combinedWithRebuild
    ? "- Apply this lighting to the NEW rebuilt shelves (the ones that match the magenta guides)."
    : "- Apply this lighting to the existing shelves. Do not add or remove shelves.";
  return `
SHELF LIGHTING — HIDDEN WHITE LED (do this AFTER the shelf layout is correct):
${scope}
- Light each main shelf with a SMALL, SOFT, WHITE wash. The goal is illumination of the shelf, NOT a visible lamp.
- Do NOT show the LED strip, bar, tube, neon line, glowing edge, or any light fixture. Hide the source completely under the front lip of the shelf.
- PURE WHITE light only. No yellow, cream, amber, blue, RGB, or colored glow.
- Each shelf should look gently brighter at the front. Subtle / בקטנה — not a light show.
- FORBIDDEN: bright white lines across shelves, laser bars, CGI stripes, bloom, fog, lens flares, sparkles, light leaking onto the white background.
- Photorealistic photograph, not a 3D render.
- Do NOT add products onto the shelves.`;
}

function buildShelfTrimBlock(
  trim: "black" | "white",
  combinedWithRebuild: boolean
): string {
  const hex = trim === "white" ? "#F3F3F3" : "#111111";
  const label = trim === "white" ? "white" : "black";
  const scope = combinedWithRebuild
    ? `- After the ${label} racks are placed, paint the front fascia / price-tag strip of EVERY new shelf ${label} (${hex}).`
    : `- Recolor ONLY the thin front fascia / trim strip on the front edge of each existing shelf to ${label} (${hex}).`;
  return `
SHELF FRONT TRIM COLOR (do this AFTER the shelf layout is correct):
${scope}
- Apply the same trim color to every shelf front. Do NOT paint the shelf surface (wire stays wire, glass stays glass).
- Do NOT change interior walls, drawers, door bins, handles, logos, or the exterior cabinet.`;
}

function buildProductFixBlocks(
  args: {
    interiorLift: "lighten" | "darken" | "";
    interiorLiftHex: string;
    shelfCount: number;
    shelfTrim: "black" | "white" | "";
    shelfLed: boolean;
  },
  opts?: { skipShelfCountBlock?: boolean }
): string {
  const combined = args.shelfCount > 0;
  const parts: string[] = [];
  if (args.interiorLift || args.interiorLiftHex) {
    parts.push(buildInteriorLiftBlock(args.interiorLift, args.interiorLiftHex));
  }
  if (args.shelfCount > 0 && !opts?.skipShelfCountBlock) {
    parts.push(buildShelfCountBlock(args.shelfCount));
  }
  if (args.shelfTrim) {
    parts.push(buildShelfTrimBlock(args.shelfTrim, combined));
  }
  if (args.shelfLed) {
    parts.push(buildShelfLedBlock(combined));
  }
  return parts.join("\n");
}

function buildShelfCountRefinementPrompt(
  count: number,
  otherBlocks: string,
  extra?: string
): string {
  const extraBlock =
    extra && extra.length > 2
      ? `

ADDITIONAL USER NOTE:
"""
${extra}
"""`
      : "";

  return `You are editing ONE catalog product photo. Magenta/pink horizontal lines were painted on the glass interior as GUIDES.

PRIMARY TASK — HIGHEST PRIORITY:
There are exactly ${count} magenta guide lines. Turn EACH guide into one real shelf. Output exactly ${count} shelves.

- Count the magenta lines. That count is ${count}. Produce the same number of real racks.
- IGNORE the old shelf count in the photo (it may show 4 when the target is 5). Follow the guides, not the old racks.
- Replace every magenta line with a real removable rack in this product's style (wire/glass/plastic). Mount them on the existing vertical tracks.
- DELETE every magenta/pink guide from the output. No pink lines may remain.
- SPACING (the usual failure — do not repeat it): place the ${count} racks in an EVEN rhythm from top to bottom. Same-looking gap above the top rack, between every pair, and below the bottom rack.
- FORBIDDEN layout: lowest rack sitting on the floor, or a huge empty void between the third and fourth rack while the others are bunched higher up.
- The bottom rack hangs on the side rails, clearly above the floor. The floor itself is not a shelf. The top fan is not a shelf.
- Keep the same product, angle, framing, exterior, handles, logos, and pure white #FFFFFF background.
- Empty interior: no food or products on the shelves.
- A transparent mask marks the interior — rebuild shelves only inside that area. Do not change the door frame or exterior.
- If extra finish instructions appear below (trim color, hidden lighting, interior paint), apply them ON these ${count} new shelves. Do all of it in one result. Do not skip the shelf-count rebuild to keep the old interior.

${otherBlocks}${extraBlock}

OUTPUT:
- Photorealistic catalog photo of the SAME unit, now with exactly ${count} well-spaced shelves, plus any finish instructions above.
- Do not print the number ${count} in the image.
- No CGI neon light bars unless a lighting instruction is given. Do not skip the new shelf layout.
${LIGHT_PRODUCT_BLOCK}
${TEXT_FIDELITY_BLOCK}

FINAL CHECK: count the racks — must be ${count}. Then check spacing — if the lowest rack is on the floor or one gap is much larger than the others, move the racks until the gaps match.`;
}

function buildProductFixRefinementPrompt(
  blocks: string,
  extra?: string,
  shelfCount = 0
): string {
  const extraBlock =
    extra && extra.length > 2
      ? `

ADDITIONAL USER NOTE (apply only if it does not contradict the structured corrections):
"""
${extra}
"""`
      : "";

  const shelfPriority =
    shelfCount > 0
      ? `
SHELF COUNT IS THE MAIN JOB:
- The user typed ${shelfCount}. Both reference images may show a DIFFERENT shelf count — ignore that count.
- Rebuild the interior racks so a viewer can clearly count exactly ${shelfCount} shelves.
- Do not "preserve" the old shelf layout if the number is wrong.`
      : "";

  return `You are refining an EXISTING catalog product photo. Apply the structured product corrections below. You MAY rebuild the interior shelves when the user set a shelf count. Do not restyle or recolor anything else.

You are receiving TWO reference images:

- IMAGE 1 = ORIGINAL source product photo. Use it ONLY for identity: exact shape, materials, branding, and labels. Do NOT copy its shelf count if the user set a number.
- IMAGE 2 = CURRENT catalog result that needs correction. Keep its composition, framing, white #FFFFFF background, empty interior, and every detail that is not mentioned below.
${shelfPriority}

STRUCTURED PRODUCT CORRECTIONS (apply these, and only these):
${blocks}${extraBlock}

OUTPUT REQUIREMENTS:
- Same photo as IMAGE 2, with only the corrections above.
- Background remains 100% pure white #FFFFFF.
- Photorealistic, sharp, retail-ready, 1:1 square product photo.
- Preserve the exact number of physical product units.
- Do not print instructions, color names, or numbers in the image.
${LIGHT_PRODUCT_BLOCK}
${TEXT_FIDELITY_BLOCK}
${UNIT_COUNT_BLOCK}${
    shelfCount > 0
      ? `\n\nFINAL CHECK — SHELVES: count the removable horizontal racks in your output. The number MUST be ${shelfCount}. If it is not ${shelfCount}, fix the interior before finishing.`
      : ""
  }`;
}

function buildRecolorBlock(
  hex: string,
  label: string,
  scope: "both" | "exterior" | "interior"
): string {
  const scopeText =
    scope === "interior"
      ? "Recolor ONLY the INTERIOR (inner walls, liners, door interiors). Leave the exterior body color as in the source."
      : scope === "exterior"
        ? "Recolor ONLY the EXTERIOR (cabinet, doors, sides, top). Leave the interior color as in the source."
        : "Recolor BOTH the EXTERIOR and the INTERIOR — outside and inside must be this same color. Example: a fridge that should be black inside and outside: exterior doors/sides/top AND interior walls, door interiors, and colored liners all become this color.";

  return `
RECOLOR THE PRODUCT (ABSOLUTELY CRITICAL):
- Paint the product this exact color: ${label} (${hex}).
- ${scopeText}
- This is a real material/paint change, not a color filter overlay. The product must look manufactured in this color.
- Keep the same model, shape, handles, seams, logos, and proportions.
- Metal handles, glass shelves, chrome trim, and transparent glass should stay those materials UNLESS they were body-colored plastic in the source. Glass refrigerator shelves stay clear/glass; only the cabinet/liner paint changes.
- Show 3D lighting and soft shading so a black/white/colored body does not flatten into a silhouette.
- Do not leave patches of the old color. No two-tone unless the source had a designed two-tone and the user scoped only one side.
- Do not print the color name or hex code in the image.`;
}

const SINGLE_PROMPT = `Place the exact product shown in this photo on a perfectly clean, ABSOLUTELY PURE WHITE background.
The background color MUST be #FFFFFF (255, 255, 255) — pure white, NOT off-white, NOT cream, NOT light gray, NOT beige, NOT any tint whatsoever. Think of a brand new sheet of bright white paper under perfect studio lighting.
Keep the product itself 100% identical: do not change its shape, colors, materials, text, logos, labels, proportions, or any small detail.
If the photo shows more than one physical unit (including identical copies sold as a pack / bundle / מארז), keep EVERY unit — do not reduce it to a single item.

PRODUCT IDENTIFICATION (do this FIRST, before generating):
- Count the physical units of the product, then identify the FULL silhouette of each one — every contour, edge, ridge, handle, cap, lid, base, foot, label, opening, button, and accessory.
- Recreate the ENTIRE product, complete from top to bottom, side to side, including every unit. No missing edges. No fading. No partial silhouette. No "cut-off" sections.
- If the source image contains other elements (background, props, hands, people, floor, walls, shadows, unrelated objects) that overlap or partially hide the product, mentally "complete" the hidden parts so every unit appears whole and intact in the result.
${UNIT_COUNT_BLOCK}

IMPORTANT SIZING RULES (must follow strictly):
- The product (or the full pack / all units together, if it is a multi-pack) must occupy ONLY about 60-65% of the frame height/width (whichever is larger).
- Leave generous empty PURE WHITE margins on ALL four sides: roughly 18-22% pure white space on top, bottom, left, and right.
- Do NOT let the product touch or come close to any edge of the image. It must feel "floating" with lots of breathing room around it.
- Center the product (the full arrangement of every unit) perfectly in the middle of the frame.
- This is critical so the image fits nicely inside small product cards on an e-commerce website without looking cramped or getting cropped.

BACKGROUND RULES (critical):
- The background MUST be 100% pure white #FFFFFF, completely uniform, no gradients, no shadows on the background itself, no vignetting, no texture, no noise.
- Only the product (and a very subtle shadow directly under it) should be visible. Everything else = pure white.
${LIGHT_PRODUCT_BLOCK}
${COMPOSITION_BLOCK}
${TEXT_FIDELITY_BLOCK}

Use bright, soft, even professional studio lighting (like a high-end e-commerce / Amazon / Shopify product photo) with subtle directional wrap-around shading that makes the product look 3D and physical, NOT flat.
Add a very subtle natural soft contact shadow directly underneath the product to ground it on the surface (the shadow should be soft, short, and stay close to the product base only).
Remove any existing background, props, hands, watermarks, decorations, or distractions — but PRESERVE the full product itself, every unit, completely intact.
Output must be a photorealistic 1:1 square product photo, sharp, high resolution, retail-ready, with the entire product clearly visible (no missing parts, no fading edges), clearly smaller than the frame, and lots of clean PURE WHITE space around it.`;

const GROUP_PROMPT = `Take ALL the products visible in this image and arrange them TOGETHER in ONE professional, cohesive, editorial-style product photo — like a premium retail "set" / "bundle" / "kit" hero photograph (think Williams Sonoma, Amazon bundle hero shot, IKEA collection photo, premium Shopify collection card).

COMPOSITION (must follow):
- Treat all products as a single curated set. Compose them in ONE unified, visually balanced arrangement.
- Tall items (brooms, mops, sticks, bottles) should stand upright OR lean naturally against each other / against shorter items at a slight angle for a dynamic look.
- Flat/stackable items (pads, cloths, sponges, packaging) can be neatly stacked or fanned next to the taller items.
- Containers / open vessels (dustpans, buckets, baskets) can hold or sit beside other items.
- Arrange items asymmetrically but balanced — overlap slightly where natural, but EVERY product must remain clearly visible and recognizable. No product should be heavily hidden behind another.
- Show the items as a real kit a customer would buy together. Make the composition look intentional and editorial, NOT like a flat lineup or a flat-lay grid.
- Keep correct relative scale between items (a broom must look tall vs. a small pad, etc.).

BACKGROUND (critical):
- Background MUST be 100% pure white #FFFFFF, completely uniform — NOT off-white, NOT cream, NOT light gray, no gradients, no texture, no vignetting.
- Add soft natural contact shadows directly under each item to ground them on the white surface. Shadows should be soft, short, and stay close to the base of each item only.

LIGHTING:
- Bright, soft, even professional studio lighting from the front-top.
- Unified lighting direction across ALL items so they look photographed together in one shot.

SIZING / FRAMING:
- The entire group arrangement should occupy about 70-80% of the frame.
- Leave comfortable PURE WHITE margins around the whole composition on all four sides (roughly 10-15% white space).
- Do NOT let any item touch the edges of the image.

PRODUCT FIDELITY (must follow):
- Each individual product must keep its EXACT shape, colors, materials, branding, labels, text, and proportions.
- Do NOT invent new products. Do NOT remove products that exist in the source image.
- Do NOT change product designs, colors, or logos.
- Render the COMPLETE silhouette of every product — no fading edges, no missing parts, no cut-off areas, no "ghosting" against the white background.
- Identical items still count separately. If the source shows three of the same jar/bottle/box, the result MUST show three. Never collapse a pack/bundle/מארז into one unit.
${UNIT_COUNT_BLOCK}
${LIGHT_PRODUCT_BLOCK}
${COMPOSITION_BLOCK}
${TEXT_FIDELITY_BLOCK}

Output: photorealistic 1:1 square hero product photo, sharp, high resolution, retail-ready, on a pure white #FFFFFF background.`;

function buildRefinementPrompt(
  userInstructions: string,
  hasMask: boolean
): string {
  if (hasMask) {
    // עם מסכה: התמונה הראשונה היא התוצאה הקודמת (כי המסכה חלה עליה),
    // והשנייה היא המקור. נשנה את הניסוח כדי שיתאים לסדר התמונות.
    return `You are refining an EXISTING AI-generated product photo. The user has marked the SPECIFIC AREA they want you to fix using a mask.

You are receiving TWO reference images:

- IMAGE 1 = CURRENT AI-generated result. A MASK has been provided alongside this image: the transparent area in the mask indicates the EXACT region the user wants you to edit. The rest of IMAGE 1 (everything not under the transparent mask area) MUST stay pixel-identical to the input. Do NOT change anything outside the masked region.

- IMAGE 2 = ORIGINAL source product photo. Use it ONLY as a reference for what the real product truly looks like — its exact shape, colors, materials, branding, AND ESPECIALLY ALL TEXT/LABELS (including Hebrew, Arabic, and other non-Latin scripts). Do not copy anything from its background or composition.

USER CORRECTION REQUEST (apply ONLY within the masked area of IMAGE 1):
"""
${userInstructions}
"""

OUTPUT REQUIREMENTS:
- Outside the masked area: PIXEL-PERFECT preservation of IMAGE 1.
- Inside the masked area: apply the user's correction, drawing details from IMAGE 2 when relevant (e.g., reproducing label text accurately, restoring missing product edges, etc.).
- Background remains 100% pure white #FFFFFF wherever it is white in IMAGE 1.
- Photorealistic, sharp, retail-ready, 1:1 square product photo.
- Preserve the exact number of physical product units from the original source. Do not collapse a pack into one unit unless the user explicitly asked to.
${LIGHT_PRODUCT_BLOCK}
${TEXT_FIDELITY_BLOCK}
${UNIT_COUNT_BLOCK}`;
  }

  return `You are refining an EXISTING AI-generated product photo to fix specific issues that the user pointed out. You are receiving TWO reference images:

- IMAGE 1 = ORIGINAL source product photo (the ground truth). Use it to know what the real product looks like — exact shape, colors, materials, branding, AND ESPECIALLY ALL TEXT/LABELS. This is your reference for any visual detail of the product itself.

- IMAGE 2 = CURRENT AI-generated result that needs correction. Keep its overall composition, framing, lighting, white #FFFFFF background, and general look — UNLESS the user's correction explicitly asks to change one of those things.

USER CORRECTION REQUEST (apply these specific changes, and only these — do not redo everything from scratch):
"""
${userInstructions}
"""

OUTPUT REQUIREMENTS (still mandatory):
- Background must remain 100% pure white #FFFFFF, completely uniform, no off-white, no gradients, no texture.
- Product fidelity: keep true shape, colors, materials, proportions, and ALL labels/text exactly as in IMAGE 1.
- If the product is white/light-colored, never let it fade into the background — use subtle natural shading to keep it 3D and clearly visible.
- Photorealistic, sharp, high resolution, 1:1 square product photo, retail-ready.
- Preserve the exact number of physical product units from IMAGE 1. Do not collapse a pack into one unit unless the user explicitly asked to.
${LIGHT_PRODUCT_BLOCK}
${COMPOSITION_BLOCK}
${TEXT_FIDELITY_BLOCK}
${UNIT_COUNT_BLOCK}`;
}

/**
 * מנרמל את הרקע ללבן טהור #FFFFFF באמצעות flood-fill מ-4 הפינות.
 * הגישה הזו בטוחה גם למוצרים לבנים: היא הופכת ללבן רק פיקסלים שמחוברים פיזית
 * לפינות דרך אזור בהיר רציף (= הרקע האמיתי), ולא נוגעת בצללה עדינה על המוצר
 * עצמו גם אם היא מאוד בהירה (כי אז היא לא מחוברת לפינות – יש לה גבול).
 */
async function normalizeWhiteBackground(pngBuffer: Buffer): Promise<Buffer> {
  const img = sharp(pngBuffer).ensureAlpha();
  const { data, info } = await img
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels < 3) return pngBuffer;

  // בדיקת הפינות. אם הן כבר לבן טהור מושלם, אין צורך לגעת.
  const corners: Array<[number, number]> = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ];
  const cornerVals = corners.map(([x, y]) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
  });
  const cornerMin = Math.min(...cornerVals.map(([r, g, b]) => Math.min(r, g, b)));
  const cornerMax = Math.max(...cornerVals.map(([r, g, b]) => Math.max(r, g, b)));

  // הרקע כבר טהור לבן (>=253 בכל ערוץ) → לא נוגעים
  if (cornerMin >= 253) {
    return pngBuffer;
  }
  // הפינות לא מספיק בהירות → כנראה תמונה שאינה רקע לבן בכלל → לא נוגעים
  if (cornerMin < 215) {
    return pngBuffer;
  }

  // ספים שמרניים: רק פיקסלים בהירים מאוד ונייטרליים מאוד נחשבים "רקע פוטנציאלי"
  // המספרים הללו דורשים שהפיקסל יהיה כמעט לבן: לפחות 232 בכל ערוץ, ופחות מ-10 הבדל בין ערוצים.
  // צללה עדינה על מוצר לבן (אזורים סביב 220-240 עם הבדל קל בין ערוצים) לא תיכלל.
  const BRIGHT_MIN = 232;
  const NEUTRAL_MAX_DIFF = 10;

  const isBackgroundCandidate = (idx: number): boolean => {
    const i = idx * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const minC = Math.min(r, g, b);
    const maxC = Math.max(r, g, b);
    return minC >= BRIGHT_MIN && maxC - minC <= NEUTRAL_MAX_DIFF;
  };

  // BFS מהפינות + כמה זריעות לאורך הקצוות
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue: number[] = [];

  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    if (!isBackgroundCandidate(idx)) return;
    visited[idx] = 1;
    queue.push(idx);
  };

  // זרעי פינות
  seed(0, 0);
  seed(width - 1, 0);
  seed(0, height - 1);
  seed(width - 1, height - 1);
  // זרעים לאורך הקצוות (כל 32 פיקסלים) כדי לתפוס רקע גם אם פינה אחת לא נחשבת
  for (let x = 0; x < width; x += 32) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y += 32) {
    seed(0, y);
    seed(width - 1, y);
  }

  // 4-connectivity BFS
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;
    // ימין
    if (x + 1 < width) {
      const n = idx + 1;
      if (!visited[n] && isBackgroundCandidate(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    // שמאל
    if (x > 0) {
      const n = idx - 1;
      if (!visited[n] && isBackgroundCandidate(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    // למטה
    if (y + 1 < height) {
      const n = idx + width;
      if (!visited[n] && isBackgroundCandidate(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    // למעלה
    if (y > 0) {
      const n = idx - width;
      if (!visited[n] && isBackgroundCandidate(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  // לא מצאנו רקע אמין? אל תיגע
  if (queue.length < total * 0.05) {
    return pngBuffer;
  }
  // השתנה יותר מ-95% מהתמונה? משהו לא בסדר (כנראה כל התמונה לבנה) → אל תיגע כדי לא להרוס מוצר
  if (queue.length > total * 0.95) {
    return pngBuffer;
  }

  // ציור הרקע כלבן טהור
  const out = Buffer.from(data);
  for (let p = 0; p < total; p++) {
    if (visited[p]) {
      const i = p * channels;
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      if (channels === 4) out[i + 3] = 255;
    }
  }

  return await sharp(out, {
    raw: { width, height, channels: channels as 3 | 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // הערה: אם בעתיד ירצו "מילוי חורים" קטנים בתוך הרקע (לדוגמה, פיקסלים בודדים
  // ברקע שלא תפסנו), אפשר להוסיף שלב סופי של "fill small holes" – אבל זה מוסיף
  // סיכון לאבד פרטים על המוצר, אז נשאיר בלי בינתיים.
}

type Quality = "low" | "medium" | "high" | "auto";

function pickMime(name: string, fallback = "image/png") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  return fallback;
}

/** Detect pack/bundle titles so the model is told the unit count explicitly. */
function looksLikePackTitle(name: string): boolean {
  const n = name.toLowerCase();
  return (
    /מארז|חבילה|שלישייה|רביעייה|multipack|multi-pack|bundle/.test(n) ||
    /\b(pack|set)\b/.test(n) ||
    /\b\d+\s*(יחידות|יח['׳.]?|units?|pcs|pc|pack|pk)\b/.test(n) ||
    /\b(x|×)\s*\d+\b/.test(n) ||
    /\b\d+\s*(x|×)\b/.test(n) ||
    /\b\d+\s*[-–]\s*pack\b/.test(n)
  );
}

function productNameHint(name: string): string {
  const trimmed = name.trim().slice(0, 180);
  if (!trimmed) return "";
  const pack = looksLikePackTitle(trimmed);
  return `
PRODUCT TITLE (from the store listing — a hint only, NEVER render this text in the image):
"${trimmed}"
${
  pack
    ? `This title indicates a PACK / BUNDLE / מארז. The output MUST show every physical unit of the pack (e.g. a 3-pack = three identical items), not a single unit.`
    : `If the source photo shows several identical units together, keep all of them even if the title does not mention a pack.`
}`;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "לא הוגדר OPENAI_API_KEY. צור קובץ .env.local והכנס את המפתח שלך.",
        },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("image");
    const customPrompt = (form.get("prompt") as string | null)?.trim();
    const refinementText = (form.get("refinement") as string | null)?.trim();
    const previousResult = form.get("previousResult");
    const maskFile = form.get("mask");
    const quality = ((form.get("quality") as string | null) ||
      "low") as Quality;
    const sizeRaw = (form.get("size") as string | null) || "1024x1024";
    const paddingRaw = Number(form.get("padding")) || 0;
    const padding = Math.max(0, Math.min(40, paddingRaw));
    const mode = ((form.get("mode") as string | null) || "single") as
      | "single"
      | "group";
    const removeBackground =
      (form.get("removeBackground") as string | null) !== "0";
    const keepProportion =
      (form.get("keepProportion") as string | null) !== "0";
    const preservePackUnits =
      (form.get("preservePackUnits") as string | null) !== "0";
    const productName = (form.get("productName") as string | null)?.trim() || "";
    const preset = (form.get("preset") as string | null)?.trim() || "";
    const recolorHexRaw = (form.get("recolorHex") as string | null)?.trim() || "";
    const recolorLabel =
      (form.get("recolorLabel") as string | null)?.trim() || "custom color";
    const recolorScopeRaw =
      (form.get("recolorScope") as string | null)?.trim() || "both";
    const emptyInterior = (form.get("emptyInterior") as string | null) === "1";
    const interiorLiftRaw =
      (form.get("interiorLift") as string | null)?.trim() || "";
    const interiorLift =
      interiorLiftRaw === "lighten" || interiorLiftRaw === "darken"
        ? interiorLiftRaw
        : "";
    const interiorLiftHex = normalizeHex(
      (form.get("interiorLiftHex") as string | null) || ""
    );
    const shelfCountRaw = Number(form.get("shelfCount"));
    const shelfCount =
      Number.isInteger(shelfCountRaw) &&
      shelfCountRaw >= 1 &&
      shelfCountRaw <= 20
        ? shelfCountRaw
        : 0;
    const shelfTrimRaw =
      (form.get("shelfTrim") as string | null)?.trim() || "";
    const shelfTrim =
      shelfTrimRaw === "black" || shelfTrimRaw === "white"
        ? shelfTrimRaw
        : "";
    const shelfLed = (form.get("shelfLed") as string | null) === "1";
    const hasProductFix =
      !!interiorLift ||
      !!interiorLiftHex ||
      shelfCount > 0 ||
      !!shelfTrim ||
      shelfLed;
    const recolorHex = /^#?[0-9a-fA-F]{6}$/.test(recolorHexRaw)
      ? recolorHexRaw.startsWith("#")
        ? recolorHexRaw
        : `#${recolorHexRaw}`
      : "";
    const recolorScope =
      recolorScopeRaw === "exterior" || recolorScopeRaw === "interior"
        ? recolorScopeRaw
        : "both";
    const isCatalogRebuild =
      preset === "catalog-pro" ||
      preset === "product-recolor" ||
      preset === "empty-interior" ||
      !!recolorHex ||
      emptyInterior ||
      hasProductFix;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "לא התקבל קובץ תמונה." },
        { status: 400 }
      );
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "הקובץ גדול מ-20MB. אנא העלה תמונה קטנה יותר." },
        { status: 400 }
      );
    }

    const allowedSizes = new Set(["1024x1024", "1024x1536", "1536x1024"]);
    const size = allowedSizes.has(sizeRaw) ? sizeRaw : "1024x1024";

    const client = new OpenAI({ apiKey });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uploaded = await toFile(buffer, file.name || "input.png", {
      type: pickMime(file.name || "input.png", file.type || "image/png"),
    });

    // האם זה מצב תיקון? צריך תמונת תוצאה קודמת + טקסט או תיקון מוצר מובנה
    const isRefinement =
      previousResult instanceof File &&
      ((!!refinementText && refinementText.length > 2) || hasProductFix);
    const hasMask =
      isRefinement && maskFile instanceof File && !hasProductFix;

    const productFixArgs = {
      interiorLift,
      interiorLiftHex,
      shelfCount,
      shelfTrim,
      shelfLed,
    } as const;
    const productFixBlocks = hasProductFix
      ? buildProductFixBlocks(productFixArgs)
      : "";
    const shelfFinishBlocks = hasProductFix
      ? buildProductFixBlocks(productFixArgs, { skipShelfCountBlock: true })
      : "";

    let prompt: string;
    if (isRefinement) {
      prompt =
        hasProductFix && shelfCount > 0
          ? buildShelfCountRefinementPrompt(
              shelfCount,
              shelfFinishBlocks,
              refinementText
            )
          : hasProductFix
            ? buildProductFixRefinementPrompt(
                productFixBlocks,
                refinementText,
                shelfCount
              )
            : buildRefinementPrompt(refinementText!, hasMask);
    } else {
      const basePrompt = isCatalogRebuild
        ? CATALOG_REBUILD_PROMPT
        : mode === "group"
          ? GROUP_PROMPT
          : SINGLE_PROMPT;
      prompt =
        customPrompt && customPrompt.length > 5 ? customPrompt : basePrompt;

      if (removeBackground || isCatalogRebuild) {
        prompt += `\n\n${BACKGROUND_REMOVAL_BLOCK}`;
      } else {
        prompt += `\n\n${LIGHT_TOUCH_BLOCK}`;
      }

      if (keepProportion && !isCatalogRebuild) {
        prompt += `\n\n${KEEP_PROPORTION_BLOCK}`;
      }

      if (padding > 0) {
        const productPercent = Math.max(30, 100 - padding * 2);
        if (mode === "group") {
          prompt += `\n\nADDITIONAL STRICT SIZING OVERRIDE: The entire group composition must occupy NO MORE than ${productPercent}% of the frame. Leave at least ${padding}% pure white empty space margin on EVERY side (top, bottom, left, right) around the whole arrangement.`;
        } else {
          prompt += `\n\nADDITIONAL STRICT SIZING OVERRIDE: The product must occupy NO MORE than ${productPercent}% of the frame. Leave at least ${padding}% pure white empty space margin on EVERY side (top, bottom, left, right). The product must look small and floating with lots of clean white space around it.`;
        }
      }

      if (emptyInterior) {
        prompt += `\n\n${buildEmptyInteriorBlock(shelfCount)}`;
      }

      if (recolorHex) {
        prompt += `\n\n${buildRecolorBlock(recolorHex, recolorLabel, recolorScope)}`;
      }

      if (hasProductFix) {
        if (shelfCount > 0) {
          prompt =
            `USER SHELF COUNT OVERRIDE (do this FIRST, before any "keep the source interior" rule):\nThe source photo may show a different number of shelves. IGNORE that number. The result MUST have exactly ${shelfCount} main shelves.\n\n` +
            prompt;
        }
        prompt += `\n\n${productFixBlocks}`;
      }

      if (productName) {
        prompt += `\n\n${productNameHint(productName)}`;
      }

      if (!preservePackUnits) {
        prompt += `\n\nSINGLE-UNIT OVERRIDE: The user wants a single-unit hero photo. Photograph only ONE primary unit of the product, even if the source shows a pack of several identical items.`;
      } else {
        // Repeat at the end — image models often drop unit-count from the middle of a long prompt.
        prompt += `\n\n${UNIT_COUNT_BLOCK}`;
      }

      if (emptyInterior) {
        prompt += shelfCount
          ? `\n\nREMINDER — EMPTY INTERIOR: no food or products inside. The cabinet MUST have exactly ${shelfCount} main shelves. Keep drawer and door-bin counts unchanged.`
          : `\n\nREMINDER — EMPTY INTERIOR: no food or products inside. Keep the exact same shelf / drawer / door-bin count as the source.`;
      }
      if (recolorHex) {
        prompt += `\n\nREMINDER — RECOLOR: the product must be ${recolorLabel} (${recolorHex}), scope: ${recolorScope}.`;
      }
      if (hasProductFix) {
        const bits: string[] = [];
        if (interiorLiftHex) bits.push(`interior color ${interiorLiftHex}`);
        else if (interiorLift) bits.push(`interior ${interiorLift}`);
        if (shelfCount) bits.push(`exactly ${shelfCount} shelves`);
        if (shelfTrim) bits.push(`shelf front trim ${shelfTrim}`);
        if (shelfLed) bits.push("hidden white shelf wash, no visible LED strip");
        prompt += `\n\nREMINDER — PRODUCT FIX: ${bits.join("; ")}. Change only these.`;
      }
    }

    // בונים את מערך התמונות שנשלח למודל
    // - במצב רגיל: רק התמונה המקורית
    // - במצב refinement ללא מסכה: [מקור, תוצאה קודמת]
    // - במצב refinement עם מסכה: [תוצאה קודמת, מקור]
    //   החלפת סדר חיונית – המסכה ב-OpenAI חלה על התמונה הראשונה במערך,
    //   ואנחנו רוצים שהמסכה תחול על התוצאה הקודמת (זו שנערכת בפועל).
    let imageInput: Awaited<ReturnType<typeof toFile>> | Awaited<
      ReturnType<typeof toFile>
    >[] = uploaded;
    let maskUploaded: Awaited<ReturnType<typeof toFile>> | undefined;

    let prevBuffer: Buffer | undefined;
    if (isRefinement && previousResult instanceof File) {
      prevBuffer = Buffer.from(await previousResult.arrayBuffer());
      const prevFile = await toFile(prevBuffer, "previous_result.png", {
        type: pickMime(previousResult.name || "previous_result.png", "image/png"),
      });
      imageInput =
        shelfCount > 0 && !hasMask
          ? prevFile
          : hasMask
            ? [prevFile, uploaded]
            : [uploaded, prevFile];
    }
    if (hasMask && maskFile instanceof File) {
      const maskBuffer = Buffer.from(await maskFile.arrayBuffer());
      maskUploaded = await toFile(maskBuffer, "mask.png", {
        type: "image/png",
      });
    }

    if (shelfCount > 0 && !hasMask) {
      try {
        const prep = await prepareShelfCountEdit(
          prevBuffer ?? buffer,
          shelfCount
        );
        imageInput = await toFile(prep.image, "shelf-guides.png", {
          type: "image/png",
        });
        maskUploaded = await toFile(prep.mask, "shelf-mask.png", {
          type: "image/png",
        });
        console.info(
          `[/api/process] shelf-count prep: target=${shelfCount} ${prep.width}x${prep.height}`
        );
      } catch (err) {
        console.warn("[/api/process] shelf-count prep failed, using photo only", err);
      }
    }

    // משתמשים ב-gpt-image-2 (המודל החדש מאפריל 2026):
    // - הוראות-עוקב משופר משמעותית (מעולה למצב הקבוצתי)
    // - שמירה אוטומטית על high-fidelity לכל תמונת קלט (זהות מוצר טובה יותר)
    // - טקסט מדויק יותר על מוצרים
    // - תומך בריבוי תמונות קלט (קריטי לרפיינמנט: מקור + תוצאה קודמת)
    // - תומך ב-mask לעריכה נקודתית (inpainting)
    // אסור להעביר input_fidelity – המודל תמיד high-fidelity לקלט.
    const editArgs: Parameters<typeof client.images.edit>[0] = {
      model: "gpt-image-2",
      image: imageInput,
      prompt,
      size: size as "1024x1024" | "1024x1536" | "1536x1024",
      quality: quality === "auto" ? "auto" : quality,
      background: "opaque",
      n: 1,
    };
    if (maskUploaded) {
      editArgs.mask = maskUploaded;
    }
    const result = await client.images.edit(editArgs);

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "המודל לא החזיר תמונה. נסה שוב." },
        { status: 502 }
      );
    }

    const rawBuffer = Buffer.from(b64, "base64");
    let finalBuffer: Buffer;
    try {
      finalBuffer = await normalizeWhiteBackground(rawBuffer);
    } catch (e) {
      console.warn("[/api/process] white-normalize failed, returning raw:", e);
      finalBuffer = rawBuffer;
    }
    const finalB64 = finalBuffer.toString("base64");

    const usage = result.usage ?? null;
    const costUSD = actualCostFromUsageUSD(usage);

    return NextResponse.json({
      image: `data:image/png;base64,${finalB64}`,
      imageBase64: finalB64,
      usage,
      costUSD,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "שגיאה לא ידועה במהלך העיבוד.";
    const status =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    console.error("[/api/process] error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
