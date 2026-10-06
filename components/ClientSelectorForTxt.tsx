"use client";

import { useState } from "react";
import { TxtDropZone } from "./TxtDropZone";

interface Client {
  id: string;
  name: string;
}

interface ClientSelectorForTxtProps {
  clients: Client[];
  defaultClientId: string;
}

export function ClientSelectorForTxt({ clients, defaultClientId }: ClientSelectorForTxtProps) {
  const [clientId, setClientId] = useState(defaultClientId || clients[0]?.id || "");
  const [lastImportedId, setLastImportedId] = useState<string | null>(null);

  if (clients.length === 0) return null;

  return (
    <div>
      {clients.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="txt-client-select"
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Cliente que vai receber o lead:
          </label>
          <select
            id="txt-client-select"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setLastImportedId(null);
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontSize: 14,
              background: "var(--bg, #fff)",
              color: "inherit",
              cursor: "pointer",
              minWidth: 200,
            }}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <TxtDropZone
        clientId={clientId}
        onImported={(leadId) => {
          setLastImportedId(leadId);
        }}
      />

      {lastImportedId && (
        <div style={{ marginTop: -8, marginBottom: 8 }}>
          <a
            href={`/leads/${lastImportedId}`}
            style={{ fontSize: 13, color: "#4f46e5", textDecoration: "underline" }}
          >
            Ver lead importado →
          </a>
        </div>
      )}
    </div>
  );
}
