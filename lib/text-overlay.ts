// טקסט-overlay בצד הלקוח על תמונה שייצרנו: גזירה דרך Canvas של headline,
// subheadline, ו-CTA על תמונת רקע נקייה (ללא טקסט) שבא מהמודל. למה לא לתת
// למודל לרנדר את הטקסט?
// 1. המודל מעוות אותיות עבריות.
// 2. הפונט שיוצא הוא קירוב, לא הפונט המדויק שביקשנו.
// 3. בין desktop ל-mobile יוצא טקסט שונה במקצת, אפילו עם אותו prompt.
//
// הפתרון: המודל מייצר רק תמונה נקייה עם מקום ריק לכיתוב. אנחנו טוענים את
// הפונט מ-Google Fonts, ומציירים בעצמנו את הטקסט על Canvas. זה מבטיח:
// - הטקסט בדיוק מה שהמשתמש הקליד (ללא עיוותים)
// - הפונט בדיוק הפונט שבחר
// - desktop ו-mobile חולקים את אותו תיאור טקסט וקונפיג

import { ensureGoogleFontsLoaded } from "./google-fonts";

export type TextSide = "right" | "left" | "center";

export type OverlayConfig = {
  headline?: string;
  subheadline?: string;
  cta?: string;
  /** RTL = עברית/ערבית, LTR = אנגלית וכו' */
  isRTL: boolean;
  /** באיזה צד של הבאנר הטקסט יופיע. ברירת מחדל: right ב-RTL, left ב-LTR */
  side?: TextSide;
  /** הזזה אנכית סביב מרכז (0 = מרכז, -1 = רחוק למעלה, +1 = רחוק למטה) */
  verticalShift?: number;
  /** משפחת פונט ל-headline (Google Font name) */
  headlineFont?: string;
  /** משפחת פונט ל-subheadline + CTA */
  bodyFont?: string;
  /** צבע טקסט (headline + subheadline). hex או null לאוטומטי לפי הרקע */
  textColor?: string;
  /** צבע רקע של כפתור CTA */
  ctaBgColor?: string;
  /** צבע טקסט של כפתור CTA */
  ctaTextColor?: string;
  /** משקל לכותרת (default 900) */
  headlineWeight?: number;
  /** משקל ל-subheadline (default 400) */
  bodyWeight?: number;
  /** האם להציג shadow רך מאחורי הטקסט – עוזר על תמונות בהירות */
  textShadow?: boolean;
  /** מקדם גודל לכותרת (1 = ברירת מחדל, 0.6 = הקטנה משמעותית, 1.6 = הגדלה) */
  headlineScale?: number;
  /** מקדם גודל לסאב */
  subScale?: number;
  /** מקדם גודל ל-CTA */
  ctaScale?: number;
};

const FALLBACK_HE = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const FALLBACK_LATIN = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fontStack(name: string | undefined, isRTL: boolean): string {
  const fallback = isRTL ? FALLBACK_HE : FALLBACK_LATIN;
  if (!name) return fallback;
  return `"${name}", ${fallback}`;
}

/** טוען תמונה מ-data URL לאלמנט HTMLImageElement */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Failed to load image for overlay"));
    img.src = src;
  });
}

