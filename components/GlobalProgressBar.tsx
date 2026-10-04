"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function ProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [isPending] = useTransition();

  // Monitora mudanças de rota
  useEffect(() => {
    // Quando a rota termina de carregar, vai para 100% e some
    if (visible) {
      setProgress(100);
      const timer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [pathname, searchParams]);

  // Intercepta cliques em links internos e envios de formulário para iniciar a barra
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (
        href &&
        href.startsWith("/") &&
        !href.startsWith("#") &&
        target.target !== "_blank" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        startProgress();
      }
    };

    const handleFormSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      // Não intercepta se for target _blank
      if (form.target === "_blank") return;
      startProgress();
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("submit", handleFormSubmit);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("submit", handleFormSubmit);
    };
  }, []);

  const startProgress = () => {
    setVisible(true);
    setProgress(12);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) {
          clearInterval(interval);
          return 92;
        }
        // Incremento com desaceleração realista
        const diff = 92 - prev;
        const step = Math.max(1, Math.floor(diff * 0.15));
        return Math.min(prev + step, 92);
      });
    }, 120);

    // Timeout de segurança para não travar
    setTimeout(() => {
      clearInterval(interval);
    }, 8000);
  };

  if (!visible && progress === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        pointerEvents: "none",
        transition: "opacity 300ms ease",
        opacity: visible ? 1 : 0,
      }}
      aria-hidden="true"
    >
      {/* Linha de progresso com gradiente e brilho neon */}
      <div
        style={{
          height: "3.5px",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #7b39fc 0%, #34c77b 50%, #00f2fe 100%)",
          boxShadow: "0 0 14px rgba(52, 199, 123, 0.7), 0 0 6px rgba(123, 57, 252, 0.9)",
          transition: "width 220ms cubic-bezier(0.1, 0.9, 0.2, 1)",
          position: "relative",
        }}
      >
        {/* Ponto de luz na ponta da barra */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "-2px",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#ffffff",
            boxShadow: "0 0 10px #ffffff, 0 0 18px #34c77b",
          }}
        />
      </div>

      {/* Pill com contador numérico 1% - 100% no canto superior direito */}
      <div
        style={{
          position: "fixed",
          top: "10px",
          right: "14px",
          padding: "3px 9px",
          fontSize: "11px",
          fontWeight: 700,
          fontFamily: "var(--font-mono, monospace)",
          borderRadius: "999px",
          background: "rgba(15, 13, 21, 0.85)",
          color: progress === 100 ? "#34c77b" : "#ebe8f2",
          border: `1px solid ${progress === 100 ? "rgba(52, 199, 123, 0.4)" : "rgba(123, 57, 252, 0.35)"}`,
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          transition: "all 200ms ease",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: progress === 100 ? "#34c77b" : "#7b39fc",
            boxShadow: `0 0 6px ${progress === 100 ? "#34c77b" : "#7b39fc"}`,
          }}
        />
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

export function GlobalProgressBar() {
  return (
    <Suspense fallback={null}>
      <ProgressBarInner />
    </Suspense>
  );
}
