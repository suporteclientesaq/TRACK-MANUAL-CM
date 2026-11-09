import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { hasPassword } from "@/lib/config";
import { setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { Logo } from "@/app/Logo";
import {
  ArrowUpRight,
  Check,
  GitBranch,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { LoginForm, SetupForm } from "./LoginForm";
import styles from "./Login.module.css";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const problem = await setupProblem();
  if (problem)
    return (
      <StorageProblem
        message={problem.message}
        database={problem.database}
        sql={problem.sql}
      />
    );
  let setup: boolean;
  try {
    setup = !(await hasPassword());
  } catch (error) {
    return (
      <StorageProblem
        message={
          error instanceof Error
            ? error.message
            : "Confira a configuração de acesso."
        }
        database={null}
      />
    );
  }
  if (!setup && (await isLoggedIn())) redirect("/dashboard");
  return (
    <main className={styles.page}>
      <section className={styles.story}>
        <div className={styles.brand}>
          <Logo size={28} />
          <span>
            track<strong>manual</strong>
          </span>
          <small>FLOW</small>
        </div>
        <div className={styles.storyMain}>
          <span className={styles.kicker}>
            <Sparkles size={13} />
            RELACIONAMENTOS EM MOVIMENTO
          </span>
          <h1>
            Um bom atendimento
            <br />
            muda <em>tudo.</em>
          </h1>
          <p>
            Conecte conversas, organize oportunidades e acompanhe cada
            resultado. Tudo no mesmo lugar.
          </p>
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewTop}>
              <span />
              <span />
              <span />
              <strong>Seu workspace, conectado.</strong>
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewRail}>
                <MessageCircle />
                <UsersRound />
                <GitBranch />
              </div>
              <div className={styles.previewChat}>
                <span className={styles.previewDate}>
                  Uma conversa. Muitas possibilidades.
                </span>
                <div className={styles.inbound}>
                  Olá! Vi o anúncio e gostaria de saber mais.
                  <small>09:41</small>
                </div>
                <div className={styles.outbound}>
                  Que bom ter você por aqui! Vamos encontrar a melhor opção para
                  você.
                  <small>
                    09:42 <Check size={10} />
                  </small>
                </div>
                <span className={styles.previewSuccess}>
                  <ShieldCheck size={13} />
                  Contexto preservado. Próximo passo organizado.
                </span>
              </div>
            </div>
          </div>
          <div className={styles.features}>
            <span>
              <Check size={13} />
              Conversas organizadas
            </span>
            <span>
              <Check size={13} />
              Conversões conferidas
            </span>
          </div>
        </div>
        <div className={styles.storyFooter}>
          Menos tarefas soltas. Mais conexões que fazem sentido.
          <span>© {new Date().getFullYear()} Track Manual</span>
        </div>
      </section>
      <section className={styles.entry}>
        <div className={styles.topNote}>
          <ShieldCheck size={14} />
          Seu workspace. Seu acesso.
        </div>
        <div className={styles.formCard}>
          <span className={styles.formIcon}>
            <Logo size={27} />
          </span>
          <span className={styles.smallKicker}>
            {setup ? "PRIMEIRO ACESSO" : "BOM TER VOCÊ DE VOLTA"}
          </span>
          <h2>
            {setup
              ? "Seu próximo capítulo começa aqui."
              : "Bem-vindo ao seu workspace."}
          </h2>
          <p>
            {setup
              ? "Crie a senha de administrador para começar a organizar seus atendimentos."
              : "Entre com sua senha para continuar de onde parou."}
          </p>
          {setup ? <SetupForm /> : <LoginForm />}
          <div className={styles.accessNote}>
            <ShieldCheck size={13} />
            <span>
              Acesso restrito ao administrador.
              <br />
              Use uma senha exclusiva para este painel.
            </span>
          </div>
        </div>
        <footer className={styles.entryFooter}>
          <span>Track Manual · atendimento e conversões</span>
          <span>
            v3.0 · Flow
            <ArrowUpRight size={11} />
          </span>
        </footer>
      </section>
    </main>
  );
}
