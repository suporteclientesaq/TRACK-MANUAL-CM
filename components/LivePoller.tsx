"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface LivePollerProps {
  intervalMs?: number;
  label?: string;
}

export function LivePoller({ intervalMs = 7000, label = "TEMPO REAL ATIVO" }: LivePollerProps) {
  const router = useRouter();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setPulse(true);
      router.refresh();
      setTimeout(() => setPulse(false), 800);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "999px",
        background: "rgba(52, 199, 123, 0.1)",
        border: "1px solid rgba(52, 199, 123, 0.35)",
        color: "#34c77b",
        fontSize: "11px",
        fontWeight: 700,
        userSelect: "none",
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "#34c77b",
          boxShadow: pulse ? "0 0 12px #34c77b, 0 0 20px #34c77b" : "0 0 4px rgba(52, 199, 123, 0.6)",
          transition: "box-shadow 0.3s ease",
        }}
      />
      <span>{label}</span>
    </div>
  );
}
