"use client";

import { useState } from "react";

export function CopyBox({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label>{label}</label>
      {multiline ? (
        <pre className="payload" style={{ marginBottom: 6 }}>{value}</pre>
      ) : (
        <div className="copy-row" style={{ marginBottom: 6 }}>
          <input className="mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      <button type="button" className="btn btn-small" onClick={copy}>
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
