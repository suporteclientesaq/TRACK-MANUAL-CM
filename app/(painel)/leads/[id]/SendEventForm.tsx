"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewEventAction,
  sendEventAction,
  type EventFormInput,
  type EventPreview,
  type EventSendResult,
} from "@/app/actions";
import { MESSAGING_EVENTS } from "@/lib/types";

/** Horário local no formato que o campo datetime-local espera. */
function localNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function SendEventForm({
  leadId,
  defaultCurrency,
  products,
}: {
  leadId: string;
  defaultCurrency: string;
  products: string[];
}) {
  const router = useRouter();
  const [eventName, setEventName] = useState<string>("Purchase");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contentName, setContentName] = useState("");
  const [when, setWhen] = useState(localNow);
  const [preview, setPreview] = useState<EventPreview | null>(null);
  const [result, setResult] = useState<EventSendResult | null>(null);
  const [confirmDouble, setConfirmDouble] = useState(false);
  const [pending, startTransition] = useTransition();

  const needsValue = MESSAGING_EVENTS.find((e) => e.value === eventName)?.needsValue ?? false;

  const input = (): EventFormInput => ({
    leadId,
    eventName,
    eventTimeIso: new Date(when).toISOString(),
    value,
    currency,
    contentName,
  });

  // Qualquer alteração invalida a conferência: o que é enviado é sempre o que foi conferido.
  const changed = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPreview(null);
    setResult(null);
    setConfirmDouble(false);
  };

  const doPreview = () =>
    startTransition(async () => {
      setResult(null);
      setPreview(await previewEventAction(input()));
    });

  const doSend = () =>
    startTransition(async () => {
      const r = await sendEventAction(input());
      setResult(r);
      if (r.sent) {
        setPreview(null);
        setConfirmDouble(false);
        router.refresh();
      }
    });

  const blockedByDouble = !!preview && preview.alreadySent > 0 && !confirmDouble;

  return (
    <div>
      <div className="cols">
        <div>
          <label htmlFor="event_name">Evento</label>
          <select id="event_name" value={eventName} onChange={(e) => changed(setEventName)(e.target.value)}>
            {MESSAGING_EVENTS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label} ({e.value})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="value">Valor{needsValue ? " (Obrigatório)" : " (Opcional)"}</label>
          <input
            id="value"
            inputMode="decimal"
            placeholder="29,90"
            value={value}
            onChange={(e) => changed(setValue)(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="currency">Moeda</label>
          <input id="currency" maxLength={3} value={currency} onChange={(e) => changed(setCurrency)(e.target.value.toUpperCase())} />
        </div>
        <div>
          <label htmlFor="content_name">Produto ou Serviço</label>
          <input
            id="content_name"
            list="produtos"
            value={contentName}
            onChange={(e) => changed(setContentName)(e.target.value)}
          />
          <datalist id="produtos">
            {products.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="when">Quando Aconteceu</label>
          <input id="when" type="datetime-local" value={when} max={localNow()} onChange={(e) => changed(setWhen)(e.target.value)} />
        </div>
      </div>

      {!preview && (
        <div className="actions">
          <button className="btn btn-primary" onClick={doPreview} disabled={pending || !when}>
            {pending ? "Montando…" : "Conferir Antes de Enviar"}
          </button>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          {preview.errors.length > 0 && (
            <div className="note note-err">
              <strong>Não dá para enviar ainda:</strong>
              <ul>{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="note note-warn">
              <strong>Atenção:</strong>
              <ul>{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          {preview.isTest && (
            <div className="note note-warn">
              Este cliente está em <strong>modo de teste</strong>: o evento aparece só na aba Eventos de Teste do
              Gerenciador de Eventos e não conta como conversão. Apague o código de teste no cadastro do cliente para
              enviar de verdade.
            </div>
          )}
          {preview.alreadySent > 0 && (
            <div className="note note-warn">
              <strong>Este evento já foi enviado {preview.alreadySent}x para este lead.</strong> Enviar de novo faz o Meta
              contar outra conversão. Só continue se for mesmo uma nova venda.
              <div className="check" style={{ marginTop: 8 }}>
                <input id="confirm-double" type="checkbox" checked={confirmDouble} onChange={(e) => setConfirmDouble(e.target.checked)} />
                <label htmlFor="confirm-double">É uma nova conversão, quero enviar mesmo assim</label>
              </div>
            </div>
          )}

          <p className="small muted" style={{ marginBottom: 6 }}>
            Exatamente isto será enviado ao Meta. Nome, telefone, cidade e estado vão embaralhados (hash SHA-256), como o
            Meta exige; o ctwa_clid vai em texto puro.
          </p>
          <pre className="payload">{JSON.stringify(preview.payload, null, 2)}</pre>

          <div className="actions">
            <button className="btn btn-primary" onClick={doSend} disabled={pending || !preview.ok || blockedByDouble}>
              {pending ? "Enviando…" : preview.isTest ? "Enviar Evento de Teste" : "Enviar ao Meta Agora"}
            </button>
            <button className="btn" onClick={() => setPreview(null)} disabled={pending}>
              Voltar e Corrigir
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`note ${result.sent ? "note-ok" : "note-err"}`} style={{ marginTop: 14 }}>
          <strong>{result.sent ? "Enviado." : "Não foi enviado."}</strong> {result.message}
          {!result.sent && result.errors.length > 0 && <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
