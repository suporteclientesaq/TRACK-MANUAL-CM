"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export function WhatsAppHeaderBadge() {
  const [status, setStatus] = useState<{
    online: boolean;
    count: number;
    unknown: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let pending = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/whatsapp/live-status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Status indisponível");
        const json = await response.json();
        if (active)
          setStatus({
            online: !!json.online,
            count: json.count || 0,
            unknown: json.state === "unknown",
          });
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          setStatus((previous) => ({
            ...previous,
            online: previous?.online || false,
            count: previous?.count || 0,
            unknown: true,
          }));
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const label = !status
    ? "Verificando canais"
    : status.unknown
      ? "Status indisponível"
      : status.online
        ? "WhatsApp conectado"
        : "Conectar WhatsApp";
  const color =
    status?.online && !status.unknown ? "var(--ok)" : "var(--text-muted)";
  return (
    <Link
      href="/whatsapp"
      title={status?.online ? status.count + " canal(is) conectado(s)" : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 9px",
        borderRadius: 20,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color,
        fontSize: 10,
        fontWeight: 500,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          display: "inline-block",
          borderRadius: "50%",
          background: color,
        }}
      />
      {label}
    </Link>
  );
}
