import Link from "next/link";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { requireAuth } from "@/lib/auth";
import { setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { Logo } from "@/app/Logo";
import { Button } from "@/components/ui/button";
import { PanelNav } from "./PanelNav";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const problem = await setupProblem();
  if (problem) return <StorageProblem message={problem.message} database={problem.database} sql={problem.sql} />;
  await requireAuth();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <Logo size={22} />
          Track Manual
        </Link>
        <PanelNav />
        <div className="topbar-right">
          <form action={logoutAction}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut />
              Sair
            </Button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
