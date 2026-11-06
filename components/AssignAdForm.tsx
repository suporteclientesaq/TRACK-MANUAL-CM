"use client";

import { useState, useTransition } from "react";
import { assignLeadAdAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, CheckCircle2 } from "lucide-react";

interface AssignAdFormProps {
  leadId: string;
  currentSourceId?: string | null;
}

export function AssignAdForm({ leadId, currentSourceId }: AssignAdFormProps) {
  const [adId, setAdId] = useState(currentSourceId || "");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adId.trim()) return;

    startTransition(async () => {
      setStatus(null);
      const res = await assignLeadAdAction(leadId, adId);
      setStatus({ ok: res.ok, msg: res.message });
      if (res.ok) {
        setTimeout(() => setIsOpen(false), 2000);
      }
    });
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      {!isOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          style={{ width: "100%", fontSize: "12px", display: "flex", gap: "6px" }}
        >
          <Link2 size={14} />
          {currentSourceId ? "Alterar Anúncio / Campanha" : "Vincular a um Anúncio (Manual)"}
        </Button>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#b394ff" }}>
            ID do Anúncio no Meta (ad_id)
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              required
              placeholder="Ex: 120247299656290265"
              value={adId}
              onChange={(e) => setAdId(e.target.value)}
              disabled={isPending}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            />
            <Button type="submit" size="sm" disabled={isPending || !adId.trim()}>
              {isPending ? <Loader2 size={14} className="animate-spin" /> : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
          <p className="muted small" style={{ margin: "2px 0 0 0", fontSize: "11px" }}>
            O sistema busca os nomes de campanha, conjunto, criativo e gastos no Meta automaticamente.
          </p>

          {status && (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: status.ok ? "rgba(52, 199, 123, 0.15)" : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${status.ok ? "#34c77b" : "#ef4444"}`,
                color: status.ok ? "#34c77b" : "#f87171",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {status.ok && <CheckCircle2 size={14} />}
              {status.msg}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
