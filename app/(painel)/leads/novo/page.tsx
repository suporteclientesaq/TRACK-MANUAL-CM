import Link from "next/link";
import { listClients } from "@/lib/store";
import { LeadForm } from "../LeadForm";

export default async function NewLeadPage() {
  const clients = await listClients();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Adicionar Lead à Mão</h1>
          <p className="muted small">
            Copie os dados da tela do contato na Leona. Sem ctwa_clid o Meta casa só pelo telefone, com atribuição mais
            fraca.
          </p>
        </div>
        <Link className="btn" href="/">
          Voltar
        </Link>
      </div>
      <div className="card">
        {clients.length === 0 ? (
          <p>
            Cadastre um cliente antes de adicionar leads. <Link href="/clientes/novo">Cadastrar Cliente</Link>
          </p>
        ) : (
          <LeadForm clients={clients} />
        )}
      </div>
    </>
  );
}
