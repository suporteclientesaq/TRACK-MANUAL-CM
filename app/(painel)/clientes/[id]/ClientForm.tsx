"use client";

import { useActionState, useState, useTransition } from "react";
import { saveClientAction, testMetaConnectionAction } from "@/app/actions";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";

type ClientFormData = Omit<Client, "capi_token_enc" | "marketing_token_enc"> & {
  capi_token_enc: boolean;
  marketing_token_enc: boolean;
};

export function ClientForm({ client }: { client?: ClientFormData }) {
  const [state, action, pending] = useActionState(saveClientAction, {
    error: null,
  });
  const [isTesting, startTesting] = useTransition();
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    checks: {
      pixel: { ok: boolean; message: string };
      capi: { ok: boolean; message: string };
      marketing: { ok: boolean; message: string };
    };
  } | null>(null);

  const handleTestMeta = () => {
    if (!client?.id) return;
    startTesting(async () => {
      setTestResult(null);
      const res = await testMetaConnectionAction(client.id);
      setTestResult(res);
    });
  };

  return (
    <form action={action}>
      {state.error && <div className="note note-err">{state.error}</div>}
      {client && <input type="hidden" name="id" value={client.id} />}

      <h2>Identificação</h2>
      <div className="cols">
        <div>
          <label htmlFor="name">Nome do Cliente</label>
          <input
            id="name"
            name="name"
            defaultValue={client?.name || ""}
            required
          />
        </div>
        <div>
          <label htmlFor="default_currency">Moeda Padrão</label>
          <input
            id="default_currency"
            name="default_currency"
            maxLength={3}
            defaultValue={client?.default_currency || "BRL"}
          />
        </div>
      </div>

      <h2 style={{ marginTop: 18 }}>Envio de Conversões ao Meta</h2>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: "8px",
          background:
            "linear-gradient(90deg, rgba(123, 57, 252, 0.1), rgba(52, 199, 123, 0.1))",
          border: "1px solid rgba(123, 57, 252, 0.25)",
          marginBottom: "14px",
          fontSize: "13px",
          color: "var(--brand)",
        }}
      >
        <strong>Configure, confira e valide:</strong> cadastre o pixel e o token
        da API, comece em modo de teste e confira o retorno da Meta. Identificar
        o anúncio ou receber o evento não garante atribuição da venda.
      </div>
      <div className="cols">
        <div>
          <label htmlFor="pixel_id">ID do Pixel / Dataset *</label>
          <input
            id="pixel_id"
            name="pixel_id"
            inputMode="numeric"
            defaultValue={client?.pixel_id || ""}
            placeholder="Ex: 1704000000002274"
          />
          <div className="hint">
            Essencial. O ID do Dataset criado no Gerenciador de Eventos.
          </div>
        </div>
        <div>
          <label htmlFor="capi_token">Token da API de Conversões *</label>
          <input
            id="capi_token"
            name="capi_token"
            type="password"
            autoComplete="off"
            placeholder={
              client?.capi_token_enc
                ? "Salvo — deixe em branco para manter"
                : "Cole o token aqui"
            }
          />
          <div className="hint">
            Essencial. Gerado no Gerenciador de Eventos (Configurações &gt;
            Gerar token de acesso).
          </div>
        </div>
        <div>
          <label htmlFor="page_id">ID da Página do Facebook (Opcional)</label>
          <input
            id="page_id"
            name="page_id"
            inputMode="numeric"
            defaultValue={client?.page_id || ""}
            placeholder="Ex: 111563191862046"
          />
          <div className="hint">
            Com CTWA, use o identificador associado à conta. Sem ele, a
            conferência avisa sobre o envio por telefone e a atribuição pode não
            ocorrer.
          </div>
        </div>
        <div>
          <label htmlFor="waba_id">
            ID da Conta do WhatsApp Business (Opcional)
          </label>
          <input
            id="waba_id"
            name="waba_id"
            inputMode="numeric"
            defaultValue={client?.waba_id || ""}
          />
          <div className="hint">
            Opcional. Somente para quem utiliza a Cloud API oficial da Meta.
          </div>
        </div>
        <div>
          <label htmlFor="id_mode">Priorizar Identificação Por</label>
          <select
            id="id_mode"
            name="id_mode"
            defaultValue={client?.id_mode || "page"}
          >
            <option value="page">ID da Página (Padrão)</option>
            <option value="waba">
              ID da Conta WhatsApp Business (API Oficial)
            </option>
          </select>
        </div>
        <div>
          <label htmlFor="test_event_code">Código de Eventos de Teste</label>
          <input
            id="test_event_code"
            name="test_event_code"
            defaultValue={client?.test_event_code || ""}
            placeholder="TEST12345"
          />
          <div className="hint">
            Preenchido = modo de teste. Em branco = produção real.
          </div>
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
          Enviar dados extras (telefone, nome, cidade, estado e CEP com hash,
          mais o ID e a URL de origem)
          <div className="hint">
            Aumenta a qualidade da correspondência. Se o Meta recusar o evento
            por causa desses campos, desmarque: o painel passa a mandar só o
            conjunto mínimo documentado (ctwa_clid + ID).
          </div>
        </label>
      </div>

      <h2 style={{ marginTop: 18 }}>Leitura dos Anúncios</h2>
      <div className="cols">
        <div>
          <label htmlFor="ad_account_id">ID da Conta de Anúncios</label>
          <input
            id="ad_account_id"
            name="ad_account_id"
            defaultValue={client?.ad_account_id || ""}
            placeholder="act_1234567890"
          />
          <div className="hint">
            Ex: act_1234567890. Escolha a conta correta. No dashboard, carregue
            as campanhas e selecione ativas, pausadas ou campanhas específicas.
          </div>
        </div>
        <div>
          <label htmlFor="marketing_token">
            Token de Leitura (Permissão ads_read)
          </label>
          <input
            id="marketing_token"
            name="marketing_token"
            type="password"
            autoComplete="off"
            placeholder={
              client?.marketing_token_enc
                ? "Salvo — deixe em branco para manter"
                : "Cole o token aqui"
            }
          />
          <div className="hint">
            Token de Usuário do Sistema com acesso à conta de anúncios para
            leitura de gastos.
          </div>
        </div>
      </div>

      {/* Diagnóstico em tempo real */}
      {testResult && (
        <div
          style={{
            marginTop: 18,
            padding: "16px",
            borderRadius: "10px",
            background: "rgba(255, 255, 255, 0.04)",
            border: `1px solid ${testResult.ok ? "rgba(52, 199, 123, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
          }}
        >
          <h4
            style={{
              margin: "0 0 10px 0",
              fontSize: "14px",
              fontWeight: 700,
              color: "#ebe8f2",
            }}
          >
            🔍 Diagnóstico da Conexão com o Meta
          </h4>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "13px",
            }}
          >
            <div>
              {testResult.checks.pixel.ok ? "✅" : "⚠️"}{" "}
              <strong>Pixel / Dataset:</strong>{" "}
              {testResult.checks.pixel.message}
            </div>
            <div>
              {testResult.checks.capi.ok ? "✅" : "❌"}{" "}
              <strong>Conversions API (CAPI):</strong>{" "}
              {testResult.checks.capi.message}
            </div>
            <div>
              {testResult.checks.marketing.ok ? "✅" : "⚠️"}{" "}
              <strong>Marketing API (Gastos / Anúncios):</strong>{" "}
              {testResult.checks.marketing.message}
            </div>
          </div>
        </div>
      )}

      <div
        className="actions"
        style={{
          marginTop: 20,
          display: "flex",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <Button type="submit" disabled={pending}>
          {pending
            ? "Salvando…"
            : client
              ? "Salvar Alterações"
              : "Cadastrar Cliente"}
        </Button>

        {client?.id && (
          <Button
            type="button"
            variant="outline"
            onClick={handleTestMeta}
            disabled={isTesting}
            style={{ borderColor: "rgba(123, 57, 252, 0.4)", color: "#b394ff" }}
          >
            {isTesting ? "Testando Conexão…" : "🔍 Testar Conexão com Meta"}
          </Button>
        )}
      </div>
    </form>
  );
}
