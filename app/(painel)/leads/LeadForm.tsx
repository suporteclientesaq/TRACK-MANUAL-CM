"use client";

import { useActionState } from "react";
import { saveLeadAction } from "@/app/actions";
import type { Client, Lead } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function LeadForm({ clients, lead }: { clients: Pick<Client, "id" | "name">[]; lead?: Lead }) {
  const [state, action, pending] = useActionState(saveLeadAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      {lead && <input type="hidden" name="id" value={lead.id} />}

      <h2>Dados da Pessoa</h2>
      <div className="cols">
        {clients.length > 1 || !lead ? (
          <div>
            <label htmlFor="client_id">Cliente</label>
            <select id="client_id" name="client_id" defaultValue={lead?.client_id || clients[0]?.id} required>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="client_id" value={lead.client_id} />
        )}
        <div>
          <label htmlFor="name">Nome</label>
          <input id="name" name="name" defaultValue={lead?.name || ""} />
        </div>
        <div>
          <label htmlFor="phone">Número (WhatsApp)</label>
          <input id="phone" name="phone" defaultValue={lead?.phone || ""} placeholder="5588999998888" required />
        </div>
        <div>
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" defaultValue={lead?.email || ""} />
        </div>
        <div>
          <label htmlFor="city">Cidade</label>
          <input id="city" name="city" defaultValue={lead?.city || ""} />
        </div>
        <div>
          <label htmlFor="state">Estado (Sigla)</label>
          <input id="state" name="state" maxLength={2} defaultValue={lead?.state || ""} placeholder="CE" />
          {!lead && <div className="hint">Em branco, o painel sugere pelo DDD.</div>}
        </div>
        <div>
          <label htmlFor="zip">CEP</label>
          <input id="zip" name="zip" defaultValue={lead?.zip || ""} />
        </div>
      </div>

      <h2 style={{ marginTop: 18 }}>Origem do Anúncio</h2>
      <div className="cols">
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ctwa_clid">CTWA Click ID (ctwa_clid)</label>
          <input id="ctwa_clid" name="ctwa_clid" className="mono" defaultValue={lead?.ctwa_clid || ""} />
          <div className="hint">É este código que liga a conversão ao clique no anúncio. Cole exatamente como veio.</div>
        </div>
        <div>
          <label htmlFor="source_id">ID de Origem (ID do Anúncio)</label>
          <input id="source_id" name="source_id" defaultValue={lead?.source_id || ""} />
        </div>
        <div>
          <label htmlFor="source_url">URL de Origem</label>
          <input id="source_url" name="source_url" defaultValue={lead?.source_url || ""} />
        </div>
        <div>
          <label htmlFor="thumbnail_url">URL da Miniatura</label>
          <input id="thumbnail_url" name="thumbnail_url" defaultValue={lead?.thumbnail_url || ""} />
        </div>
        <div>
          <label htmlFor="media_url">URL da Mídia</label>
          <input id="media_url" name="media_url" defaultValue={lead?.media_url || ""} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label htmlFor="notes">Anotações</label>
        <textarea id="notes" name="notes" defaultValue={lead?.notes || ""} />
      </div>

      <div className="actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : lead ? "Salvar Alterações" : "Adicionar Lead"}
        </Button>
      </div>
    </form>
  );
}
