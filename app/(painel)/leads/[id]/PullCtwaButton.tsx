"use client";

import { useState } from "react";
import { Download, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pullCtwaFromPhoneAction } from "@/app/actions";

interface PullCtwaButtonProps {
  leadId: string;
  hasCtwa: boolean;
}

export function PullCtwaButton({ leadId, hasCtwa }: PullCtwaButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handlePull = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await pullCtwaFromPhoneAction(leadId);
      setResult(res);
      if (res.ok) {
        // Recarrega a página após 1.5s para mostrar os dados atualizados
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setResult({ ok: false, message: "Erro ao buscar ctwa_clid: " + String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePull}
        disabled={loading || hasCtwa}
        style={{
          borderColor: hasCtwa ? "rgba(52, 199, 123, 0.5)" : "rgba(123, 57, 252, 0.5)",
          color: hasCtwa ? "#34c77b" : "#b394ff",
        }}
        title={hasCtwa ? "Este lead já possui ctwa_clid" : "Tentar recuperar ctwa_clid dos dados existentes"}
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : hasCtwa ? (
          <CheckCircle2 size={14} />
        ) : (
          <Download size={14} />
        )}
        {hasCtwa ? "ctwa_clid já registrado" : "Puxar ctwa_clid"}
      </Button>

      {result && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "6px",
            padding: "8px 10px",
            borderRadius: "8px",
            background: result.ok ? "rgba(52, 199, 123, 0.1)" : "rgba(239, 90, 90, 0.1)",
            border: `1px solid ${result.ok ? "rgba(52, 199, 123, 0.3)" : "rgba(239, 90, 90, 0.3)"}`,
            fontSize: "12px",
            color: result.ok ? "#34c77b" : "#ef9090",
            lineHeight: "1.4",
          }}
        >
          {result.ok ? <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
