"use client";

import { useState } from "react";
import { Download, Loader2, CheckCircle2, XCircle, Link as LinkIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pullCtwaFromPhoneAction, setLeadAdAction, setLeadCtwaAction } from "@/app/actions";

interface PullCtwaButtonProps {
  leadId: string;
  hasCtwa: boolean;
}

export function PullCtwaButton({ leadId, hasCtwa }: PullCtwaButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualAdId, setManualAdId] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const handlePull = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await pullCtwaFromPhoneAction(leadId);
      setResult(res);
      if (res.ok) {
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setResult({ ok: false, message: "Erro ao buscar ctwa_clid: " + String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAdId.trim()) return;
    setSavingManual(true);
    try {
      const isDigitsOnly = /^\d{6,}$/.test(manualAdId.trim());
      const res = isDigitsOnly
        ? await setLeadAdAction(leadId, manualAdId.trim())
        : await setLeadCtwaAction(leadId, manualAdId.trim());
      setResult(res);
      if (res.ok) {
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setResult({ ok: false, message: "Erro ao vincular: " + String(e) });
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePull}
          disabled={loading}
          style={{
            borderColor: hasCtwa ? "rgba(52, 199, 123, 0.5)" : "rgba(123, 57, 252, 0.5)",
            color: hasCtwa ? "#34c77b" : "#b394ff",
          }}
          title="Tentar recuperar ctwa_clid ou anúncio dos dados existentes do WhatsApp"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : hasCtwa ? (
            <RefreshCw size={14} />
          ) : (
            <Download size={14} />
          )}
          {hasCtwa ? "Atualizar / Puxar CTWA" : "Puxar ctwa_clid"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowManual(!showManual)}
          style={{ fontSize: "11px", color: "#9a92ad" }}
        >
          <LinkIcon size={12} style={{ marginRight: 4 }} />
          {showManual ? "Fechar" : "Vincular Anúncio Manual"}
        </Button>
      </div>

      {showManual && (
        <form
          onSubmit={handleSaveManual}
          style={{
            display: "flex",
            gap: "6px",
            background: "rgba(255,255,255,0.03)",
            padding: "8px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <input
            type="text"
            placeholder="Digite o ID do Anúncio (ex: 12023456789) ou token CTWA"
            value={manualAdId}
            onChange={(e) => setManualAdId(e.target.value)}
            style={{
              flex: 1,
              padding: "6px 10px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "#fff",
              fontSize: "12px",
            }}
          />
          <Button type="submit" size="sm" disabled={savingManual || !manualAdId.trim()}>
            {savingManual ? <Loader2 size={12} className="animate-spin" /> : "Vincular"}
          </Button>
        </form>
      )}

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
