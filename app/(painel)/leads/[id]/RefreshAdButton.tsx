"use client";

import { useActionState } from "react";
import { refreshAdAction } from "@/app/actions";

export function RefreshAdButton({ leadId, hasData }: { leadId: string; hasData: boolean }) {
  const [state, action, pending] = useActionState(refreshAdAction, { error: null });
  return (
    <form action={action}>
      <input type="hidden" name="lead_id" value={leadId} />
      {state.error && <div className="note note-err">{state.error}</div>}
      <button className="btn btn-small" disabled={pending}>
        {pending ? "Buscando no Meta…" : hasData ? "Atualizar Dados do Meta" : "Puxar Dados do Meta"}
      </button>
    </form>
  );
}
