"use client";

import React from "react";

type IconProps = {
  size?: number;
  strokeWidth?: number;
  fill?: boolean;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
};

const Svg: React.FC<IconProps> = ({
  size = 20,
  strokeWidth = 1.75,
  fill = false,
  style,
  className,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    className={className}
  >
    {children}
  </svg>
);

const make = (children: React.ReactNode) => (props: IconProps) =>
  <Svg {...props}>{children}</Svg>;

export const Icons = {
  Dashboard: make(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  Box: make(
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v9" />
    </>
  ),
  History: make(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  Settings: make(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.27 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.27l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  Sparkles: make(
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  ),
  Wand: ({ size = 22, style, className, scale = 1.45 }: IconProps & { scale?: number }) => {
    const renderSize = size * scale;
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          ...style,
        }}
      >
        <img
          src="/assets/magic-wand.svg"
          alt=""
          style={{
            width: renderSize,
            height: renderSize,
            objectFit: "contain",
            display: "block",
            filter: "brightness(0) invert(1)",
          }}
        />
      </span>
    );
  },
  Image: make(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  Check: make(<path d="m5 12 5 5L20 7" />),
  X: make(<path d="M6 6l12 12M18 6 6 18" />),
  Plus: make(<path d="M12 5v14M5 12h14" />),
  Search: make(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  ChevronLeft: make(<path d="m15 18-6-6 6-6" />),
  ChevronRight: make(<path d="m9 18 6-6-6-6" />),
  ChevronDown: make(<path d="m6 9 6 6 6-6" />),
  ArrowUp: make(<path d="M12 19V5M5 12l7-7 7 7" />),
  ArrowLeft: make(<path d="M19 12H5M12 19l-7-7 7-7" />),
  ArrowRight: make(<path d="M5 12h14M12 5l7 7-7 7" />),
  Bell: make(
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  Help: make(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  Bolt: make(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />),
  Upload: make(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  Download: make(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  Filter: make(<path d="M3 6h18M6 12h12M10 18h4" />),
  Layers: make(
    <>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </>
  ),
  Logo: ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="pixaLogoGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3D4BFF" />
          <stop offset="35%" stopColor="#B040E0" />
          <stop offset="70%" stopColor="#FF3D8B" />
          <stop offset="100%" stopColor="#FF8A47" />
        </linearGradient>
      </defs>
      <path d="M5 3h7a6 6 0 0 1 0 12H8v6H5V3z" fill="url(#pixaLogoGrad)" />
      <path
        d="M11.5 6.5 12.7 9l2.5 1.2-2.5 1.2-1.2 2.5-1.2-2.5L7.8 10.2 10.3 9z"
        fill="#fff"
      />
    </svg>
  ),
  Globe: make(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  Shopify: ({ size = 22, style, className }: IconProps) => (
    <img
      src="/assets/shopify.svg"
      alt=""
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        flexShrink: 0,
        ...style,
      }}
    />
  ),
  Mark: ({ size = 32, style }: { size?: number; style?: React.CSSProperties }) => (
    <img
      src="/assets/pixa-mark.png"
      alt="Pixa"
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        ...style,
      }}
    />
  ),
  Wordmark: ({
    height = 26,
    style,
  }: {
    height?: number;
    style?: React.CSSProperties;
  }) => (
    <img
      src="/assets/white%20logo.png"
      alt="Pixa"
      style={{ height, width: "auto", display: "block", ...style }}
    />
  ),
};

export type IconKey = keyof typeof Icons;
