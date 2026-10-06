"use client";

import { useState, useTransition } from "react";
import { syncDashboardMetaAction } from "@/app/actions";

interface SyncMetaButtonProps {
  clientId?: string | null;
}

export function SyncMetaButton({ clientId }: SyncMetaButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSync() {
    setResult(null);
    startTransition(async () => {
      const res = await syncDashboardMetaAction(clientId);
      setResult(res);
      // Limpa o resultado após 5s
      setTimeout(() => setResult(null), 5000);
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        onClick={handleSync}
        disabled={isPending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 8,
          border: "1px solid #4f46e5",
          background: isPending ? "rgba(79,70,229,0.1)" : "rgba(79,70,229,0.15)",
          color: "#818cf8",
          fontSize: 13,
          fontWeight: 600,
          cursor: isPending ? "wait" : "pointer",
          transition: "all 0.2s",
        }}
      >
        {isPending ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: 13,
                height: 13,
                border: "2px solid #6b7280",
                borderTopColor: "#818cf8",
                borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
              }}
            />
            Sincronizando Meta…
          </>
        ) : (
          <>
            <span style={{ fontSize: 15 }}>🔄</span>
            Sincronizar Meta
          </>
        )}
      </button>

      {result && (
        <span
          style={{
            fontSize: 12,
            color: result.ok ? "#22c55e" : "#ef4444",
          }}
        >
          {result.ok ? "✅" : "❌"} {result.message}
        </span>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
