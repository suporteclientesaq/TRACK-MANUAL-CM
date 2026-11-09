import { describe, expect, it } from "vitest";
import { mergeLeadRaw } from "@/lib/store-raw";
type Raw = {
  messages: Record<string, unknown>[];
  pipeline_stage?: string;
  context?: string;
};
const at = "2026-11-01T12:00:00.000Z";
describe("integridade de mensagens", () => {
  it("deduplica um reenvio pelo ID e preserva o horário de origem", () => {
    const incoming = {
      message_id: "external-1",
      provider: "fixture",
      message_text: "sim",
      received_at: at,
      fromMe: false,
    };
    const first = mergeLeadRaw(null, incoming, "2026-11-09T12:00:00.000Z");
    const second = mergeLeadRaw(
      first,
      incoming,
      "2026-11-09T13:00:00.000Z",
    ) as Raw;
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].at).toBe(at);
  });
  it("preserva textos iguais com IDs distintos e direções diferentes", () => {
    let raw: unknown = null;
    for (const item of [
      { message_id: "1", fromMe: false },
      { message_id: "2", fromMe: true },
    ])
      raw = mergeLeadRaw(
        raw,
        { ...item, provider: "fixture", message_text: "ok", received_at: at },
        at,
      );
    expect((raw as Raw).messages).toHaveLength(2);
    expect((raw as Raw).messages.map((message) => message.fromMe)).toEqual([
      false,
      true,
    ]);
  });
  it("mover no funil preserva o histórico e o contexto", () => {
    const before = {
      context: "cliente prefere manhã",
      messages: [{ id: "m1", text: "Olá", at, fromMe: false }],
    };
    const after = mergeLeadRaw(
      before,
      { pipeline_stage: "proposal" },
      at,
    ) as Raw;
    expect(after.pipeline_stage).toBe("proposal");
    expect(after.context).toBe(before.context);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0].text).toBe("Olá");
  });
  it("limpa somente payloads antigos e preserva mensagens que chegaram depois", () => {
    let raw: unknown = {
      messages: [
        {
          id: "old",
          text: "Foto",
          type: "image",
          base64: "old-file",
          at: "2026-09-01T12:00:00Z",
          fromMe: false,
        },
        {
          id: "new",
          text: "Foto nova",
          type: "image",
          base64: "new-file",
          at: "2026-11-09T12:00:00Z",
          fromMe: false,
        },
      ],
    };
    raw = mergeLeadRaw(
      raw,
      { _cleanup_before: Date.parse("2026-10-01T00:00:00Z") },
      at,
    );
    const messages = (raw as Raw).messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].base64).toBeUndefined();
    expect(messages[0].text).toBe("Foto");
    expect(messages[1].base64).toBe("new-file");
  });
});
