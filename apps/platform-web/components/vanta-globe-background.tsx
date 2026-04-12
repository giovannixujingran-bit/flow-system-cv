"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Script from "next/script";

type GlobeOptions = {
  el: HTMLElement;
  mouseControls: boolean;
  touchControls: boolean;
  gyroControls: boolean;
  minHeight: number;
  minWidth: number;
  scale: number;
  scaleMobile: number;
  backgroundColor: number;
  color: number;
  color2: number;
  size: number;
};

type GlobeAppearance = Pick<GlobeOptions, "backgroundColor" | "color" | "color2" | "size">;

type VantaEffect = {
  destroy?: () => void;
};

type VantaGlobeBackgroundProps = {
  className?: string | undefined;
  children?: ReactNode | undefined;
  appearance?: Partial<GlobeAppearance> | undefined;
};

declare global {
  interface Window {
    THREE?: unknown;
    VANTA?: {
      GLOBE?: (options: GlobeOptions) => VantaEffect;
    };
  }
}

const THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js";
const VANTA_GLOBE_CDN = "https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.globe.min.js";
const DEFAULT_APPEARANCE: GlobeAppearance = {
  backgroundColor: 0x23153c,
  color: 0xff3f81,
  color2: 0xffffff,
  size: 1,
};

export function VantaGlobeBackground({
  className,
  children,
  appearance,
}: VantaGlobeBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectRef = useRef<VantaEffect | null>(null);
  const [threeReady, setThreeReady] = useState(false);
  const [vantaReady, setVantaReady] = useState(false);
  const backgroundColor = appearance?.backgroundColor ?? DEFAULT_APPEARANCE.backgroundColor;
  const color = appearance?.color ?? DEFAULT_APPEARANCE.color;
  const color2 = appearance?.color2 ?? DEFAULT_APPEARANCE.color2;
  const size = appearance?.size ?? DEFAULT_APPEARANCE.size;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.THREE) {
      setThreeReady(true);
    }
    if (window.VANTA?.GLOBE) {
      setVantaReady(true);
    }
  }, []);

  useEffect(() => {
    if (!threeReady || !vantaReady || !containerRef.current || effectRef.current) {
      return;
    }

    const createGlobe = window.VANTA?.GLOBE;
    if (!createGlobe) {
      return;
    }

    effectRef.current = createGlobe({
      el: containerRef.current,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      scaleMobile: 1,
      backgroundColor,
      color,
      color2,
      size,
    });

    return () => {
      effectRef.current?.destroy?.();
      effectRef.current = null;
    };
  }, [backgroundColor, color, color2, size, threeReady, vantaReady]);

  return (
    <>
      <Script
        id="vanta-three-r134"
        src={THREE_CDN}
        strategy="afterInteractive"
        onReady={() => {
          setThreeReady(true);
        }}
      />
      {threeReady ? (
        <Script
          id="vanta-globe"
          src={VANTA_GLOBE_CDN}
          strategy="afterInteractive"
          onReady={() => {
            setVantaReady(true);
          }}
        />
      ) : null}
      <div className={className} ref={containerRef}>
        {children}
      </div>
    </>
  );
}
