import Link from "next/link";
import { listClients } from "@/lib/store";
import { ImportForm } from "./ImportForm";

export default async function ImportPage() {
  const clients = await listClients();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Importar Leads da Leona</h1>
          <p className="muted small">Aceita o CSV exportado da Leona ou qualquer planilha que tenha uma coluna de telefone.</p>
        </div>
        <Link className="btn" href="/">
          Voltar
        </Link>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Como Exportar na Leona</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Abra a página de <strong>Contatos</strong> na Leona.</li>
            <li>Clique em <strong>Exportar</strong>. Se houver escolha de campos, inclua os campos de anúncio: CTWA Click ID, Source ID, Source URL, Thumbnail URL e Media URL.</li>
            <li>Quando o arquivo ficar pronto, baixe o CSV.</li>
            <li>Escolha o arquivo aqui e clique em Importar.</li>
          </ol>
          <p className="muted small" style={{ marginTop: 12 }}>
            Pode importar o mesmo arquivo quantas vezes quiser: quem já existe é atualizado pelo telefone, e um dado em
            branco no arquivo nunca apaga o que já estava salvo. Cidade, estado e e-mail corrigidos aqui no painel são
            mantidos.
          </p>
        </div>
        <div className="card">
          <h2>Arquivo</h2>
          {clients.length === 0 ? (
            <p>
              Cadastre um cliente antes de importar. <Link href="/clientes/novo">Cadastrar Cliente</Link>
            </p>
          ) : (
            <ImportForm clients={clients} />
          )}
        </div>
      </div>
    </>
  );
}
