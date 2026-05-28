"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function BulkBar({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="bulk-bar"
      role="region"
      aria-label="פעולות על פריטים נבחרים"
    >
      {children}
    </div>,
    document.body
  );
}
