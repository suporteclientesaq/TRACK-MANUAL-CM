"use client";

import { useRef, useState, useTransition } from "react";
import { importFromTxtAction } from "@/app/actions";

interface TxtDropZoneProps {
  /** ID do cliente que vai receber o lead importado */
  clientId: string;
  /** Callback quando lead for importado com sucesso */
  onImported?: (leadId: string) => void;
}

interface ImportResult {
  ok: boolean;
  leadId?: string;
  name?: string | null;
  phone?: string | null;
  purchaseSent?: boolean;
  value?: number | null;
  error?: string;
}

export function TxtDropZone({ clientId, onImported }: TxtDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function processFile(file: File) {
    if (!file || !file.name.endsWith(".txt")) {
      setResult({ ok: false, error: "Selecione um arquivo .txt" });
      return;
    }
    if (file.size > 1024 * 1024) {
      setResult({ ok: false, error: "Envie um arquivo de até 1 MB." });
      return;
    }
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      startTransition(async () => {
        const res = await importFromTxtAction(clientId, text, false);
        setResult(res);
        if (res.ok && res.leadId) onImported?.(res.leadId);
      });
    };
    reader.readAsText(file, "utf-8");
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() {
    setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <p className="hint">
        Importe a proposta para preencher o contato. A compra será conferida e
        enviada separadamente.
      </p>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "#4f46e5" : "#6b7280"}`,
          borderRadius: 12,
          padding: "24px 20px",
          textAlign: "center",
          cursor: isPending ? "wait" : "pointer",
          background: dragging ? "rgba(79,70,229,0.06)" : "transparent",
          transition: "all 0.2s",
          userSelect: "none",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          style={{ display: "none" }}
          onChange={onInputChange}
        />
        <div style={{ fontSize: 32, marginBottom: 6 }}>📄</div>
        {isPending ? (
          <p style={{ margin: 0, color: "#6b7280" }}>
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: "2px solid #6b7280",
                borderTopColor: "#4f46e5",
                borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
                marginRight: 8,
                verticalAlign: "middle",
              }}
            />
            Importando proposta…
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
              Arrastar e soltar proposta (.txt)
            </p>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>
              ou clique para selecionar o arquivo · até 1 MB
            </p>
          </>
        )}
      </div>

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 8,
            background: result.ok
              ? "rgba(34,197,94,0.1)"
              : "rgba(239,68,68,0.1)",
            border: `1px solid ${result.ok ? "#22c55e" : "#ef4444"}`,
            fontSize: 13,
          }}
        >
          {result.ok ? (
            <div style={{ color: "#16a34a" }}>
              <div>
                ✅ <strong>Lead importado:</strong> {result.name || "Sem Nome"}{" "}
                {result.phone && `(${result.phone})`}
              </div>
              {result.purchaseSent && (
                <div
                  style={{ marginTop: 4, fontWeight: 600, color: "#059669" }}
                >
                  🚀 Venda de R${" "}
                  {Number(result.value || 0)
                    .toFixed(2)
                    .replace(".", ",")}{" "}
                  enviada ao Meta com sucesso via CAPI!
                </div>
              )}
            </div>
          ) : (
            <span style={{ color: "#dc2626" }}>❌ {result.error}</span>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
