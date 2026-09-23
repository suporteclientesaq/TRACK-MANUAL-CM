import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { hasPassword } from "@/lib/config";
import { setupProblem } from "@/lib/store";
import { StorageProblem } from "@/app/StorageProblem";
import { Logo } from "@/app/Logo";
import { EntrarButton } from "./EntrarButton";
import { Hero } from "./Hero";
import { LoginForm, SetupForm } from "./LoginForm";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Confira antes de enviar",
    text: "Você vê exatamente o que vai para o Meta: evento, valor, ctwa_clid, telefone e dados com hash. Só depois aparece o botão de enviar.",
  },
  {
    title: "Leads direto da Leona",
    text: "O bloco de Integração da Leona manda nome, telefone e o clique do anúncio na hora em que o contato chega. Os antigos entram por CSV.",
  },
  {
    title: "Histórico com resposta do Meta",
    text: "Cada envio guarda o corpo enviado, o fbtrace_id e a resposta. Deu erro? Reenvia com o mesmo event_id, sem contar em dobro.",
  },
  {
    title: "Vários clientes",
    text: "Cada cliente tem pixel, token, Página e endereço de entrada próprios. Modo de teste por cliente antes de ir para produção.",
  },
];

const STEPS = [
  { n: "1", title: "Cadastre o cliente", text: "Pixel, token da API de Conversões, ID da Página e o código de Eventos de Teste." },
  { n: "2", title: "Ligue a Leona", text: "Copie o endereço e o corpo mostrados no painel para o bloco de Integração do fluxo." },
  { n: "3", title: "Confira e envie", text: "Abra o lead, escolha Compra, informe o valor, confira o evento e clique em enviar." },
];

export default async function LoginPage() {
  const problem = await setupProblem();
  if (problem) return <StorageProblem message={problem.message} database={problem.database} sql={problem.sql} />;
  const setup = !(await hasPassword());
  if (!setup && (await isLoggedIn())) redirect("/");

  return (
    <main className="landing">
      <Hero setup={setup} />

      <section id="entrar" className="landing-section landing-entrar">
        <div className="glass-card">
          <div className="flex items-center gap-2">
            <Logo size={24} className="text-brand" />
            <span className="font-ui text-[13px] font-semibold uppercase tracking-[1px] text-white/60">Track Manual</span>
          </div>
          <h2 className="font-display text-[34px] font-normal leading-[1.1] text-white">{setup ? "Primeiro acesso" : "Entrar no painel"}</h2>
          <p className="muted small">
            {setup
              ? "Crie a senha que você vai usar para entrar no painel. Ela fica guardada com hash, nunca em texto."
              : "Entre com a senha do painel."}
          </p>
          {setup ? <SetupForm /> : <LoginForm />}
        </div>
      </section>

      <section id="recursos" className="landing-section">
        <div className="landing-inner">
          <p className="landing-kicker">Recursos</p>
          <h2 className="landing-title">
            Tudo o que a Leona não faz <em>e</em> o Meta exige
          </h2>
          <div className="landing-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-card">
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="landing-section landing-alt">
        <div className="landing-inner">
          <p className="landing-kicker">Como funciona</p>
          <h2 className="landing-title">Três passos, nenhuma surpresa</h2>
          <div className="landing-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="landing-step">
                <span className="landing-step-n">{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <EntrarButton label={setup ? "Criar Minha Senha" : "Acessar o Painel"} />
          </div>
        </div>
      </section>

      <footer id="suporte" className="landing-footer">
        <div className="landing-inner flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 text-white">
            <Logo size={22} />
            <span className="font-ui text-[15px] font-bold">Track Manual</span>
          </div>
          <p className="muted small">
            Suporte: o passo a passo completo está no README do projeto. Problemas de conexão com o banco aparecem nesta
            mesma tela, já com a explicação.
          </p>
          <p className="muted small">Continental MKT · painel de uso interno</p>
        </div>
      </footer>
    </main>
  );
}
