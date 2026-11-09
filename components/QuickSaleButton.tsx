import Link from "next/link";
import { Wallet } from "lucide-react";

interface QuickSaleButtonProps {
  leadId: string;
  leadName?: string | null;
  leadPhone?: string | null;
  notes?: string | null;
}

/** Every entry point uses the same currency, preview and duplicate checks. */
export function QuickSaleButton({ leadId }: QuickSaleButtonProps) {
  return (
    <Link
      href={`/leads/${leadId}#conversao`}
      className="btn btn-secondary"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 9px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        color: "var(--brand)",
        fontSize: 11,
      }}
    >
      <Wallet size={13} />
      Conferir venda
    </Link>
  );
}
