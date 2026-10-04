"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";

export interface ProgressStep {
  label: string;
  threshold: number; // Porcentagem em que esse passo é ativado (ex: 25, 55, 85, 100)
}

interface ActionProgressModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title: string;
  steps: ProgressStep[];
  onComplete?: () => void;
  autoCloseMs?: number;
}

/**
 * Modal Animado de Progresso de 1% a 100%
 * Estilo UTMfy com gradiente vivo, contagem percentual em tempo real e passos de execução.
 */
export function ActionProgressModal({
  isOpen,
  onClose,
  title,
  steps,
  onComplete,
  autoCloseMs = 1200,
}: ActionProgressModalProps) {
  const [percent, setPercent] = useState(1);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPercent(1);
      setDone(false);
      return;
    }

    setPercent(3);
    setDone(false);

    const interval = setInterval(() => {
      setPercent((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setDone(true);
          onComplete?.();
          return 100;
        }

        // Simulação de carregamento orgânico e inteligente
        let next = prev;
        if (prev < 30) {
          next += Math.floor(Math.random() * 6) + 3;
        } else if (prev < 70) {
          next += Math.floor(Math.random() * 4) + 2;
        } else if (prev < 90) {
          next += Math.floor(Math.random() * 3) + 1;
        } else {
          next += Math.floor(Math.random() * 2) + 1;
        }
        return Math.min(next, 100);
      });
    }, 85);

    return () => clearInterval(interval);
  }, [isOpen, onComplete]);

  // Fechamento automático suave após chegar em 100%
  useEffect(() => {
    if (done && autoCloseMs > 0 && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseMs);
      return () => clearTimeout(timer);
    }
  }, [done, autoCloseMs, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10, 8, 15, 0.78)",
        backdropFilter: "blur(10px)",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        animation: "fadeIn 200ms ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "linear-gradient(145deg, #181424, #120f1c)",
          border: "1px solid rgba(123, 57, 252, 0.3)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(123, 57, 252, 0.15)",
          padding: "26px",
          color: "#ebe8f2",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow de fundo */}
        <div
          style={{
            position: "absolute",
            top: "-50px",
            right: "-50px",
            width: "140px",
            height: "140px",
            borderRadius: "50%",
            background: done ? "rgba(52, 199, 123, 0.25)" : "rgba(123, 57, 252, 0.25)",
            filter: "blur(40px)",
            pointerEvents: "none",
            transition: "background 500ms ease",
          }}
        />

        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: done ? "rgba(52, 199, 123, 0.15)" : "rgba(123, 57, 252, 0.18)",
                border: `1px solid ${done ? "rgba(52, 199, 123, 0.4)" : "rgba(123, 57, 252, 0.4)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: done ? "#34c77b" : "#b394ff",
              }}
            >
              {done ? <CheckCircle2 size={20} /> : <Loader2 size={19} className="animate-spin" />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{title}</h3>
              <p style={{ margin: 0, fontSize: "12px", color: "#9a92ad" }}>
                {done ? "Operação concluída com sucesso!" : "Processando dados em tempo real…"}
              </p>
            </div>
          </div>
          {onClose && done && (
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#9a92ad",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "6px",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Display do percentual grande (Estilo UTMfy) */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#9a92ad" }}>Progresso Geral</span>
          <span
            style={{
              fontSize: "28px",
              fontWeight: 800,
              fontFamily: "var(--font-mono, monospace)",
              letterSpacing: "-0.5px",
              background: done
                ? "linear-gradient(90deg, #34c77b, #00f2fe)"
                : "linear-gradient(90deg, #b394ff, #34c77b)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {percent}%
          </span>
        </div>

        {/* Barra de progresso com gradiente e animação fluida */}
        <div
          style={{
            width: "100%",
            height: "10px",
            background: "rgba(255, 255, 255, 0.06)",
            borderRadius: "999px",
            overflow: "hidden",
            position: "relative",
            marginBottom: "20px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: done
                ? "linear-gradient(90deg, #34c77b 0%, #00f2fe 100%)"
                : "linear-gradient(90deg, #7b39fc 0%, #34c77b 70%, #00f2fe 100%)",
              borderRadius: "999px",
              transition: "width 90ms ease-out",
              boxShadow: "0 0 12px rgba(52, 199, 123, 0.5)",
            }}
          />
        </div>

        {/* Lista de passos executados */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {steps.map((step, idx) => {
            const isCompleted = percent >= step.threshold;
            const isCurrent =
              percent < step.threshold && (idx === 0 || percent >= steps[idx - 1].threshold);

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "13px",
                  color: isCompleted ? "#ebe8f2" : isCurrent ? "#b394ff" : "#6d6582",
                  transition: "all 200ms ease",
                }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: 700,
                    background: isCompleted
                      ? "#34c77b"
                      : isCurrent
                      ? "rgba(123, 57, 252, 0.3)"
                      : "rgba(255, 255, 255, 0.05)",
                    color: isCompleted ? "#0f0d15" : isCurrent ? "#b394ff" : "#6d6582",
                    border: isCurrent ? "1px solid #7b39fc" : "none",
                  }}
                >
                  {isCompleted ? "✓" : idx + 1}
                </div>
                <span style={{ fontWeight: isCurrent ? 600 : 400 }}>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
