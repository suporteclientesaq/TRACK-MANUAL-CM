import Link from "next/link";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { requireAuth } from "@/lib/auth";
import { setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { Logo } from "@/app/Logo";
import { Button } from "@/components/ui/button";
import { PanelNav } from "./PanelNav";
import { WhatsAppHeaderBadge } from "@/components/WhatsAppHeaderBadge";

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
          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "rgba(123, 57, 252, 0.2)", color: "#b394ff", marginLeft: "4px" }}>
            v2.2
          </span>
        </Link>
        <PanelNav />
        <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <WhatsAppHeaderBadge />
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
