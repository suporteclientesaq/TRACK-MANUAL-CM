/** Accept values only when the caller obtained them from an explicit CTWA field. */
export function normalizeCtwaClid(value: unknown): string | null {
  let text: string;
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const serialized = value as Record<string, unknown>;
    if (
      serialized.type !== "Buffer" ||
      !Array.isArray(serialized.data) ||
      serialized.data.length > 4096 ||
      !serialized.data.every(
        (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
      )
    )
      return null;
    value = new Uint8Array(serialized.data);
  }
  if (typeof value === "string") {
    text = value.trim();
  } else if (value instanceof Uint8Array) {
    if (value.byteLength > 4096) return null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(value).trim();
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (
    !text ||
    text.length > 4096 ||
    !/^[A-Za-z0-9+/_=-]+$/.test(text) ||
    /^(?:null|undefined|none|false|true|0)$/i.test(text) ||
    /^(?:ctwa_ad_|ad_)/i.test(text)
  )
    return null;
  return text;
}

/** fbclid is a different identifier and must never be promoted to ctwa_clid. */
export function ctwaFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value, "https://track-manual.invalid");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const candidates = [
      ...url.searchParams.getAll("ctwa_clid"),
      ...url.searchParams.getAll("ctwaClid"),
    ];
    return candidates.length === 1 ? normalizeCtwaClid(candidates[0]) : null;
  } catch {
    return null;
  }
}

const fieldText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export interface ExplicitReferral {
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  headline: string | null;
  ad_body: string | null;
}

/** Choose one provider context before reading its fields; no cross-context fallback. */
export function selectReferralGroups(
  groups: unknown[],
): ExplicitReferral | null {
  const adId = (value: unknown) =>
    typeof value === "string" && /^\d{6,}$/.test(value.trim())
      ? value.trim()
      : null;
  for (const candidate of groups) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const group = candidate as Record<string, unknown>;
    const nested = group.externalAdReply;
    const reply =
      nested && typeof nested === "object"
        ? (nested as Record<string, unknown>)
        : {};
    const source_url = fieldText(
      reply.sourceUrl ??
        reply.source_url ??
        group.sourceUrl ??
        group.source_url,
    );
    let source_id = adId(
      reply.sourceId ??
        reply.source_id ??
        reply.adId ??
        reply.ad_id ??
        group.sourceId ??
        group.source_id ??
        group.adId ??
        group.ad_id,
    );
    if (!source_id && source_url) {
      try {
        const url = new URL(source_url, "https://track-manual.invalid");
        source_id = adId(
          url.searchParams.get("ad_id") ||
            url.searchParams.get("hsa_ad") ||
            url.searchParams.get("ad"),
        );
      } catch {}
    }
    const referral: ExplicitReferral = {
      ctwa_clid:
        [group.ctwaClid, group.ctwa_clid, reply.ctwaClid, reply.ctwa_clid]
          .map(normalizeCtwaClid)
          .find(Boolean) || ctwaFromUrl(source_url),
      source_id,
      source_url,
      thumbnail_url: fieldText(
        reply.thumbnailUrl ?? reply.thumbnail_url ?? group.thumbnail_url,
      ),
      media_url: fieldText(
        reply.mediaUrl ?? reply.media_url ?? group.media_url,
      ),
      headline: fieldText(reply.title ?? reply.headline ?? group.headline),
      ad_body: fieldText(reply.body ?? reply.ad_body ?? group.ad_body),
    };
    if (Object.values(referral).some(Boolean)) return referral;
  }
  return null;
}

/** Read a complete referral from one message context, never mix contexts. */
export function extractBaileysProtobufAd(
  rawMsg: Record<string, unknown> | undefined,
) {
  const empty = {
    bctwa: null,
    bAdId: null,
    bAdTitle: null,
    bAdBody: null,
    bAdThumb: null,
    bAdUrl: null,
    bAdMedia: null,
  } as {
    bctwa: string | null;
    bAdId: string | null;
    bAdTitle: string | null;
    bAdBody: string | null;
    bAdThumb: string | null;
    bAdUrl: string | null;
    bAdMedia: string | null;
  };
  if (!rawMsg || typeof rawMsg !== "object") return empty;
  let message = rawMsg;
  for (let depth = 0; depth < 5; depth++) {
    const wrapper =
      message.ephemeralMessage ||
      message.viewOnceMessage ||
      message.viewOnceMessageV2 ||
      message.documentWithCaptionMessage;
    const inner =
      wrapper && typeof wrapper === "object"
        ? (wrapper as Record<string, unknown>).message
        : null;
    if (!inner || typeof inner !== "object") break;
    message = inner as Record<string, unknown>;
  }
  for (const msgObj of [
    message.extendedTextMessage,
    message.imageMessage,
    message.videoMessage,
    message.documentMessage,
    message.audioMessage,
    message.stickerMessage,
    message,
  ]) {
    if (!msgObj || typeof msgObj !== "object") continue;
    const ci = (msgObj as Record<string, unknown>).contextInfo;
    if (!ci || typeof ci !== "object") continue;
    const context = ci as Record<string, unknown>;
    const rawReply = context.externalAdReply;
    const reply =
      rawReply && typeof rawReply === "object"
        ? (rawReply as Record<string, unknown>)
        : {};
    const bAdUrl = fieldText(reply.sourceUrl ?? reply.source_url);
    const bctwa =
      [context.ctwaClid, context.ctwa_clid, reply.ctwaClid, reply.ctwa_clid]
        .map(normalizeCtwaClid)
        .find(Boolean) || ctwaFromUrl(bAdUrl);
    const source =
      reply.sourceId ?? reply.source_id ?? reply.adId ?? reply.ad_id;
    const bAdId =
      typeof source === "string" && source.trim() !== "0"
        ? fieldText(source)
        : null;
    const bAdTitle = fieldText(reply.title ?? reply.headline);
    const bAdBody = fieldText(reply.body ?? reply.ad_body);
    const bAdThumb = fieldText(reply.thumbnailUrl ?? reply.thumbnail_url);
    const bAdMedia = fieldText(reply.mediaUrl ?? reply.media_url);
    if (bctwa || bAdId || bAdUrl || bAdTitle || bAdBody || bAdThumb || bAdMedia)
      return { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl, bAdMedia };
  }
  return empty;
}
