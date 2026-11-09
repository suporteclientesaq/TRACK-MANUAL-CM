import { createHash } from "node:crypto";
import { normalizeCtwaClid } from "./ctwa";
import { mergeLeadRaw } from "./store-raw";
import { toLead } from "./store-rows";

type Row = Record<string, unknown>;
export const TRACKING_FIELDS = [
  "ctwa_clid",
  "source_id",
  "source_url",
  "source_type",
  "thumbnail_url",
  "media_url",
  "headline",
  "ad_body",
] as const;
type TrackingFields = {
  [K in (typeof TRACKING_FIELDS)[number]]: string | null;
};
export interface TrackingSnapshot extends TrackingFields {
  id: string;
  observed_at: string;
  provider: string;
  message_id?: string;
}

function object(value: unknown): Row {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
function string(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text && !/^(null|undefined|none|n\/a|-)$/i.test(text) ? text : null;
}
function timestamp(value: unknown, fallback: string): string {
  let input = typeof value === "number" ? value : String(value ?? "");
  if (!input) return fallback;
  if (typeof input === "string" && /^\d+(\.\d+)?$/.test(input))
    input = Number(input);
  if (typeof input === "number" && input < 1e12) input *= 1000;
  const at = new Date(input);
  return Number.isFinite(at.getTime()) ? at.toISOString() : fallback;
}
function fields(value: Row): TrackingFields {
  return Object.fromEntries(
    TRACKING_FIELDS.map((key) => [
      key,
      key === "ctwa_clid" ? normalizeCtwaClid(value[key]) : string(value[key]),
    ]),
  ) as TrackingFields;
}
function hasReference(value: TrackingFields): boolean {
  return !!(value.ctwa_clid || value.source_id || value.source_url);
}

export function mergeTrackingReference(
  previous: object | null,
  value: object,
  forceNew = false,
): TrackingFields {
  const old = fields(object(previous));
  const incoming = fields(object(value));
  if (!hasReference(incoming)) return hasReference(old) ? old : incoming;
  const sameClick =
    !!incoming.ctwa_clid && incoming.ctwa_clid === old.ctwa_clid;
  const conflictingAd =
    !!incoming.source_id &&
    !!old.source_id &&
    incoming.source_id !== old.source_id;
  if (!sameClick || conflictingAd || forceNew) return incoming;
  return Object.fromEntries(
    TRACKING_FIELDS.map((key) => [key, incoming[key] || old[key]]),
  ) as TrackingFields;
}

/** Internal operation: the store applies it against the locked/current lead. */
export function withTrackingTouch(
  raw: unknown,
  incoming: Row,
  origin: string,
  observedAt?: string,
  options: {
    clear?: boolean;
    forceNew?: boolean;
    expectedFields?: object;
  } = {},
): Row {
  const payload = object(raw);
  return {
    ...payload,
    _tracking_touch: {
      fields: fields(incoming),
      provider: string(payload.provider) || origin,
      message_id: string(payload.message_id ?? payload.id),
      observed_at:
        observedAt ||
        payload.received_at ||
        payload.message_timestamp ||
        payload.timestamp,
      outgoing: payload.fromMe === true,
      clear: options.clear === true,
      forceNew: options.forceNew === true,
      ...(options.expectedFields
        ? { expected_fields: fields(object(options.expectedFields)) }
        : {}),
    },
  };
}

/**
 * Keep an ad, click and creative in one observation. A bare/new ad or click must
 * never acquire the other half from a previous interaction. Call under row lock
 * or optimistic CAS, as updateLeadWithRaw does in every adapter.
 */
export function mergeLeadUpdate(
  current: Row,
  patch: Row,
  incomingRaw: unknown,
  at: string,
): Row {
  const raw = object(incomingRaw);
  const operation = object(raw._tracking_touch);
  if (!Object.keys(operation).length)
    return {
      ...patch,
      raw: mergeLeadRaw(current.raw, incomingRaw, at),
      updated_at: at,
    };
  const sanitizedRaw = { ...raw };
  delete sanitizedRaw._tracking_touch;
  // External raw payloads cannot replace the canonical tracking markers.
  delete sanitizedRaw._tracking_snapshot;
  delete sanitizedRaw._tracking_touchpoints;
  const previousRaw = object(current.raw);
  const previousSnapshot = object(previousRaw._tracking_snapshot);
  const previousFields = fields(
    Object.keys(previousSnapshot).length ? previousSnapshot : current,
  );
  if (
    operation.expected_fields &&
    typeof operation.expected_fields === "object"
  ) {
    const expected = fields(object(operation.expected_fields));
    const actual = fields({ ...toLead(current) });
    if (TRACKING_FIELDS.some((key) => expected[key] !== actual[key]))
      throw new Error(
        "A origem deste contato foi alterada enquanto o formulário estava aberto. Recarregue a página e confira o clique e o anúncio antes de salvar.",
      );
  }
  const incoming = fields(object(operation.fields));
  const observed = timestamp(operation.observed_at, at);
  const out = { ...patch };
  for (const key of TRACKING_FIELDS) delete out[key];
  delete out.clid_seen_at;
  const incomingReference =
    operation.outgoing !== true &&
    (hasReference(incoming) || operation.clear === true);
  if (!incomingReference)
    return {
      ...out,
      raw: mergeLeadRaw(
        current.raw,
        Object.keys(sanitizedRaw).length ? sanitizedRaw : undefined,
        at,
      ),
      updated_at: at,
    };

  const resolved = mergeTrackingReference(
    previousFields,
    incoming,
    operation.forceNew === true,
  );
  if (operation.clear === true)
    for (const key of TRACKING_FIELDS) resolved[key] = null;
  const provider = string(operation.provider) || "unknown";
  const messageId = string(operation.message_id);
  const id = createHash("sha256")
    .update(JSON.stringify({ provider, messageId, observed, fields: resolved }))
    .digest("hex")
    .slice(0, 32);
  const snapshot: TrackingSnapshot = {
    id,
    observed_at: observed,
    provider,
    ...(messageId ? { message_id: messageId } : {}),
    ...resolved,
  };
  const history = Array.isArray(previousRaw._tracking_touchpoints)
    ? (previousRaw._tracking_touchpoints.filter(
        (item) => item && typeof item === "object",
      ) as Row[])
    : [];
  // Preserve the pre-migration reference as a single legacy observation, without
  // inventing a provider time or joining unrelated nodes from the raw payload.
  if (!history.length && hasReference(previousFields))
    history.push({
      id:
        string(previousSnapshot.id) ||
        "legacy-" +
          createHash("sha256")
            .update(JSON.stringify(previousFields))
            .digest("hex")
            .slice(0, 24),
      observed_at:
        previousSnapshot.observed_at ||
        current.clid_seen_at ||
        current.first_seen_at ||
        null,
      provider: previousSnapshot.provider || "legacy",
      ...previousFields,
    });
  if (!history.some((item) => item.id === snapshot.id))
    history.push({ ...snapshot });
  history.sort(
    (a, b) =>
      Date.parse(String(a.observed_at || "")) -
      Date.parse(String(b.observed_at || "")),
  );
  const isOlder =
    typeof previousSnapshot.observed_at === "string" &&
    Date.parse(observed) < Date.parse(previousSnapshot.observed_at);
  const rawPatch: Row = { ...sanitizedRaw, _tracking_touchpoints: history };
  if (!isOlder) {
    Object.assign(out, resolved, {
      clid_seen_at: resolved.ctwa_clid ? observed : null,
    });
    rawPatch._tracking_snapshot = snapshot;
  }
  return {
    ...out,
    raw: mergeLeadRaw(current.raw, rawPatch, at),
    updated_at: at,
  };
}
