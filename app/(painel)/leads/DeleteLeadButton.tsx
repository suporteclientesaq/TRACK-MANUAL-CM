"use client";

import { Trash2 } from "lucide-react";
import { deleteLeadAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Exclui o lead e o histórico dele, depois de confirmar. */
export function DeleteLeadButton({ id, name, back }: { id: string; name: string; back?: string }) {
  return (
    <form
      action={deleteLeadAction}
      onSubmit={(e) => {
        if (!window.confirm(`Excluir "${name}" e todo o histórico de envios dele? Isso não pode ser desfeito.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Excluir ${name}`}
        title="Excluir lead"
      >
        <Trash2 />
      </Button>
    </form>
  );
}
