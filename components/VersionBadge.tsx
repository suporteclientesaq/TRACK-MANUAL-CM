"use client";

import { useEffect, useState } from "react";

const VERSION = "2.5.0";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(d: Date) {
  const dia = pad(d.getDate());
  const mes = pad(d.getMonth() + 1);
  const ano = d.getFullYear();
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${dia}/${mes}/${ano} ${h}:${min}`;
}

export function VersionBadge() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      title={`Track Manual v${VERSION}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "10px",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: "6px",
        background: "rgba(123, 57, 252, 0.18)",
        color: "#b394ff",
        marginLeft: "6px",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      v{VERSION}
      {now && (
        <>
          <span style={{ opacity: 0.5, margin: "0 1px" }}>·</span>
          <span style={{ fontWeight: 500, color: "#c9b8ff" }}>
            {formatDateTime(now)}
          </span>
        </>
      )}
    </span>
  );
}
