// רשימה מובחרת של פונטים מ-Google Fonts לבאנרי Hero.
// כללנו את הפונטים שהכי טובים לעברית + פונטים לטיניים פופולריים. כל פונט
// כולל: תמיכה בשפות, קטגוריה (display/body), משקלים, ו-cssWeight (משקלים
// שאנחנו טוענים לתצוגה מקדימה – לא הכל כדי לחסוך KB).

export type GoogleFont = {
  /** השם ב-Google Fonts (תואם לערך family= ב-URL) */
  family: string;
  /** האם תומך בעברית */
  hebrew: boolean;
  /** האם תומך בלטיני */
  latin: boolean;
  /** קטגוריה ויזואלית */
  category: "display" | "sans" | "serif" | "rounded";
  /** vibe מילולי לתצוגה */
  vibe: string;
  /** משקלים שנטען לתצוגה מקדימה (לחיסכון בנפח) */
  weights: number[];
};

export const GOOGLE_FONTS: GoogleFont[] = [
  // עברית + לטינית – הפופולריים בישראל
  {
    family: "Heebo",
    hebrew: true,
    latin: true,
    category: "sans",
    vibe: "מודרני נקי",
    weights: [400, 700, 900],
  },
  {
    family: "Assistant",
    hebrew: true,
    latin: true,
    category: "sans",
    vibe: "ידידותי מעוגל",
    weights: [400, 700, 800],
  },
  {
    family: "Rubik",
    hebrew: true,
    latin: true,
    category: "rounded",
    vibe: "גיאומטרי רך",
    weights: [400, 600, 900],
  },
  {
    family: "Karantina",
    hebrew: true,
    latin: true,
    category: "display",
    vibe: "צר ונועז",
    weights: [400, 700],
  },
  {
    family: "Suez One",
    hebrew: true,
    latin: true,
    category: "display",
    vibe: "כבד ומפואר",
    weights: [400],
  },
  {
    family: "Secular One",
    hebrew: true,
    latin: true,
    category: "display",
    vibe: "Bold גיאומטרי",
    weights: [400],
  },
  {
    family: "Frank Ruhl Libre",
    hebrew: true,
    latin: true,
    category: "serif",
    vibe: "אלגנטי קלאסי",
    weights: [400, 700, 900],
  },
  {
    family: "Bellefair",
    hebrew: true,
    latin: true,
    category: "serif",
    vibe: "סריף עדין",
    weights: [400],
  },
  {
    family: "Noto Sans Hebrew",
    hebrew: true,
    latin: true,
    category: "sans",
    vibe: "נייטרלי קריא",
    weights: [400, 700, 900],
  },
  {
    family: "Noto Serif Hebrew",
    hebrew: true,
    latin: true,
    category: "serif",
    vibe: "סריף קריא",
    weights: [400, 700],
  },
  {
    family: "Miriam Libre",
    hebrew: true,
    latin: true,
    category: "display",
    vibe: "גיאומטרי כתב",
    weights: [400, 700],
  },
  {
    family: "Alef",
    hebrew: true,
    latin: true,
    category: "sans",
    vibe: "הומניסטי מאוזן",
    weights: [400, 700],
  },
  {
    family: "Varela Round",
    hebrew: true,
    latin: true,
    category: "rounded",
    vibe: "מעוגל לחלוטין",
    weights: [400],
  },
  {
    family: "David Libre",
    hebrew: true,
    latin: true,
    category: "serif",
    vibe: "עברית מסורתית",
    weights: [400, 700],
  },
  // לטינית בלבד – לאתרים שמיועדים לחו"ל
  {
    family: "Playfair Display",
    hebrew: false,
    latin: true,
    category: "serif",
    vibe: "מגזיני יוקרתי",
    weights: [400, 700, 900],
  },
  {
    family: "Cormorant Garamond",
    hebrew: false,
    latin: true,
    category: "serif",
    vibe: "Garamond עדין",
    weights: [400, 600, 700],
  },
  {
    family: "Inter",
    hebrew: false,
    latin: true,
    category: "sans",
    vibe: "טכנו מודרני",
    weights: [400, 600, 800],
  },
  {
    family: "Poppins",
    hebrew: false,
    latin: true,
    category: "sans",
    vibe: "גיאומטרי פופולרי",
    weights: [400, 600, 800],
  },
  {
    family: "Montserrat",
    hebrew: false,
    latin: true,
    category: "sans",
    vibe: "אורבני מאוזן",
    weights: [400, 600, 800],
  },
];

/** בונה URL ל-Google Fonts API שיטען את כל הפונטים שנבחרו. */
export function buildGoogleFontsUrl(families: string[]): string | null {
  const unique = Array.from(new Set(families.filter(Boolean)));
  if (unique.length === 0) return null;
  const params = unique
    .map((fam) => {
      const meta = GOOGLE_FONTS.find((f) => f.family === fam);
      const weights = meta?.weights || [400, 700];
      return `family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@${weights.join(";")}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * מטעין דינמית פונטים מ-Google Fonts לתוך head של הדף. ידאג לא לטעון פעמיים.
 * הפונקציה רצה בצד הלקוח בלבד.
 */
export function ensureGoogleFontsLoaded(families: string[]): void {
  if (typeof document === "undefined") return;
  const url = buildGoogleFontsUrl(families);
  if (!url) return;
  const id = `gf:${url}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/** בודק האם בחירת פונט מתאימה לשפה הנוכחית של המותג. */
export function isFontSuitableFor(
  font: GoogleFont,
  lang: string | undefined
): boolean {
  if (lang === "he" || lang === "ar") return font.hebrew;
  return font.latin;
}
