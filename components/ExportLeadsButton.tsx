"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportLeadsButtonProps {
  leads: Array<{
    name: string | null;
    phone: string;
    city?: string | null;
    state?: string | null;
    ctwa_clid?: string | null;
    source_id?: string | null;
    headline?: string | null;
    first_seen_at: string;
    clientName?: string;
    hasPurchase?: boolean;
  }>;
}

export function ExportLeadsButton({ leads }: ExportLeadsButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleExport = () => {
    setDownloading(true);
    try {
      const rows: string[] = [];
      rows.push(`"Nome";"Telefone";"Cidade";"Estado";"Rastreio CTWA";"ID Anuncio";"Cliente";"Venda Enviada";"Chegou Em"`);

      for (const l of leads) {
        const ctwaStatus = l.ctwa_clid
          ? l.ctwa_clid.startsWith("ctwa_ad_")
            ? "CTWA (Por Anúncio)"
            : "CTWA (Token Meta)"
          : l.source_id
          ? "CTWA (Por Anúncio)"
          : "Orgânico";

        rows.push(
          [
            `"${(l.name || "Sem Nome").replace(/"/g, '""')}"`,
            `"${l.phone}"`,
            `"${(l.city || "").replace(/"/g, '""')}"`,
            `"${(l.state || "").replace(/"/g, '""')}"`,
            `"${ctwaStatus}"`,
            `"${l.source_id || ""}"`,
            `"${(l.clientName || "").replace(/"/g, '""')}"`,
            `"${l.hasPurchase ? "Sim" : "Não"}"`,
            `"${new Date(l.first_seen_at).toLocaleString("pt-BR")}"`,
          ].join(";")
        );
      }

      const csvContent = "\uFEFF" + rows.join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `leads-track-manual-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={downloading || leads.length === 0}
      title="Baixar lista de leads filtrada em formato CSV (Excel)"
      style={{
        borderColor: "rgba(56, 189, 248, 0.4)",
        color: "#38bdf8",
        background: "rgba(56, 189, 248, 0.08)",
        fontWeight: 600,
        gap: "6px",
      }}
    >
      <Download size={14} />
      Exportar Leads ({leads.length})
    </Button>
  );
}
