"use client";

import { useActionState } from "react";
import { loginAction, setupPasswordAction } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <div className="actions">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupPasswordAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      <label htmlFor="password">Nova Senha</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required />
      <label htmlFor="confirm" style={{ marginTop: 10 }}>
        Repita a Senha
      </label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={6} required />
      <div className="actions">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Criando…" : "Criar Senha e Entrar"}
        </button>
      </div>
    </form>
  );
}
