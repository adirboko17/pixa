import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixa · תמונות מוצר שמוכרות לבד",
  description:
    "פלטפורמת AI לייצור תמונות מוצר מקצועיות. מתחבר ל-Shopify, מסנכרן את הקטלוג, ומעצב עיצובים שלמים של תמונות בלחיצה.",
  icons: {
    icon: "/assets/favicon.png",
    apple: "/assets/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Anek+Hebrew:wght@300;400;500;600;700;800&family=Heebo:wght@300;400;500;600;700;800;900&family=Assistant:wght@400;500;600;700;800&family=Rubik:wght@400;500;600;700;800&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body data-density="regular">{children}</body>
    </html>
  );
}
