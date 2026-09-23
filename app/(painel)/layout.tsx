import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { requireAuth } from "@/lib/auth";
import { storageProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const problem = storageProblem();
  if (problem) return <StorageProblem message={problem} />;
  await requireAuth();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          Track Manual
        </Link>
        <nav className="nav">
          <Link href="/">Leads</Link>
          <Link href="/leads/importar">Importar</Link>
          <Link href="/eventos">Eventos Enviados</Link>
          <Link href="/clientes">Clientes</Link>
          <Link href="/configuracoes">Configurações</Link>
        </nav>
        <form action={logoutAction}>
          <button className="btn btn-small">Sair</button>
        </form>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
