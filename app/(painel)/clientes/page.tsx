import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listClients } from "@/lib/store";

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted small">Cada cliente tem o próprio pixel, tokens e Página. Comece com o seu.</p>
        </div>
        <Button asChild>
          <Link href="/clientes/novo">
            <Plus />
            Cadastrar Cliente
          </Link>
        </Button>
      </div>

      <div className="card table-wrap">
        {clients.length === 0 ? (
          <p className="muted">Nenhum cliente cadastrado.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Pixel</th>
                <th>Envio</th>
                <th>Leitura dos Anúncios</th>
                <th>Modo</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clientes/${c.id}`}>
                      <strong>{c.name}</strong>
                    </Link>
                  </td>
                  <td className="mono">{c.pixel_id || "—"}</td>
                  <td>
                    {c.pixel_id && c.capi_token_enc && (c.page_id || c.waba_id) ? (
                      <span className="badge badge-ok">Pronto</span>
                    ) : (
                      <span className="badge badge-warn">Falta Configurar</span>
                    )}
                  </td>
                  <td>
                    {c.marketing_token_enc ? (
                      <span className="badge badge-ok">Pronto</span>
                    ) : (
                      <span className="badge badge-muted">Sem Token</span>
                    )}
                  </td>
                  <td>
                    {c.test_event_code ? (
                      <span className="badge badge-warn">Teste</span>
                    ) : (
                      <span className="badge badge-ok">Produção</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
