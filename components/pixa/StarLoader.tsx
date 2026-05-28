"use client";

import Lottie from "lottie-react";
import animationData from "@/public/assets/Star Loader 2.json";
import { useCallback, useId, useRef } from "react";

type Props = {
  /** Visible box size in px */
  size?: number;
  /** Zoom into the animation (the asset has large empty margins) */
  scale?: number;
  className?: string;
  /** White (default) or brand gradient */
  tint?: "white" | "gradient";
};

const GRADIENT_STOPS = [
  ["0%", "#3d4bff"],
  ["35%", "#b040e0"],
  ["65%", "#ff3d8b"],
  ["100%", "#ff8a47"],
] as const;

function applySvgGradient(container: HTMLElement | null, gradientId: string) {
  const svg = container?.querySelector("svg");
  if (!svg) return;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.prepend(defs);
  }

  if (!defs.querySelector(`#${CSS.escape(gradientId)}`)) {
    const box = svg.viewBox.baseVal;
    const grad = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "linearGradient"
    );
    grad.setAttribute("id", gradientId);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", String(box.x));
    grad.setAttribute("y1", String(box.y));
    grad.setAttribute("x2", String(box.x + box.width));
    grad.setAttribute("y2", String(box.y + box.height));

    for (const [offset, color] of GRADIENT_STOPS) {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
  }

  svg
    .querySelectorAll("path, ellipse, circle, rect, polygon")
    .forEach((el) => {
      const fill = `url(#${gradientId})`;
      el.setAttribute("fill", fill);
      if (el instanceof SVGElement) {
        el.style.fill = fill;
      }
    });
}

export function StarLoader({
  size = 28,
  scale = 3,
  className,
  tint = "white",
}: Props) {
  const renderSize = size * scale;
  const gradientId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLSpanElement>(null);

  const outerStyle: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  const lottieStyle: React.CSSProperties = {
    width: renderSize,
    height: renderSize,
    background: "transparent",
  };

  const paintGradient = useCallback(() => {
    applySvgGradient(containerRef.current, gradientId);
  }, [gradientId]);

  if (tint === "gradient") {
    return (
      <span
        ref={containerRef}
        className={className}
        aria-hidden="true"
        style={outerStyle}
      >
        <Lottie
          animationData={animationData}
          loop
          onDOMLoaded={paintGradient}
          onEnterFrame={paintGradient}
          style={lottieStyle}
        />
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true" style={outerStyle}>
      <Lottie
        animationData={animationData}
        loop
        style={{
          ...lottieStyle,
          filter: "brightness(0) invert(1)",
        }}
      />
    </span>
  );
}
