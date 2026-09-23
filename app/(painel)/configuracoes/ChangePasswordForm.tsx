"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      <label htmlFor="current">Senha Atual</label>
      <input id="current" name="current" type="password" autoComplete="current-password" required />
      <label htmlFor="password" style={{ marginTop: 10 }}>
        Nova Senha
      </label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required />
      <label htmlFor="confirm" style={{ marginTop: 10 }}>
        Repita a Nova Senha
      </label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={6} required />
      <div className="actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Trocando…" : "Trocar Senha"}
        </Button>
      </div>
    </form>
  );
}
