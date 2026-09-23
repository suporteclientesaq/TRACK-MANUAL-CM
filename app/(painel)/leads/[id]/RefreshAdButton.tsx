"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { refreshAdAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RefreshAdButton({ leadId, hasData }: { leadId: string; hasData: boolean }) {
  const [state, action, pending] = useActionState(refreshAdAction, { error: null });
  return (
    <form action={action}>
      <input type="hidden" name="lead_id" value={leadId} />
      {state.error && <div className="note note-err">{state.error}</div>}
      <Button variant="outline" size="sm" type="submit" disabled={pending}>
        <RefreshCw className={pending ? "animate-spin" : undefined} />
        {pending ? "Buscando no Meta…" : hasData ? "Atualizar Dados do Meta" : "Puxar Dados do Meta"}
      </Button>
    </form>
  );
}
