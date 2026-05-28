/**
 * יצירת slug תיאורי וידידותי-SEO משם מוצר.
 *
 * עקרונות:
 * - מקפים `-` במקום קווים תחתונים `_` (גוגל סופר מקפים כמפרידי-מילים).
 * - lowercase לאותיות לטיניות.
 * - שמירה על אותיות עבריות וערביות כפי שהן (גוגל וה-CDN של Shopify
 *   תומכים ב-UTF-8 בכתובות; הם פשוט מוצפנים אוטומטית ל-percent-encoding).
 * - הסרת ניקוד עברי, גרשיים וגרשים.
 * - חיתוך חכם בגבול מילה (לא לחצות מילה באמצע).
 * - תקרת אורך סבירה לשמות קבצים ול-URL-ים נוחים.
 *
 * דוגמאות:
 *   "GREEN TEA נוזל רצפות בבישום כפול" → "green-tea-נוזל-רצפות-בבישום-כפול"
 *   "KH-7 סופר מסיר כתמים"             → "kh-7-סופר-מסיר-כתמים"
 *   "5 ליטר בסיס לקריסטל – CS-1 RED"    → "5-ליטר-בסיס-לקריסטל-cs-1-red"
 *   ""                                  → "product"
 */
export function slugifyProductName(title: string, maxLen = 60): string {
  if (!title) return "product";

  let s = title.normalize("NFKD");

  // מסיר ניקוד עברי + סימנים מסולסלים נדירים (טעמי מקרא וכו')
  s = s.replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, "");

  // מסיר גרשיים/גרשים בעברית ובלטינית (כדי לא לקבל "kh-7-quot-")
  s = s.replace(/[״׳"'`’“”]/g, "");

  // lowercase לאותיות לטיניות (לא משפיע על עברית)
  s = s.toLowerCase();

  // כל מה שאינו אות לטינית/ספרה/אות עברית/אות ערבית → מקף
  // (\u0590-\u05FF = עברית, \u0600-\u06FF = ערבית)
  s = s.replace(/[^a-z0-9\u0590-\u05FF\u0600-\u06FF]+/g, "-");

  // מאחד מקפים רבים למקף אחד
  s = s.replace(/-+/g, "-");

  // חיתוך הקצוות
  s = s.replace(/^-+|-+$/g, "");

  if (s.length === 0) return "product";

  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
    // חזרה אחורה למקף האחרון כדי שלא נחתוך באמצע מילה,
    // אבל רק אם זה לא יקצץ יותר מדי מהשם (לפחות חצי מהאורך נשמר).
    const lastHyphen = s.lastIndexOf("-");
    if (lastHyphen > maxLen * 0.5) {
      s = s.slice(0, lastHyphen);
    }
    s = s.replace(/^-+|-+$/g, "");
  }

  return s || "product";
}

/**
 * שם קובץ מוכן לשמירה/העלאה, עם סיומת.
 * דוגמה: slugifyFilename("GREEN TEA נוזל", "png") → "green-tea-נוזל.png"
 */
export function slugifyFilename(
  title: string,
  extension: string,
  maxLen = 60
): string {
  const slug = slugifyProductName(title, maxLen);
  const ext = (extension || "png").replace(/^\.+/, "").toLowerCase();
  return `${slug}.${ext}`;
}

/**
 * מחזיר את הסיומת של URL לתמונה, או "jpg" כברירת מחדל.
 */
export function extensionFromUrl(url: string, fallback = "jpg"): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
    if (m && m[1]) return m[1].toLowerCase();
  } catch {
    // ignore
  }
  return fallback;
}
