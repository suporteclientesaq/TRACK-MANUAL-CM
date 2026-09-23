"use client";

import { useActionState } from "react";
import { saveClientAction } from "@/app/actions";
import type { Client } from "@/lib/types";

export function ClientForm({ client }: { client?: Client }) {
  const [state, action, pending] = useActionState(saveClientAction, { error: null });
  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      {client && <input type="hidden" name="id" value={client.id} />}

      <h2>Identificação</h2>
      <div className="cols">
        <div>
          <label htmlFor="name">Nome do Cliente</label>
          <input id="name" name="name" defaultValue={client?.name || ""} required />
        </div>
        <div>
          <label htmlFor="default_currency">Moeda Padrão</label>
          <input id="default_currency" name="default_currency" maxLength={3} defaultValue={client?.default_currency || "BRL"} />
        </div>
      </div>

      <h2 style={{ marginTop: 18 }}>Envio de Conversões</h2>
      <div className="cols">
        <div>
          <label htmlFor="pixel_id">ID do Pixel (Dataset)</label>
          <input id="pixel_id" name="pixel_id" inputMode="numeric" defaultValue={client?.pixel_id || ""} />
        </div>
        <div>
          <label htmlFor="capi_token">Token da API de Conversões</label>
          <input
            id="capi_token"
            name="capi_token"
            type="password"
            autoComplete="off"
            placeholder={client?.capi_token_enc ? "Salvo — deixe em branco para manter" : "Cole o token aqui"}
          />
          <div className="hint">Fica criptografado no banco e nunca volta para a tela.</div>
        </div>
        <div>
          <label htmlFor="page_id">ID da Página do Facebook</label>
          <input id="page_id" name="page_id" inputMode="numeric" defaultValue={client?.page_id || ""} />
          <div className="hint">A Página ligada ao número de WhatsApp dos anúncios.</div>
        </div>
        <div>
          <label htmlFor="waba_id">ID da Conta do WhatsApp Business</label>
          <input id="waba_id" name="waba_id" inputMode="numeric" defaultValue={client?.waba_id || ""} />
          <div className="hint">Só para quem usa a API Oficial do WhatsApp. Pode ficar em branco.</div>
        </div>
        <div>
          <label htmlFor="id_mode">Identificar o WhatsApp Por</label>
          <select id="id_mode" name="id_mode" defaultValue={client?.id_mode || "page"}>
            <option value="page">ID da Página (API não oficial, uazapi)</option>
            <option value="waba">ID da Conta do WhatsApp Business (API Oficial)</option>
          </select>
        </div>
        <div>
          <label htmlFor="test_event_code">Código de Eventos de Teste</label>
          <input id="test_event_code" name="test_event_code" defaultValue={client?.test_event_code || ""} placeholder="TEST12345" />
          <div className="hint">Preenchido = modo de teste. Em branco = produção, conta como conversão.</div>
        </div>
      </div>

      <div className="check" style={{ marginTop: 12 }}>
        <input
          id="send_extra_data"
          name="send_extra_data"
          type="checkbox"
          defaultChecked={client ? client.send_extra_data : true}
        />
        <label htmlFor="send_extra_data">
          Enviar dados extras (telefone, nome, cidade, estado e CEP com hash, mais o ID e a URL de origem)
          <div className="hint">
            Aumenta a qualidade da correspondência. Se o Meta recusar o evento por causa desses campos, desmarque: o
            painel passa a mandar só o conjunto mínimo documentado (ctwa_clid + ID).
          </div>
        </label>
      </div>

      <h2 style={{ marginTop: 18 }}>Leitura dos Anúncios</h2>
      <div className="cols">
        <div>
          <label htmlFor="ad_account_id">ID da Conta de Anúncios</label>
          <input id="ad_account_id" name="ad_account_id" defaultValue={client?.ad_account_id || ""} placeholder="act_1234567890" />
        </div>
        <div>
          <label htmlFor="marketing_token">Token de Leitura (Permissão ads_read)</label>
          <input
            id="marketing_token"
            name="marketing_token"
            type="password"
            autoComplete="off"
            placeholder={client?.marketing_token_enc ? "Salvo — deixe em branco para manter" : "Cole o token aqui"}
          />
          <div className="hint">Token de Usuário do Sistema com acesso à conta de anúncios.</div>
        </div>
      </div>

      <div className="actions">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando…" : client ? "Salvar Alterações" : "Cadastrar Cliente"}
        </button>
      </div>
    </form>
  );
}
