import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { listClients, setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { AppShell } from "./AppShell";

export const dynamic = "force-dynamic";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const problem = await setupProblem();
  if (problem)
    return (
      <StorageProblem
        message={problem.message}
        database={problem.database}
        sql={problem.sql}
      />
    );
  await requireAuth();
  const clients = (await listClients()).map(({ id, name }) => ({ id, name }));
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return (
    <Suspense fallback={null}>
      <AppShell clients={clients} dateLabel={dateLabel}>
        {children}
      </AppShell>
    </Suspense>
  );
}
