"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function WhatsAppHeaderBadge() {
  const [status, setStatus] = useState<{ online: boolean; count: number } | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/whatsapp/live-status", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setStatus({ online: !!json.online, count: json.count || 0 });
      }
    } catch {
      // silencioso
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  return (
    <Link
      href="/whatsapp"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        borderRadius: "999px",
        background: status.online ? "rgba(52, 199, 123, 0.12)" : "rgba(227, 167, 47, 0.12)",
        border: `1px solid ${status.online ? "rgba(52, 199, 123, 0.35)" : "rgba(227, 167, 47, 0.35)"}`,
        color: status.online ? "#34c77b" : "#e3a72f",
        fontSize: "11px",
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "all 0.2s ease",
      }}
      title={
        status.online
          ? `${status.count} WhatsApp conectado(s) e recebendo leads`
          : "WhatsApp desconectado. Clique para escanear o QR Code."
      }
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: status.online ? "#34c77b" : "#e3a72f",
          boxShadow: status.online ? "0 0 8px #34c77b" : "none",
          display: "inline-block",
        }}
      />
      {status.online ? "WhatsApp Online" : "WhatsApp Offline"}
    </Link>
  );
}
