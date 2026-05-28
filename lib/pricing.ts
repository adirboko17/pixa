// תמחור של gpt-image-2 (USD)
// מקור: OpenAI Pricing (platform.openai.com/docs/pricing)
// נכון לעדכון: gpt-image-2-2026-04-21 (שוחרר אפריל 2026)
//
// gpt-image-2 תמיד מעבד תמונות קלט ב-high fidelity → input image tokens
// יכולים להיות גבוהים יותר עבור edit requests עם תמונת מקור.

export const PRICE_USD_PER_M = {
  inputText: 5, // $5 per 1M input text tokens
  inputImage: 10, // $10 per 1M input image tokens
  outputImage: 40, // $40 per 1M output image tokens
} as const;

export type Quality = "low" | "medium" | "high" | "auto";
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/**
 * עלות *ממוצעת* משוערת לתמונת פלט בודדת (output image) – ללא קלט.
 * מחירים רשמיים של gpt-image-2 לכל גודל/איכות.
 * אלו אומדנים – העלות האמיתית מחושבת מ-usage שמחזיר OpenAI אחרי כל בקשה.
 */
const OUTPUT_USD: Record<ImageSize, Record<"low" | "medium" | "high", number>> = {
  // gpt-image-2 (אפריל 2026):
  // square slightly more expensive at high, but cheaper at low/medium
  // and cheaper on non-square sizes overall.
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
  "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
};

/**
 * עלות *קלט* ממוצעת לתמונה אחת שאנחנו מעלים ל-images.edit.
 * gpt-image-2 תמיד high-fidelity, אז קצת יותר input tokens:
 * ~400-700 input image tokens לתמונת מקור = ~$0.005 לתמונה.
 */
const INPUT_IMAGE_USD = 0.005;

/**
 * מחזיר עלות משוערת לתמונה אחת – קלט + פלט.
 */
export function estimateCostPerImageUSD(
  size: ImageSize,
  quality: Quality
): number {
  const q = quality === "auto" ? "high" : quality;
  const out = OUTPUT_USD[size]?.[q] ?? OUTPUT_USD["1024x1024"].high;
  return out + INPUT_IMAGE_USD;
}

/**
 * עלות משוערת לכמות תמונות.
 */
export function estimateBatchCostUSD(
  count: number,
  size: ImageSize,
  quality: Quality
): number {
  return estimateCostPerImageUSD(size, quality) * Math.max(0, count);
}

/**
 * מחשב עלות אמיתית מתוך usage שהוחזר מ-OpenAI אחרי הבקשה.
 */
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    text_tokens?: number;
    image_tokens?: number;
  };
};

export function actualCostFromUsageUSD(usage: Usage | null | undefined): number {
  if (!usage) return 0;
  const textTok = usage.input_tokens_details?.text_tokens ?? 0;
  const imgTok = usage.input_tokens_details?.image_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  return (
    (textTok * PRICE_USD_PER_M.inputText) / 1_000_000 +
    (imgTok * PRICE_USD_PER_M.inputImage) / 1_000_000 +
    (outTok * PRICE_USD_PER_M.outputImage) / 1_000_000
  );
}

/**
 * פורמט נוח להצגה.
 */
export function fmtUSD(v: number): string {
  if (!isFinite(v) || v <= 0) return "$0.00";
  if (v < 0.01) return `<$0.01`;
  if (v < 1) return `$${v.toFixed(3)}`;
  if (v < 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

// שער המרה משוער דולר→שקל. אפשר להגדיר ENV NEXT_PUBLIC_USD_TO_ILS להחלפה.
const DEFAULT_USD_TO_ILS = 3.7;

export function usdToIls(usd: number): number {
  const rate =
    Number(
      typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_USD_TO_ILS
        : undefined
    ) || DEFAULT_USD_TO_ILS;
  return usd * rate;
}

export function fmtILS(v: number): string {
  if (!isFinite(v) || v <= 0) return "₪0.00";
  if (v < 0.01) return `<₪0.01`;
  if (v < 1) return `₪${v.toFixed(2)}`;
  return `₪${v.toFixed(2)}`;
}

export function fmtBoth(usd: number): string {
  return `${fmtUSD(usd)} (${fmtILS(usdToIls(usd))})`;
}