/** מחכה שהפונטים שביקשנו אכן יהיו זמינים בדפדפן */
async function waitForFonts(
  cfg: OverlayConfig,
  sizes: { headline: number; sub: number; cta: number }
): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const families: string[] = [];
  if (cfg.headlineFont) families.push(cfg.headlineFont);
  if (cfg.bodyFont && cfg.bodyFont !== cfg.headlineFont)
    families.push(cfg.bodyFont);
  if (families.length === 0) return;
  ensureGoogleFontsLoaded(families);
  const tasks: Promise<unknown>[] = [];
  if (cfg.headlineFont) {
    tasks.push(
      document.fonts.load(
        `${cfg.headlineWeight || 900} ${sizes.headline}px "${cfg.headlineFont}"`,
        "אבגabc"
      )
    );
  }
  if (cfg.bodyFont) {
    tasks.push(
      document.fonts.load(
        `${cfg.bodyWeight || 400} ${sizes.sub}px "${cfg.bodyFont}"`,
        "אבגabc"
      )
    );
    tasks.push(
      document.fonts.load(
        `700 ${sizes.cta}px "${cfg.bodyFont}"`,
        "אבגabc"
      )
    );
  }
  try {
    await Promise.race([
      Promise.all(tasks),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch {}
}

/**
 * שובר טקסט לכמה שורות בהתבסס על רוחב מקסימלי, בלי לשבור מילים.
 * תומך ב-LTR ו-RTL.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  if (words.length === 1) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * צובע טקסט בהתאם לרקע: בודק את הבהירות הממוצעת של אזור הרקע מתחת לטקסט,
 * ומחזיר לבן או אסור (קרוב לשחור) – מבטיח קונטרסט גבוה.
 */
function autoTextColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  try {
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.min(ctx.canvas.width - sx, Math.floor(w));
    const sh = Math.min(ctx.canvas.height - sy, Math.floor(h));
    if (sw <= 0 || sh <= 0) return "#0f172a";
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let total = 0;
    let count = 0;
    // דגימה כל ~10 פיקסלים כדי לחסוך זמן
    for (let i = 0; i < data.length; i += 4 * 10) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
    const avg = total / Math.max(1, count);
    return avg > 150 ? "#0f172a" : "#ffffff";
  } catch {
    return "#0f172a";
  }
}

/**
 * הפונקציה הראשית: מקבלת תמונה (data URL) + קונפיג, מחזירה תמונה עם טקסט.
 */
export async function composeImageWithText(
  imageDataUrl: string,
  cfg: OverlayConfig
): Promise<string> {
  const img = await loadImage(imageDataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const isPortrait = H > W;

  // גדלי טקסט פרופורציונליים. גישה: כותרת = הקול הראשי, CTA = פעולה
  // משנית מעודנת. גם הוא חייב להיות קריא, אבל לא להתחרות בכותרת.
  const baseUnit = Math.min(W, H);
  // קלאמפ למקדמי גודל כדי למנוע ערכים חריגים
  const hScale = clamp(cfg.headlineScale ?? 1, 0.5, 2);
  const sScale = clamp(cfg.subScale ?? 1, 0.5, 2);
  const cScale = clamp(cfg.ctaScale ?? 1, 0.5, 2);
  const headlineSize = Math.round(
    baseUnit * (isPortrait ? 0.092 : 0.098) * hScale
  );
  const subSize = Math.round(
    baseUnit * (isPortrait ? 0.038 : 0.034) * sScale
  );
  // CTA הוקטן: יחס פחות "כפתור משחק", יותר "כפתור Stripe / Aesop"
  const ctaSize = Math.round(
    baseUnit * (isPortrait ? 0.034 : 0.028) * cScale
  );

  await waitForFonts(cfg, {
    headline: headlineSize,
    sub: subSize,
    cta: ctaSize,
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.drawImage(img, 0, 0, W, H);

  // קביעת צד הטקסט
  const side: TextSide =
    cfg.side || (cfg.isRTL ? "right" : "left");

  // אזור הטקסט: ב-desktop = ~40% רוחב; ב-mobile = ~85% רוחב, מיושר אופקית.
  let blockWidth: number;
  let blockX: number;
  let textAlign: CanvasTextAlign;
  if (isPortrait) {
    blockWidth = W * 0.86;
    blockX = (W - blockWidth) / 2;
    textAlign = "center";
  } else if (side === "center") {
    blockWidth = W * 0.6;
    blockX = (W - blockWidth) / 2;
    textAlign = "center";
  } else if (side === "right") {
    blockWidth = W * 0.42;
    blockX = W - blockWidth - W * 0.04;
    textAlign = "right";
  } else {
    blockWidth = W * 0.42;
    blockX = W * 0.04;
    textAlign = "left";
  }

  ctx.textBaseline = "top";

  // 1) הכן שורות headline
  let headlineLines: string[] = [];
  if (cfg.headline) {
    ctx.font = `${cfg.headlineWeight || 900} ${headlineSize}px ${fontStack(
      cfg.headlineFont,
      cfg.isRTL
    )}`;
    headlineLines = wrapText(ctx, cfg.headline, blockWidth);
  }

  // 2) שורות subheadline
  let subLines: string[] = [];
  if (cfg.subheadline) {
    ctx.font = `${cfg.bodyWeight || 400} ${subSize}px ${fontStack(
      cfg.bodyFont,
      cfg.isRTL
    )}`;
    subLines = wrapText(ctx, cfg.subheadline, blockWidth);
  }

  // 3) מימדים. line-height הדוק לכותרת + נשימה ל-sub.
  const headlineLineH = headlineSize * 1.05;
  const subLineH = subSize * 1.5;
  const gapHeadlineSub = headlineSize * 0.45;
  const gapSubCta = subSize * 1.4;
  // padding מאוזן לפיל. גובה הכפתור = ~2.6× ctaSize.
  const ctaPaddingY = Math.round(ctaSize * 0.95);
  const ctaPaddingX = Math.round(ctaSize * 2.2);
  const ctaBoxH = ctaSize * 1.1 + ctaPaddingY * 2;
  // tracking (letter-spacing) לפי סוג הטקסט – נותן גימור "מעוצב"
  const headlineTracking = -headlineSize * 0.015; // קצת צפוף לכותרת בולטת
  const subTracking = subSize * 0.03; // רחב לסאב, מרגיש פרימיום
  const ctaTracking = ctaSize * 0.02; // עדין יותר ב-CTA, לא לוחץ

  // גובה ה-accent line שמופיע מעל הכותרת
  const accentH = headlineLines.length
    ? Math.max(3, Math.round(headlineSize * 0.07))
    : 0;
  const accentMarginBottom = headlineLines.length ? headlineSize * 0.45 : 0;

  // גובה הכותרת+תת־כותרת בלבד (בלי CTA)
  let topBlockHeight = accentH + accentMarginBottom;
  if (headlineLines.length)
    topBlockHeight += headlineLines.length * headlineLineH;
  if (subLines.length) {
    if (headlineLines.length) topBlockHeight += gapHeadlineSub;
    topBlockHeight += subLines.length * subLineH;
  }

  // ============================================================
  // PORTRAIT (mobile 9:16): פיצול אנכי
  //   - כותרת + sub יושבים בחלק העליון (לפני המוצרים)
  //   - CTA יושב בחלק התחתון (אחרי המוצרים)
  //   - verticalShift דוחף את הבלוק העליון רק במעט (כדי לא להיכנס למוצרים)
  //
  // LANDSCAPE (desktop 16:9):
  //   - הכל בלוק אחד מיושר לצד שנבחר, מרכז אנכי + verticalShift
  // ============================================================
  let topY: number; // ראשית הבלוק העליון (כותרת+sub)
  let ctaY: number; // ראשית כפתור CTA
  if (isPortrait) {
    // אזור עליון מוקצה לטקסט: ~7-30% מגובה התמונה. מרכז ה-block בתוך האזור.
    const topZoneTop = H * 0.07;
    const topZoneBottom = H * 0.3;
    const topZoneCenter = (topZoneTop + topZoneBottom) / 2;
    topY = Math.max(topZoneTop, topZoneCenter - topBlockHeight / 2);
    // הזזה אנכית עדינה (לא נוגע במוצרים)
    topY += (cfg.verticalShift || 0) * (H * 0.04);
    // CTA – לא צמוד לקצה אלא ב-~85% (נותן "lift" ונשימה מתחת)
    const bottomZoneCenter = H * 0.86;
    ctaY = bottomZoneCenter - ctaBoxH / 2;
  } else {
    // landscape: כל הבלוק (headline+sub+CTA) מאוחד
    const fullBlockHeight =
      topBlockHeight + (cfg.cta ? gapSubCta + ctaBoxH : 0);
    const centerY = H / 2;
    const shift = (cfg.verticalShift || 0) * (H * 0.18);
    topY = centerY - fullBlockHeight / 2 + shift;
    ctaY =
      topY +
      topBlockHeight +
      (topBlockHeight > 0 ? gapSubCta * 0.7 : 0);
  }

  // 4) צבע טקסט אוטומטי – נדגום משני האזורים אם portrait
  const autoColor = isPortrait
    ? autoTextColor(ctx, blockX, topY, blockWidth, topBlockHeight)
    : autoTextColor(
        ctx,
        blockX,
        topY,
        blockWidth,
        topBlockHeight + (cfg.cta ? ctaBoxH + gapSubCta : 0)
      );
  const textColor = cfg.textColor || autoColor;

  const applyShadow = (size: number) => {
    if (!cfg.textShadow) {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      return;
    }
    ctx.shadowColor =
      textColor === "#ffffff" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)";
    ctx.shadowBlur = size * 0.22;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = size * 0.06;
  };

  // X של הטקסט (לפי textAlign)
  const textX =
    textAlign === "right"
      ? blockX + blockWidth
      : textAlign === "center"
      ? blockX + blockWidth / 2
      : blockX;

  ctx.textAlign = textAlign;
  ctx.direction = cfg.isRTL ? "rtl" : "ltr";

  // tracking: ctx.letterSpacing נתמך ברוב הדפדפנים החדשים (Chrome/Edge 99+, Firefox 119+, Safari 17+).
  // על דפדפנים ישנים פשוט יתעלמו ממנו והעיצוב עדיין יראה טוב.
  type CtxWithLetterSpacing = CanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  const setTracking = (px: number) => {
    try {
      (ctx as CtxWithLetterSpacing).letterSpacing = `${px.toFixed(1)}px`;
    } catch {}
  };

  // 5) Accent line מעל הכותרת – קו אופקי קטן בצבע ה-CTA, נותן גימור "עיתון/מותג"
  const accentColor = cfg.ctaBgColor || "#0f172a";
  let cursorY = topY;
  if (headlineLines.length) {
    const accentLen = Math.max(40, headlineSize * 1.4);
    let accentX: number;
    if (textAlign === "right") accentX = blockX + blockWidth - accentLen;
    else if (textAlign === "center")
      accentX = blockX + (blockWidth - accentLen) / 2;
    else accentX = blockX;
    ctx.fillStyle = accentColor;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.fillRect(accentX, cursorY, accentLen, accentH);
    cursorY += accentH + accentMarginBottom;
  }

  // 6) צייר headline
  if (headlineLines.length) {
    setTracking(headlineTracking);
    ctx.fillStyle = textColor;
    applyShadow(headlineSize);
    ctx.font = `${cfg.headlineWeight || 900} ${headlineSize}px ${fontStack(
      cfg.headlineFont,
      cfg.isRTL
    )}`;
    for (const line of headlineLines) {
      ctx.fillText(line, textX, cursorY);
      cursorY += headlineLineH;
    }
  }

  // 7) gap + sub
  if (subLines.length) {
    if (headlineLines.length)
      cursorY += gapHeadlineSub - headlineLineH * 0.18;
    setTracking(subTracking);
    ctx.fillStyle = textColor;
    applyShadow(subSize);
    ctx.font = `${cfg.bodyWeight || 400} ${subSize}px ${fontStack(
      cfg.bodyFont,
      cfg.isRTL
    )}`;
    for (const line of subLines) {
      ctx.fillText(line, textX, cursorY);
      cursorY += subLineH;
    }
  }
  setTracking(0);

  // 8) Bottom shield – מגן רך לתחתית המובייל. אם המודל גלש עם המוצרים
  // לאזור התחתון, ה-gradient הזה יבטיח שה-CTA תמיד יושב על משטח קריא,
  // בלי שהוא יראה כמו "מדבקה" שהוטבעה. הצבע מותאם אוטומטית לטקסט.
  if (isPortrait && cfg.cta) {
    const isWhiteText = textColor === "#ffffff";
    const shieldTop = Math.max(ctaY - ctaBoxH * 0.6, H * 0.7);
    const shieldH = H - shieldTop;
    const shieldGrad = ctx.createLinearGradient(0, shieldTop, 0, H);
    if (isWhiteText) {
      shieldGrad.addColorStop(0, "rgba(15,23,42,0)");
      shieldGrad.addColorStop(0.6, "rgba(15,23,42,0.2)");
      shieldGrad.addColorStop(1, "rgba(15,23,42,0.42)");
    } else {
      shieldGrad.addColorStop(0, "rgba(255,255,255,0)");
      shieldGrad.addColorStop(0.6, "rgba(255,255,255,0.4)");
      shieldGrad.addColorStop(1, "rgba(255,255,255,0.78)");
    }
    ctx.fillStyle = shieldGrad;
    ctx.fillRect(0, shieldTop, W, shieldH);
  }

  // 9) CTA button — עיצוב פיל מודרני
  if (cfg.cta) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    setTracking(ctaTracking);
    ctx.font = `700 ${ctaSize}px ${fontStack(cfg.bodyFont, cfg.isRTL)}`;
    const ctaText = cfg.cta;
    const ctaTextW = ctx.measureText(ctaText).width;
    let ctaBoxW = ctaTextW + ctaPaddingX * 2;
    // הגבלה אופקית: אף פעם לא להתפשט מעבר ל-78% מרוחב התמונה
    const maxCtaW = W * (isPortrait ? 0.78 : 0.42);
    if (ctaBoxW > maxCtaW) ctaBoxW = maxCtaW;

    let ctaX: number;
    if (isPortrait) {
      ctaX = (W - ctaBoxW) / 2;
    } else if (textAlign === "right") {
      ctaX = blockX + blockWidth - ctaBoxW;
    } else if (textAlign === "center") {
      ctaX = blockX + (blockWidth - ctaBoxW) / 2;
    } else {
      ctaX = blockX;
    }

    const ctaBgBase = cfg.ctaBgColor || "#0f172a";
    // פיל מלא: radius = חצי מהגובה
    const ctaRadius = ctaBoxH / 2;

    // צל מודרני: רך, נמוך, לא מעצבן. תחושה של "מרחף קצת" במקום "מודבק".
    ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
    ctx.shadowBlur = ctaSize * 1.4;
    ctx.shadowOffsetY = ctaSize * 0.45;

    // צבע אחיד יחיד — בלי gradient שמרגיש "פלסטיק"
    ctx.fillStyle = ctaBgBase;
    roundedRect(ctx, ctaX, ctaY, ctaBoxW, ctaBoxH, ctaRadius);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // טקסט הכפתור
    ctx.fillStyle = cfg.ctaTextColor || "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(
      ctaText,
      ctaX + ctaBoxW / 2,
      ctaY + (ctaBoxH - ctaSize) / 2
    );

    setTracking(0);
  }

  return canvas.toDataURL("image/png");
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount
  );
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
