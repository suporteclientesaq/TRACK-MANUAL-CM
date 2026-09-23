"use client";

import { useActionState } from "react";
import { loginAction, setupPasswordAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <div className="actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </Button>
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
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar Senha e Entrar"}
        </Button>
      </div>
    </form>
  );
}
