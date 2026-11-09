import type { Lead } from "@/lib/types";

export interface ConversationMessage {
  id?: string;
  message_id?: string;
  text?: string;
  at?: string;
  fromMe?: boolean;
  type?: string;
  base64?: string;
  media_url?: string;
  mediaUrl?: string;
  url?: string;
  mimetype?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
  [key: string]: unknown;
}

export function leadRaw(lead: Lead): Record<string, unknown> {
  return lead.raw && typeof lead.raw === "object"
    ? (lead.raw as Record<string, unknown>)
    : {};
}

export function messagesFor(lead: Lead): ConversationMessage[] {
  const value = leadRaw(lead).messages;
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is ConversationMessage =>
    Boolean(message && typeof message === "object"),
  );
}

export function unansweredCount(lead: Lead): number {
  const raw = leadRaw(lead);
  if (typeof raw.conversation_unanswered === "number")
    return raw.conversation_unanswered;
  const messages = messagesFor(lead);
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].fromMe) break;
    count++;
  }
  return count;
}

/** Keep the list lightweight; only the open conversation receives its history. */
export function summarizeConversation(
  lead: Lead,
  selected: boolean,
  messageLimit = 100,
): Lead {
  const raw = leadRaw(lead);
  const messages = messagesFor(lead);
  const summary: Record<string, unknown> = {
    conversation_count: messages.length,
    conversation_unanswered: unansweredCount(lead),
    conversation_has_more: selected && messages.length > messageLimit,
    messages: messages.slice(selected ? -messageLimit : -1),
  };
  for (const key of [
    "pushName",
    "pushname",
    "notifyName",
    "verifiedName",
    "name",
    "profilePicUrl",
    "profile_picture",
    "avatarUrl",
    "avatar",
    "picture",
    "message_text",
  ]) {
    if (typeof raw[key] === "string") summary[key] = raw[key];
  }
  return { ...lead, raw: summary };
}
