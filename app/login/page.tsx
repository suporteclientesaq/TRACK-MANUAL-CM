import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { hasPassword } from "@/lib/config";
import { setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { LoginForm, SetupForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const problem = await setupProblem();
  if (problem) return <StorageProblem message={problem.message} database={problem.database} sql={problem.sql} />;
  const setup = !(await hasPassword());
  if (!setup && (await isLoggedIn())) redirect("/");
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <h1>Track Manual</h1>
        {setup ? (
          <>
            <p className="muted small">
              Primeiro acesso. Crie a senha que você vai usar para entrar no painel. Ela fica guardada só neste
              computador.
            </p>
            <SetupForm />
          </>
        ) : (
          <>
            <p className="muted small">Entre com a senha do painel.</p>
            <LoginForm />
          </>
        )}
      </div>
    </main>
  );
}
