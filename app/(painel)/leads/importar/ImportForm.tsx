"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importCsvAction, type ImportState } from "@/app/actions";
import type { Client } from "@/lib/types";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  phone: "Telefone",
  email: "E-mail",
  city: "Cidade",
  state: "Estado",
  zip: "CEP",
  ctwa_clid: "CTWA Click ID",
  source_id: "ID de Origem",
  source_url: "URL de Origem",
  source_type: "Tipo de Origem",
  thumbnail_url: "URL da Miniatura",
  media_url: "URL da Mídia",
  headline: "Título do Anúncio",
};

export function ImportForm({ clients }: { clients: Pick<Client, "id" | "name">[] }) {
  const initial: ImportState = { error: null, result: null };
  const [state, action, pending] = useActionState(importCsvAction, initial);
  const r = state.result;

  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      {r && (
        <div className={`note ${r.skipped > 0 && r.created + r.updated === 0 ? "note-err" : "note-ok"}`}>
          <strong>
            {r.total} linha(s) lida(s): {r.created} lead(s) novo(s), {r.updated} atualizado(s), {r.skipped} ignorado(s).
          </strong>
          <div className="small" style={{ marginTop: 6 }}>
            Colunas reconhecidas: {r.mapped.map((m) => FIELD_LABEL[m] || m).join(", ")}.
            {r.ignored.length > 0 && <> Colunas ignoradas: {r.ignored.join(", ")}.</>}
          </div>
          {r.problems.length > 0 && (
            <ul>
              {r.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {r.skipped > r.problems.length && <li>… e mais {r.skipped - r.problems.length} linha(s) sem telefone.</li>}
            </ul>
          )}
          <div style={{ marginTop: 10 }}>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Ver os Leads</Link>
            </Button>
          </div>
        </div>
      )}

      {clients.length > 1 ? (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="client_id">Cliente</label>
          <select id="client_id" name="client_id" defaultValue={clients[0].id} required>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="client_id" value={clients[0].id} />
      )}

      <label htmlFor="file">Arquivo CSV</label>
      <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" required />
      <div className="hint">Separado por vírgula ou ponto e vírgula; a primeira linha precisa ter os nomes das colunas.</div>

      <div className="actions">
        <Button type="submit" disabled={pending}>
          <Upload />
          {pending ? "Importando…" : "Importar"}
        </Button>
      </div>
    </form>
  );
}
