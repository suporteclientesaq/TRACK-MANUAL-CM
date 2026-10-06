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
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      startTransition(async () => {
        const res = await importFromTxtAction(clientId, text);
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
    <div style={{ marginBottom: 24 }}>
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
          padding: "28px 20px",
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
        <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
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
            <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
              Arrastar e soltar proposta (.txt)
            </p>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
              ou clique para selecionar o arquivo
            </p>
          </>
        )}
      </div>

      {result && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            borderRadius: 8,
            background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${result.ok ? "#22c55e" : "#ef4444"}`,
            fontSize: 14,
          }}
        >
          {result.ok ? (
            <span style={{ color: "#16a34a" }}>
              ✅ Lead importado com sucesso!{" "}
              {result.name && <strong>{result.name}</strong>}
              {result.phone && <> · {result.phone}</>}
            </span>
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
