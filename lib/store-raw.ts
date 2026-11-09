import { fromJson, type Row } from "./store-rows";

export interface StoredMessage extends Row {
  text: string;
  at: string;
  fromMe: boolean;
  message_id?: string;
}

function object(value: unknown): Row {
  const parsed = fromJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Row)
    : {};
}

function timestamp(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  let input: string | number =
    typeof value === "number" ? value : String(value);
  if (typeof input === "string" && /^\d+(\.\d+)?$/.test(input))
    input = Number(input);
  if (typeof input === "number" && input < 1e12) input *= 1000;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function message(raw: Row, fallback: string): StoredMessage | null {
  const text =
    typeof raw.text === "string"
      ? raw.text
      : typeof raw.message_text === "string"
        ? raw.message_text
        : "";
  const type = typeof raw.type === "string" ? raw.type : undefined;
  if (!text && !type && !raw.base64) return null;
  const id = raw.message_id ?? raw.id ?? raw.messageId;
  const item: StoredMessage = {
    text:
      text ||
      (type === "audio"
        ? "[Áudio do WhatsApp]"
        : type === "image"
          ? "[Foto do WhatsApp]"
          : "[Mídia]"),
    at: timestamp(
      raw.at ?? raw.received_at ?? raw.message_timestamp ?? raw.timestamp,
      fallback,
    ),
    fromMe: raw.fromMe === true,
  };
  if (id !== undefined && id !== null && String(id))
    item.message_id = String(id);
  for (const key of [
    "provider",
    "type",
    "mimetype",
    "media_url",
    "url",
    "base64",
    "filename",
    "fileName",
    "caption",
    "duration",
    "size",
  ] as const) {
    if (raw[key] !== undefined && raw[key] !== null) item[key] = raw[key];
  }
  return item;
}

/** Merge only under a database row lock/CAS. Message IDs, never text, deduplicate deliveries. */
export function mergeLeadRaw(
  previous: unknown,
  incoming: unknown,
  receivedAt: string,
): unknown {
  if (incoming === undefined || incoming === null) return fromJson(previous);
  const old = object(previous);
  const next = object(incoming);
  const messages: StoredMessage[] = [];
  if (Array.isArray(old.messages)) {
    for (const m of old.messages) {
      if (!m || typeof m !== "object") continue;
      const normalized = message(m as Row, receivedAt);
      if (normalized) messages.push(normalized);
    }
  } else if (old.message_text) {
    const legacy = message(old, receivedAt);
    if (legacy) messages.push(legacy);
  }
  const incomingMessages = Array.isArray(next.messages)
    ? next.messages
        .filter(
          (m): m is Row => !!m && typeof m === "object" && !Array.isArray(m),
        )
        .map((m) => message(m, receivedAt))
    : [message(next, receivedAt)];
  const ids = new Map<string, number>();
  const keyOf = (m: StoredMessage) =>
    m.message_id ? `${String(m.provider || "")}:${m.message_id}` : null;
  messages.forEach((m, i) => {
    const key = keyOf(m);
    if (key) ids.set(key, i);
  });
  for (const m of incomingMessages) {
    if (!m) continue;
    const key = keyOf(m);
    const existingIndex = key ? ids.get(key) : undefined;
    if (existingIndex !== undefined)
      messages[existingIndex] = { ...messages[existingIndex], ...m };
    else {
      if (key) ids.set(key, messages.length);
      messages.push(m);
    }
  }
  messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (
    typeof next._cleanup_before === "number" &&
    Number.isFinite(next._cleanup_before)
  ) {
    for (const item of messages) {
      if (
        Date.parse(item.at) < next._cleanup_before &&
        (item.base64 || item.text.startsWith("data:"))
      ) {
        delete item.base64;
        if (item.text.startsWith("data:"))
          item.text = "[Mídia removida pela limpeza de arquivos antigos]";
        item.cleaned = true;
      }
    }
  }
  const merged = { ...old, ...next };
  delete merged._cleanup_before;
  // A message sent by the operator must not replace the contact's identity.
  if (next.fromMe === true) {
    for (const key of [
      "pushName",
      "pushname",
      "notifyName",
      "verifiedName",
      "name",
    ]) {
      if (old[key] !== undefined) merged[key] = old[key];
      else delete merged[key];
    }
  }
  if (
    messages.length ||
    Array.isArray(old.messages) ||
    Array.isArray(next.messages)
  ) {
    merged.messages = messages;
    merged.message_text = messages.at(-1)?.text ?? old.message_text ?? null;
  }
  return merged;
}
