"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setLoading(false);
    if (timeout.current) clearTimeout(timeout.current);
  }, [pathname, search]);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!anchor || anchor.target === "_blank" || anchor.download) return;
      const url = new URL(anchor.href, location.href);
      if (
        url.origin !== location.origin ||
        url.pathname + url.search === location.pathname + location.search
      )
        return;
      setLoading(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setLoading(false), 8000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);
  return loading ? (
    <div
      role="progressbar"
      aria-label="Carregando página"
      style={{
        position: "fixed",
        inset: "0 0 auto",
        height: 2,
        zIndex: 9999,
        background: "var(--brand-soft)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "35%",
          background: "var(--brand)",
          animation: "track-navigation 1.2s ease-in-out infinite",
        }}
      />
      <style>
        {
          "@keyframes track-navigation{from{transform:translateX(-100%)}to{transform:translateX(390%)}}"
        }
      </style>
    </div>
  ) : null;
}
export function GlobalProgressBar() {
  return (
    <Suspense fallback={null}>
      <NavigationProgress />
    </Suspense>
  );
}
