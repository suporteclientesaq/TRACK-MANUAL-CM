"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendEventAction } from "@/app/actions";
import { MESSAGING_EVENTS } from "@/lib/types";

interface QuickSaleButtonProps {
  leadId: string;
  leadName?: string | null;
  leadPhone?: string | null;
  notes?: string | null;
}

export function QuickSaleButton({ leadId, leadName, leadPhone, notes }: QuickSaleButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [eventName, setEventName] = useState("Purchase");
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Extrai valor de notes se houver (ex: "Investimento: R$ 247,00" -> "247,00")
  const defaultVal = () => {
    if (!notes) return "";
    const m = notes.match(/R\$\s*([\d.,]+)/i) || notes.match(/Investimento:\s*R?\$?\s*([\d.,]+)/i);
    return m ? m[1].trim() : "";
  };

  const defaultContent = () => {
    if (!notes) return "";
    const m = notes.match(/Pacote:\s*([^|]+)/i);
    return m ? m[1].trim() : "";
  };

  const [value, setValue] = useState(defaultVal);
  const [contentName, setContentName] = useState(defaultContent);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value && eventName === "Purchase") {
      setStatusMsg({ ok: false, text: "Informe o valor da venda." });
      return;
    }

    startTransition(async () => {
      setStatusMsg(null);
      try {
        const res = await sendEventAction({
          leadId,
          eventName,
          eventTimeIso: new Date().toISOString(),
          value,
          currency: "BRL",
          contentName,
        });

        if (res.sent) {
          setStatusMsg({ ok: true, text: `✅ Venda de R$ ${value} enviada ao Meta com sucesso!` });
          setTimeout(() => {
            setIsOpen(false);
            setStatusMsg(null);
            router.refresh();
          }, 1200);
        } else {
          setStatusMsg({ ok: false, text: res.message || "Erro ao enviar conversão ao Meta." });
        }
      } catch (err) {
        setStatusMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setStatusMsg(null);
          if (!value) setValue(defaultVal());
          if (!contentName) setContentName(defaultContent());
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 8px",
          borderRadius: "6px",
          background: "rgba(52, 199, 123, 0.12)",
          border: "1px solid rgba(52, 199, 123, 0.35)",
          color: "#34c77b",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
          whiteSpace: "nowrap",
        }}
        title="Registrar Venda e Enviar ao Meta em 1 Clique"
      >
        <span>💰</span> Vender
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setIsOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--surface, #1e1b2e)",
              border: "1px solid rgba(123, 57, 252, 0.3)",
              borderRadius: "14px",
              padding: "24px",
              maxWidth: "420px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
              color: "var(--text, #fff)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#ebe8f2" }}>
                  💰 Registrar Venda no Meta
                </h3>
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#9a92ad" }}>
                  {leadName || "Lead"} {leadPhone && `· ${leadPhone}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isPending && setIsOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9a92ad",
                  fontSize: "18px",
                  cursor: "pointer",
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "#b394ff" }}>
                  Valor da Venda (R$) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="247,00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={isPending}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(123, 57, 252, 0.4)",
                    color: "#fff",
                    fontSize: "16px",
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "#9a92ad" }}>
                  Evento do Meta
                </label>
                <select
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  disabled={isPending}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border, #3a3352)",
                    color: "#fff",
                    fontSize: "13px",
                  }}
                >
                  {MESSAGING_EVENTS.map((ev) => (
                    <option key={ev.value} value={ev.value} style={{ background: "#1e1b2e" }}>
                      {ev.label} ({ev.value})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "#9a92ad" }}>
                  Produto / Pacote (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Panfletagem Digital 18k"
                  value={contentName}
                  onChange={(e) => setContentName(e.target.value)}
                  disabled={isPending}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border, #3a3352)",
                    color: "#fff",
                    fontSize: "13px",
                  }}
                />
              </div>

              {statusMsg && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: statusMsg.ok ? "rgba(52, 199, 123, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    border: `1px solid ${statusMsg.ok ? "#34c77b" : "#ef4444"}`,
                    color: statusMsg.ok ? "#34c77b" : "#f87171",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {statusMsg.text}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "8px",
                    background: "transparent",
                    border: "1px solid var(--border, #3a3352)",
                    color: "#9a92ad",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  style={{
                    flex: 2,
                    padding: "10px",
                    borderRadius: "8px",
                    background: "linear-gradient(90deg, #34c77b 0%, #22a360 100%)",
                    border: "none",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: isPending ? "wait" : "pointer",
                    boxShadow: "0 0 15px rgba(52, 199, 123, 0.35)",
                  }}
                >
                  {isPending ? "Enviando ao Meta…" : "🚀 Enviar Conversão"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
