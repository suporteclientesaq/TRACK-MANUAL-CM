"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  previewEventAction,
  pullCtwaFromPhoneAction,
  saveLeadNotesAction,
  sendEventAction,
  sendWhatsAppMediaAction,
  sendWhatsAppMessageAction,
  setLeadAdAction,
} from "@/app/actions";
import type { EventFormInput, EventPreview } from "@/app/actions";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import type { AdInfo, EventRow, Lead } from "@/lib/types";
import { leadRaw, messagesFor, unansweredCount } from "./conversation-data";
import type { ConversationMessage } from "./conversation-data";
import styles from "./Conversas.module.css";

interface ClientBasic {
  id: string;
  name: string;
  default_currency: string;
}
interface ConversasClientProps {
  clients: ClientBasic[];
  initialLeads: Lead[];
  adsData: Record<string, AdInfo>;
  eventsData: Record<string, EventRow[]>;
  clientNameMap: Record<string, string>;
  initialSelectedLeadId: string | null;
  initialClientId: string;
  initialSearchQuery: string;
  initialOpenThread?: boolean;
  initialHasMore?: boolean;
  initialUpdatedAt?: string;
  initialSoundEnabled?: boolean;
  initialBadgeEnabled?: boolean;
}
type InboxTab = "all" | "waiting" | "sold";
type OriginFilter = "all" | "ad" | "organic" | "pix";
interface LiveResponse {
  ok: boolean;
  leads?: Lead[];
  adsData?: Record<string, AdInfo>;
  eventsData?: Record<string, EventRow[]>;
  hasMore?: boolean;
  error?: string;
}
interface SaleIntent {
  lead: Lead;
  input: EventFormInput;
  preview: EventPreview | null;
}
const SHORTCUTS = [
  {
    key: "/ola",
    title: "Boas-vindas",
    text: "Olá! Tudo bem? Sou da equipe de atendimento. Como posso ajudar você hoje?",
  },
  {
    key: "/duvida",
    title: "Tirar uma dúvida",
    text: "Claro! Pode me contar um pouco mais sobre o que você precisa? Estou por aqui para ajudar.",
  },
  {
    key: "/confirmado",
    title: "Pagamento confirmado",
    text: "Recebemos o seu pagamento. Seu pedido está confirmado! Obrigado pela confiança.",
  },
];
const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";
const realClick = (lead: Lead) =>
  Boolean(lead.ctwa_clid && !lead.ctwa_clid.startsWith("ctwa_ad_"));
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
const leadKey = (lead: Lead) =>
  `${lead.client_id}:${lead.phone.replace(/\D/g, "")}`;

function displayName(lead: Lead) {
  if (lead.name?.trim() && lead.name.trim() !== "Sem Nome")
    return lead.name.trim();
  const raw = leadRaw(lead);
  for (const key of [
    "pushName",
    "pushname",
    "notifyName",
    "verifiedName",
    "name",
  ]) {
    if (stringValue(raw[key]).trim()) return stringValue(raw[key]).trim();
  }
  return formatPhone(lead.phone);
}
function avatarUrl(lead: Lead) {
  const raw = leadRaw(lead);
  for (const key of [
    "profilePicUrl",
    "profile_picture",
    "avatarUrl",
    "avatar",
    "picture",
  ]) {
    if (/^https?:\/\//.test(stringValue(raw[key])))
      return stringValue(raw[key]);
  }
  return null;
}
function timestamp(message: ConversationMessage, fallback: string) {
  const raw = message.at || fallback;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback);
}
function latestTime(lead: Lead) {
  const last = messagesFor(lead).at(-1);
  return last ? timestamp(last, lead.updated_at) : Date.parse(lead.updated_at);
}
function timeLabel(value: number | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
}
function snippet(lead: Lead) {
  const last = messagesFor(lead).at(-1);
  if (last?.type === "audio") return "Mensagem de áudio";
  if (last?.type === "image") return last.caption || "Imagem";
  if (last?.type === "document") return last.filename || "Documento";
  const text = last?.text || stringValue(leadRaw(lead).message_text);
  return text && !text.startsWith("data:")
    ? text
    : "Nenhuma mensagem sincronizada";
}
function mediaSource(message: ConversationMessage) {
  const explicit = message.media_url || message.mediaUrl || message.url;
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const base64 =
    message.base64 || (message.text?.startsWith("data:") ? message.text : "");
  if (!base64) return null;
  if (base64.startsWith("data:"))
    return /^data:(image|audio|video)\/[\w.+-]+;base64,/.test(base64) ||
      /^data:application\/pdf;base64,/.test(base64)
      ? base64
      : null;
  const mime =
    message.mimetype ||
    message.mimeType ||
    (message.type === "audio"
      ? "audio/ogg"
      : message.type === "image"
        ? "image/jpeg"
        : "application/octet-stream");
  if (
    !/^(image|audio|video)\/[\w.+-]+$/.test(mime) &&
    mime !== "application/pdf"
  )
    return null;
  return `data:${mime};base64,${base64}`;
}
function Avatar({ lead, large = false }: { lead: Lead; large?: boolean }) {
  const url = avatarUrl(lead);
  const name = displayName(lead);
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  return (
    <span
      className={`${styles.avatar} ${large ? styles.avatarLarge : ""}`}
      data-color={hue}
    >
      {url ? (
        <img
          src={url}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={() => onCloseRef.current()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div className={styles.dialogHeader}>
        <div>
          <span className={styles.eyebrow}>TRACK MANUAL</span>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Fechar"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ConversasClient({
  clients,
  initialLeads,
  adsData,
  eventsData,
  clientNameMap,
  initialSelectedLeadId,
  initialClientId,
  initialSearchQuery,
  initialOpenThread = false,
  initialHasMore = false,
  initialUpdatedAt,
  initialSoundEnabled = true,
  initialBadgeEnabled = true,
}: ConversasClientProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [ads, setAds] = useState(adsData);
  const [events, setEvents] = useState(eventsData);
  const [selectedId, setSelectedId] = useState(initialSelectedLeadId);
  const [clientId, setClientId] = useState(initialClientId);
  const [query, setQuery] = useState(initialSearchQuery);
  const deferredQuery = useDeferredValue(query);
  const [tab, setTab] = useState<InboxTab>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [mobileView, setMobileView] = useState<"list" | "chat" | "details">(
    initialOpenThread ? "chat" : "list",
  );
  const [showDetails, setShowDetails] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>(
    {},
  );
  const [lastUpdated, setLastUpdated] = useState(initialUpdatedAt || "");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [listLimit, setListLimit] = useState(100);
  const [messageLimit, setMessageLimit] = useState(100);
  const [newMessages, setNewMessages] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [showThreadSearch, setShowThreadSearch] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [ctwaBusy, setCtwaBusy] = useState(false);
  const [ctwaNotice, setCtwaNotice] = useState<string | null>(null);
  const [adInput, setAdInput] = useState("");
  const [adBusy, setAdBusy] = useState(false);
  const [showAdForm, setShowAdForm] = useState(false);
  const [sale, setSale] = useState<SaleIntent | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleConfirmed, setSaleConfirmed] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const etagRef = useRef("");
  const listLimitRef = useRef(listLimit);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const previousThreadRef = useRef("");
  const inboundTimes = useRef(new Map<string, number>());

  useEffect(() => {
    listLimitRef.current = listLimit;
  }, [listLimit]);
  useEffect(() => {
    setClientId(initialClientId);
    setQuery(initialSearchQuery);
    setSelectedId(initialSelectedLeadId);
    etagRef.current = "";
  }, [initialClientId, initialSearchQuery, initialSelectedLeadId]);
  useEffect(() => {
    setLeads(initialLeads);
    setAds(adsData);
    setEvents(eventsData);
  }, [initialLeads, adsData, eventsData]);
  const selected = useMemo(
    () => leads.find((lead) => lead.id === selectedId) || null,
    [leads, selectedId],
  );
  const draft = selected ? drafts[selected.id] || "" : "";
  const isSending = selected ? Boolean(sending[selected.id]) : false;
  const selectedClient = selected
    ? clients.find((client) => client.id === selected.client_id)
    : null;
  const selectedAd = selected?.source_id
    ? ads[`${selected.client_id}:${selected.source_id}`]
    : null;
  const scopedEvents = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const lead of leads) {
      const key = leadKey(lead);
      const previous = map.get(key) || [];
      map.set(key, [
        ...previous,
        ...(events[lead.id] || []).filter(
          (event) => event.client_id === lead.client_id,
        ),
      ]);
    }
    for (const [key, rows] of map) {
      const unique = new Map(
        rows.map((event) => [`${event.event_name}:${event.event_id}`, event]),
      );
      map.set(key, [...unique.values()]);
    }
    return map;
  }, [leads, events]);
  const purchaseEvents = useCallback(
    (lead: Lead) =>
      (scopedEvents.get(leadKey(lead)) || []).filter(
        (event) =>
          event.status === "enviado" &&
          !event.is_test &&
          event.event_name === "Purchase",
      ),
    [scopedEvents],
  );
  const selectedEvents = selected
    ? scopedEvents.get(leadKey(selected)) || []
    : [];
  const selectedPurchases = selected ? purchaseEvents(selected) : [];
  const baseLeads = useMemo(
    () =>
      leads.filter((lead) => {
        if (clientId && lead.client_id !== clientId) return false;
        const search = deferredQuery.trim().toLocaleLowerCase("pt-BR");
        if (
          search &&
          ![displayName(lead), lead.phone, lead.notes, lead.source_id]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(search)
        )
          return false;
        return true;
      }),
    [leads, clientId, deferredQuery],
  );
  const counts = useMemo(
    () => ({
      all: baseLeads.length,
      waiting: baseLeads.filter((lead) => unansweredCount(lead) > 0).length,
      sold: baseLeads.filter((lead) => purchaseEvents(lead).length > 0).length,
    }),
    [baseLeads, purchaseEvents],
  );
  const filtered = useMemo(
    () =>
      baseLeads
        .filter((lead) => {
          if (tab === "waiting" && unansweredCount(lead) === 0) return false;
          if (tab === "sold" && purchaseEvents(lead).length === 0) return false;
          if (origin === "ad" && !(lead.source_id || realClick(lead)))
            return false;
          if (origin === "organic" && (lead.source_id || realClick(lead)))
            return false;
          if (
            origin === "pix" &&
            !/pix|comprovante/i.test(
              [
                lead.notes || "",
                ...messagesFor(lead).map((message) => message.text || ""),
              ].join(" "),
            )
          )
            return false;
          return true;
        })
        .sort((a, b) => latestTime(b) - latestTime(a)),
    [baseLeads, tab, origin, purchaseEvents],
  );
  const messages = useMemo(
    () =>
      selected
        ? messagesFor(selected)
            .slice()
            .sort(
              (a, b) =>
                timestamp(a, selected.first_seen_at) -
                timestamp(b, selected.first_seen_at),
            )
        : [],
    [selected],
  );
  const messageSignature = messages.length
    ? `${selected?.id}:${messages.length}:${messages.at(-1)?.id || messages.at(-1)?.at || ""}:${messages.at(-1)?.text || ""}`
    : `${selected?.id}:empty`;

  useEffect(() => {
    let arrived = false;
    for (const lead of leads) {
      const incoming = messagesFor(lead)
        .filter((message) => !message.fromMe)
        .at(-1);
      if (!incoming) continue;
      const time = timestamp(incoming, lead.first_seen_at);
      const before = inboundTimes.current.get(lead.id);
      if (before !== undefined && time > before) arrived = true;
      inboundTimes.current.set(lead.id, Math.max(before || 0, time));
    }
    if (arrived && initialSoundEnabled && window.AudioContext) {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = "sine";
      tone.frequency.value = 660;
      volume.gain.value = 0.035;
      tone.connect(volume);
      volume.connect(audio.destination);
      void audio
        .resume()
        .then(() => {
          tone.start();
          tone.stop(audio.currentTime + 0.12);
          tone.onended = () => {
            void audio.close();
          };
        })
        .catch(() => {
          void audio.close();
        });
    }
  }, [leads, initialSoundEnabled]);
  useEffect(() => {
    document.title =
      (initialBadgeEnabled && counts.waiting
        ? "(" + counts.waiting + ") "
        : "") + "Conversas · Track Manual";
    return () => {
      document.title = "Track Manual";
    };
  }, [counts.waiting, initialBadgeEnabled]);

  const refresh = useCallback(
    async (manual = false) => {
      if (document.hidden && !manual) return;
      if (abortRef.current) {
        if (!manual) return;
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      if (manual) setRefreshing(true);
      const params = new URLSearchParams({
        summary: "1",
        limit: String(listLimitRef.current),
        message_limit: String(messageLimit),
      });
      if (clientId) params.set("cliente", clientId);
      if (deferredQuery.trim()) params.set("q", deferredQuery.trim());
      if (selectedId) params.set("lead", selectedId);
      try {
        const response = await fetch(`/api/conversas/live?${params}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: etagRef.current ? { "If-None-Match": etagRef.current } : {},
        });
        if (response.status === 304) {
          setLastUpdated(new Date().toISOString());
          setLiveError(null);
          return;
        }
        if (response.status === 401)
          throw new Error(
            "Sua sessão expirou. Entre novamente para continuar.",
          );
        if (!response.ok)
          throw new Error(
            "Não foi possível atualizar as conversas. Os dados exibidos podem estar desatualizados.",
          );
        const json = (await response.json()) as LiveResponse;
        if (!json.ok || !json.leads)
          throw new Error(json.error || "A atualização não foi concluída.");
        if (controller.signal.aborted) return;
        etagRef.current = response.headers.get("etag") || "";
        setLeads(json.leads);
        if (json.adsData) setAds(json.adsData);
        if (json.eventsData) setEvents(json.eventsData);
        setHasMore(Boolean(json.hasMore));
        setLastUpdated(new Date().toISOString());
        setLiveError(null);
      } catch (error) {
        if (!controller.signal.aborted)
          setLiveError(
            error instanceof Error ? error.message : "Falha de conexão.",
          );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setRefreshing(false);
        }
      }
    },
    [clientId, deferredQuery, selectedId, messageLimit],
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    etagRef.current = "";
    const tick = async () => {
      await refresh();
      if (active) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 200);
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      abortRef.current?.abort();
      abortRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, listLimit]);

  useEffect(() => {
    const node = chatRef.current;
    if (!node) return;
    if (previousThreadRef.current !== selectedId) {
      previousThreadRef.current = selectedId || "";
      nearBottomRef.current = true;
      node.scrollTop = node.scrollHeight;
      setNewMessages(false);
    } else if (nearBottomRef.current) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    } else {
      setNewMessages(true);
    }
  }, [messageSignature, selectedId]);

  const chooseLead = (lead: Lead) => {
    setSelectedId(lead.id);
    setMobileView("chat");
    setThreadSearch("");
    setShowMenu(false);
    setMessageLimit(100);
    setCtwaNotice(null);
    setNoteStatus(null);
    setShowAdForm(false);
  };
  const changeClient = (value: string) => {
    setClientId(value);
    setSelectedId(null);
    setMobileView("list");
    setListLimit(100);
    setMessageLimit(100);
    const params = new URLSearchParams(window.location.search);
    params.delete("lead");
    if (value) params.set("cliente", value);
    else params.delete("cliente");
    window.history.replaceState(
      null,
      "",
      "/conversas" + (params.size ? "?" + params : ""),
    );
  };
  const setDraft = (value: string) => {
    if (selected)
      setDrafts((previous) => ({ ...previous, [selected.id]: value }));
  };
  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!selected || !draft.trim() || isSending) return;
    const recipient = selected;
    const content = draft.trim();
    setSending((previous) => ({ ...previous, [recipient.id]: true }));
    setMessageErrors((previous) => ({ ...previous, [recipient.id]: "" }));
    try {
      const result = await sendWhatsAppMessageAction(
        recipient.client_id,
        recipient.phone,
        content,
      );
      if (!result.ok)
        throw new Error(
          result.error ||
            "Não foi possível enviar. Verifique a conexão do WhatsApp.",
        );
      if (result.warning)
        setMessageErrors((previous) => ({
          ...previous,
          [recipient.id]: result.warning!,
        }));
      setDrafts((previous) => ({
        ...previous,
        [recipient.id]:
          previous[recipient.id]?.trim() === content
            ? ""
            : previous[recipient.id] || "",
      }));
      etagRef.current = "";
      await refresh(true);
    } catch (error) {
      setMessageErrors((previous) => ({
        ...previous,
        [recipient.id]:
          error instanceof Error ? error.message : "Falha no envio.",
      }));
    } finally {
      setSending((previous) => ({ ...previous, [recipient.id]: false }));
    }
  };
  const sendMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !selected || isSending) return;
    const recipient = selected;
    const caption = draft.trim();
    if (file.size > 5 * 1024 * 1024) {
      setMessageErrors((previous) => ({
        ...previous,
        [recipient.id]: "O arquivo deve ter no máximo 5 MB.",
      }));
      return;
    }
    setSending((previous) => ({ ...previous, [recipient.id]: true }));
    setMessageErrors((previous) => ({ ...previous, [recipient.id]: "" }));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const result = await sendWhatsAppMediaAction(
        recipient.client_id,
        recipient.phone,
        {
          base64,
          mimetype: file.type || "application/octet-stream",
          filename: file.name,
          caption: caption || undefined,
        },
      );
      if (!result.ok)
        throw new Error(result.error || "Não foi possível enviar o arquivo.");
      if (result.warning)
        setMessageErrors((previous) => ({
          ...previous,
          [recipient.id]: result.warning!,
        }));
      setDrafts((previous) => ({
        ...previous,
        [recipient.id]:
          previous[recipient.id]?.trim() === caption
            ? ""
            : previous[recipient.id] || "",
      }));
      etagRef.current = "";
      await refresh(true);
    } catch (error) {
      setMessageErrors((previous) => ({
        ...previous,
        [recipient.id]:
          error instanceof Error ? error.message : "Falha no envio do arquivo.",
      }));
    } finally {
      setSending((previous) => ({ ...previous, [recipient.id]: false }));
    }
  };
  const saveNotes = async () => {
    if (!selected || noteSaving) return;
    const recipient = selected;
    const notes = noteDrafts[recipient.id] ?? recipient.notes ?? "";
    setNoteSaving(true);
    setNoteStatus(null);
    try {
      const result = await saveLeadNotesAction(recipient.id, notes);
      if (!result.ok) throw new Error(result.message);
      setLeads((previous) =>
        previous.map((lead) =>
          lead.id === recipient.id ? { ...lead, notes } : lead,
        ),
      );
      setNoteStatus(result.message);
    } catch (error) {
      setNoteStatus(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a anotação.",
      );
    } finally {
      setNoteSaving(false);
    }
  };
  const recoverCtwa = async () => {
    if (!selected || ctwaBusy) return;
    const recipient = selected;
    setCtwaBusy(true);
    setCtwaNotice(null);
    try {
      const result = await pullCtwaFromPhoneAction(recipient.id);
      setCtwaNotice(result.message);
      etagRef.current = "";
      await refresh(true);
    } catch (error) {
      setCtwaNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível recuperar o rastreio.",
      );
    } finally {
      setCtwaBusy(false);
    }
  };
  const assignAd = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || adBusy) return;
    setAdBusy(true);
    setCtwaNotice(null);
    try {
      const result = await setLeadAdAction(selected.id, adInput);
      setCtwaNotice(result.message);
      if (result.ok) {
        setShowAdForm(false);
        etagRef.current = "";
        await refresh(true);
      }
    } catch (error) {
      setCtwaNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível vincular o anúncio.",
      );
    } finally {
      setAdBusy(false);
    }
  };
  const openSale = () => {
    if (!selected) return;
    setSale({
      lead: selected,
      input: {
        leadId: selected.id,
        eventName: "Purchase",
        value: "",
        currency: selectedClient?.default_currency || "BRL",
        contentName: "",
        eventTimeIso: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      preview: null,
    });
    setSaleConfirmed(false);
    setSaleNotice(null);
  };
  const previewSale = async (event: FormEvent) => {
    event.preventDefault();
    if (!sale || saleBusy) return;
    const snapshot = { ...sale.input };
    setSaleBusy(true);
    setSaleNotice(null);
    try {
      const preview = await previewEventAction(snapshot);
      setSale((previous) =>
        previous ? { ...previous, input: snapshot, preview } : previous,
      );
    } catch (error) {
      setSaleNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível conferir a venda.",
      );
    } finally {
      setSaleBusy(false);
    }
  };
  const confirmSale = async () => {
    if (
      !sale?.preview?.ok ||
      saleBusy ||
      (sale.preview.alreadySent > 0 && !saleConfirmed)
    )
      return;
    const snapshot = { ...sale.input, confirmNewSale: saleConfirmed };
    setSaleBusy(true);
    setSaleNotice(null);
    try {
      const result = await sendEventAction(snapshot);
      setSaleNotice(result.message);
      if (result.sent) {
        setSale((previous) =>
          previous
            ? {
                ...previous,
                preview: null,
                input: {
                  ...previous.input,
                  idempotencyKey: snapshot.idempotencyKey,
                },
              }
            : previous,
        );
        etagRef.current = "";
        await refresh(true);
      }
    } catch (error) {
      setSaleNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a venda.",
      );
    } finally {
      setSaleBusy(false);
    }
  };
  const copyPhone = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessageErrors((previous) => ({
        ...previous,
        [selected.id]:
          "Não foi possível copiar. O número está disponível nos detalhes do contato.",
      }));
    }
  };
  const exportConversation = () => {
    if (!selected) return;
    const content = [
      `Conversa com ${displayName(selected)}`,
      `Telefone: ${formatPhone(selected.phone)}`,
      `Cliente: ${clientNameMap[selected.client_id] || "—"}`,
      "",
      ...messages.map(
        (message) =>
          `${formatDateTime(new Date(timestamp(message, selected.first_seen_at)).toISOString())} · ${message.fromMe ? "Equipe" : displayName(selected)}: ${message.text?.startsWith("data:") ? "[Mídia]" : message.text || `[${message.type || "mensagem"}]`}`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `conversa-${selected.phone}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShowMenu(false);
  };
  const jumpToLatest = () => {
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth",
    });
    nearBottomRef.current = true;
    setNewMessages(false);
  };
  const searchMatches = threadSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleMessages = searchMatches
    ? messages.filter((message) =>
        (message.text || message.caption || message.filename || "")
          .toLocaleLowerCase("pt-BR")
          .includes(searchMatches),
      )
    : messages;
  const shortcuts = draft.startsWith("/")
    ? SHORTCUTS.filter((shortcut) => shortcut.key.startsWith(draft.trim()))
    : [];
  const notesValue = selected
    ? (noteDrafts[selected.id] ?? selected.notes ?? "")
    : "";
  const purchaseTotal = selectedPurchases.reduce(
    (sum, event) => sum + (event.value || 0),
    0,
  );

  return (
    <div className={styles.workspace}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>RELACIONAMENTO</div>
          <h1>
            Central de conversas <span>{counts.all}</span>
          </h1>
          <p>
            Converse, acompanhe oportunidades e transforme atendimento em
            resultado.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void refresh(true)}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? styles.spin : ""} />
            <span>Atualizar</span>
          </button>
          <Link href="/leads/novo" className={styles.primaryButton}>
            <Plus size={16} />
            Novo contato
          </Link>
        </div>
      </div>
      {liveError && (
        <div className={styles.liveWarning} role="status">
          <CircleAlert size={16} />
          <span>{liveError}</span>
          {liveError.includes("sessão") ? (
            <Link href="/login">Entrar novamente</Link>
          ) : (
            <button type="button" onClick={() => void refresh(true)}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      <div
        className={styles.inbox}
        data-view={mobileView}
        data-details={showDetails}
      >
        <aside className={styles.listPanel} aria-label="Lista de conversas">
          <div className={styles.listHeading}>
            <div>
              <MessagesSquare size={20} />
              <h2>Caixa de entrada</h2>
            </div>
            <Link
              href="/leads/importar"
              className={styles.iconButton}
              title="Importar contatos"
              aria-label="Importar contatos"
            >
              <Plus size={18} />
            </Link>
          </div>
          <div className={styles.listFilters}>
            <label className={styles.searchBox}>
              <Search size={16} />
              <input
                aria-label="Buscar conversa"
                placeholder="Buscar nome, número ou anúncio"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Limpar busca"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <label className={styles.clientSelect}>
              <Users size={14} />
              <select
                aria-label="Filtrar por cliente"
                value={clientId}
                onChange={(event) => changeClient(event.target.value)}
              >
                <option value="">Todos os clientes</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Status das conversas"
          >
            {(
              [
                { id: "all", label: "Todas" },
                { id: "waiting", label: "Aguardando" },
                { id: "sold", label: "Com venda" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={tab === item.id ? styles.activeTab : ""}
              >
                {item.label}
                <span>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className={styles.listCaption}>
            <span>
              {filtered.length} conversa{filtered.length === 1 ? "" : "s"}
            </span>
            <select
              aria-label="Filtrar origem da conversa"
              value={origin}
              onChange={(event) =>
                setOrigin(event.target.value as OriginFilter)
              }
            >
              <option value="all">Todas as origens</option>
              <option value="ad">Com anúncio</option>
              <option value="organic">Sem anúncio</option>
              <option value="pix">Menção a Pix</option>
            </select>
          </div>
          <div className={styles.contactList}>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Search size={25} />}
                title="Nenhuma conversa"
                text="Experimente outro filtro ou cadastre um novo contato."
              />
            ) : (
              filtered.map((lead) => {
                const waiting = unansweredCount(lead);
                const sold = purchaseEvents(lead).length > 0;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => chooseLead(lead)}
                    className={`${styles.contact} ${selected?.id === lead.id ? styles.selectedContact : ""}`}
                    aria-current={selected?.id === lead.id ? "true" : undefined}
                  >
                    <Avatar lead={lead} />
                    <span className={styles.contactMain}>
                      <span className={styles.contactTop}>
                        <strong>{displayName(lead)}</strong>
                        <time suppressHydrationWarning>
                          {timeLabel(latestTime(lead))}
                        </time>
                      </span>
                      <span className={styles.contactSnippet}>
                        {messagesFor(lead).at(-1)?.fromMe && (
                          <Check size={13} />
                        )}
                        {snippet(lead)}
                      </span>
                      <span className={styles.contactBottom}>
                        <span className={styles.companyName}>
                          {clientNameMap[lead.client_id] || "Cliente"}
                        </span>
                        {sold ? (
                          <span className={styles.smallSuccess}>Venda</span>
                        ) : lead.source_id || realClick(lead) ? (
                          <span className={styles.smallTag}>
                            <Megaphone size={10} />
                            Anúncio
                          </span>
                        ) : (
                          <span className={styles.organicTag}>Orgânico</span>
                        )}
                      </span>
                    </span>
                    {waiting > 0 && (
                      <span
                        className={styles.unread}
                        title={`${waiting} mensagens aguardando resposta`}
                      >
                        {waiting > 99 ? "99+" : waiting}
                      </span>
                    )}
                  </button>
                );
              })
            )}
            {hasMore && (
              <button
                type="button"
                className={styles.loadMore}
                onClick={() =>
                  setListLimit((previous) => Math.min(previous + 100, 1000))
                }
                disabled={listLimit >= 1000 || refreshing}
              >
                {listLimit >= 1000
                  ? "Refine os filtros para ver mais contatos"
                  : "Carregar mais conversas"}
                <ChevronDown size={15} />
              </button>
            )}
          </div>
          <div className={styles.listFooter}>
            <span
              className={`${styles.statusDot} ${liveError ? styles.staleDot : ""}`}
            />
            <span>
              {liveError
                ? "Atualização interrompida"
                : "Sincronização automática"}
            </span>
            <time suppressHydrationWarning>
              {lastUpdated ? timeLabel(lastUpdated) : "—"}
            </time>
          </div>
        </aside>

        <section
          className={styles.thread}
          aria-label={
            selected ? `Conversa com ${displayName(selected)}` : "Conversa"
          }
        >
          {selected ? (
            <>
              <div className={styles.threadHeader}>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.mobileBack}`}
                  aria-label="Voltar para conversas"
                  onClick={() => setMobileView("list")}
                >
                  <ArrowLeft size={19} />
                </button>
                <Avatar lead={selected} />
                <div className={styles.threadIdentity}>
                  <h2>{displayName(selected)}</h2>
                  <span>
                    {formatPhone(selected.phone)}
                    <i />
                    {clientNameMap[selected.client_id] || "Cliente"}
                  </span>
                </div>
                <div className={styles.threadHeaderActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Buscar nesta conversa"
                    title="Buscar nesta conversa"
                    onClick={() => setShowThreadSearch((previous) => !previous)}
                  >
                    <Search size={18} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Detalhes do contato"
                    title="Detalhes do contato"
                    onClick={() => {
                      if (window.matchMedia("(max-width: 1320px)").matches) {
                        setShowDetails(true);
                        setMobileView("details");
                      } else {
                        setShowDetails((previous) => !previous);
                      }
                    }}
                  >
                    <Info size={18} />
                  </button>
                  <div className={styles.menuAnchor}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Mais opções da conversa"
                      aria-expanded={showMenu}
                      onClick={() => setShowMenu((previous) => !previous)}
                    >
                      <MoreHorizontal size={21} />
                    </button>
                    {showMenu && (
                      <div className={styles.dropdown}>
                        <Link href={`/leads/${selected.id}`}>
                          <ArrowUpRight size={15} />
                          Abrir cadastro completo
                        </Link>
                        <button type="button" onClick={exportConversation}>
                          <Download size={15} />
                          Exportar histórico exibido
                        </button>
                        <button type="button" onClick={() => void copyPhone()}>
                          <Copy size={15} />
                          {copied ? "Número copiado" : "Copiar número"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {showThreadSearch && (
                <label className={styles.threadSearch}>
                  <Search size={16} />
                  <input
                    aria-label="Buscar no histórico exibido"
                    placeholder="Buscar no histórico exibido…"
                    value={threadSearch}
                    onChange={(event) => setThreadSearch(event.target.value)}
                    autoFocus
                  />
                  <span>
                    {searchMatches
                      ? `${visibleMessages.length} resultado(s)`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Fechar busca"
                    onClick={() => {
                      setShowThreadSearch(false);
                      setThreadSearch("");
                    }}
                  >
                    <X size={16} />
                  </button>
                </label>
              )}
              {(selected.source_id || realClick(selected)) && (
                <div className={styles.originBanner}>
                  <span>
                    <Megaphone size={16} />
                  </span>
                  <div>
                    <strong>
                      {selectedAd?.campaign_name ||
                        selected.headline ||
                        "Conversa iniciada por anúncio"}
                    </strong>
                    <p>
                      {realClick(selected)
                        ? "Identificador de clique recebido"
                        : "Anúncio identificado · clique ainda não confirmado"}
                    </p>
                  </div>
                  {selected.source_url &&
                    /^https?:\/\//.test(selected.source_url) && (
                      <a
                        href={selected.source_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Abrir anúncio de origem"
                      >
                        <ArrowUpRight size={18} />
                      </a>
                    )}
                </div>
              )}
              <div
                ref={chatRef}
                className={styles.timeline}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  nearBottomRef.current =
                    node.scrollHeight - node.scrollTop - node.clientHeight <
                    100;
                  if (nearBottomRef.current) setNewMessages(false);
                }}
              >
                {Boolean(leadRaw(selected).conversation_has_more) &&
                  !searchMatches && (
                    <button
                      type="button"
                      className={styles.historyButton}
                      onClick={() =>
                        setMessageLimit((previous) =>
                          Math.min(previous + 100, 1000),
                        )
                      }
                      disabled={messageLimit >= 1000 || refreshing}
                    >
                      <Clock3 size={14} />
                      {messageLimit >= 1000
                        ? "Limite de histórico exibido atingido"
                        : "Carregar mensagens anteriores"}
                    </button>
                  )}
                <div className={styles.historyNotice}>
                  <ShieldCheck size={12} />
                  Histórico sincronizado do WhatsApp · acesso restrito à sua
                  equipe
                </div>
                {visibleMessages.length === 0 ? (
                  <EmptyState
                    icon={<MessageCircle size={29} />}
                    title={
                      searchMatches
                        ? "Nenhuma mensagem encontrada"
                        : "Sua próxima conversa começa aqui"
                    }
                    text={
                      searchMatches
                        ? "Experimente outra palavra no histórico carregado."
                        : "As mensagens recebidas e enviadas aparecerão neste histórico após a sincronização."
                    }
                  />
                ) : (
                  visibleMessages.map((message, index) => {
                    const at = new Date(
                      timestamp(message, selected.first_seen_at),
                    );
                    const previous = visibleMessages[index - 1];
                    const dateKey = at.toLocaleDateString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    });
                    const previousKey = previous
                      ? new Date(
                          timestamp(previous, selected.first_seen_at),
                        ).toLocaleDateString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : "";
                    const source = mediaSource(message);
                    const isImage =
                      message.type === "image" ||
                      Boolean(source?.startsWith("data:image/"));
                    const isAudio =
                      message.type === "audio" ||
                      Boolean(source?.startsWith("data:audio/"));
                    const isVideo =
                      message.type === "video" ||
                      Boolean(source?.startsWith("data:video/"));
                    const isDocument =
                      message.type === "document" || message.type === "file";
                    const text =
                      message.text && !message.text.startsWith("data:")
                        ? message.text
                        : message.caption;
                    return (
                      <div
                        key={
                          message.id ||
                          message.message_id ||
                          `${message.at}:${index}`
                        }
                      >
                        {dateKey !== previousKey && (
                          <div className={styles.daySeparator}>
                            <span>{dateKey}</span>
                          </div>
                        )}
                        <div
                          className={`${styles.messageRow} ${message.fromMe ? styles.outgoingRow : ""}`}
                        >
                          <div
                            className={`${styles.bubble} ${message.fromMe ? styles.outgoing : ""}`}
                          >
                            {!message.fromMe && (
                              <span className={styles.bubbleName}>
                                {displayName(selected).split(" ")[0]}
                              </span>
                            )}
                            {isAudio ? (
                              source ? (
                                <audio
                                  controls
                                  preload="none"
                                  src={source}
                                  aria-label={`Áudio ${message.fromMe ? "enviado" : "recebido"}`}
                                />
                              ) : (
                                <div className={styles.unavailableMedia}>
                                  <CircleAlert size={18} />
                                  <span>
                                    Áudio sem arquivo disponível
                                    <small>
                                      O provedor ainda não sincronizou esta
                                      mídia.
                                    </small>
                                  </span>
                                </div>
                              )
                            ) : isImage ? (
                              source ? (
                                <button
                                  type="button"
                                  className={styles.imageButton}
                                  onClick={() => setLightbox(source)}
                                  aria-label="Ampliar imagem"
                                >
                                  <img
                                    src={source}
                                    alt={
                                      message.caption || "Imagem da conversa"
                                    }
                                    loading="lazy"
                                  />
                                </button>
                              ) : (
                                <div className={styles.unavailableMedia}>
                                  <ImageIcon size={20} />
                                  <span>
                                    Imagem não disponível
                                    <small>
                                      Sincronize a mídia no provedor de origem.
                                    </small>
                                  </span>
                                </div>
                              )
                            ) : isVideo ? (
                              source ? (
                                <video src={source} controls preload="none" />
                              ) : (
                                <div className={styles.unavailableMedia}>
                                  <FileText size={19} />
                                  Vídeo não disponível
                                </div>
                              )
                            ) : isDocument ? (
                              source ? (
                                <a
                                  href={source}
                                  download={message.filename || "documento"}
                                  className={styles.documentLink}
                                >
                                  <FileText size={24} />
                                  <span>
                                    {message.filename || "Documento"}
                                    <small>Baixar arquivo</small>
                                  </span>
                                  <Download size={16} />
                                </a>
                              ) : (
                                <div className={styles.unavailableMedia}>
                                  <FileText size={20} />
                                  <span>
                                    {message.filename || "Documento"}
                                    <small>Arquivo não sincronizado</small>
                                  </span>
                                </div>
                              )
                            ) : null}
                            {text &&
                              !(isAudio && /^\[?áudio/i.test(text)) &&
                              !(isImage && /^\[?imagem/i.test(text)) && (
                                <p>{text}</p>
                              )}
                            {!text &&
                              !isAudio &&
                              !isImage &&
                              !isVideo &&
                              !isDocument && (
                                <p>Mensagem sem conteúdo de texto.</p>
                              )}
                            <div className={styles.bubbleMeta}>
                              <time suppressHydrationWarning>
                                {timeLabel(at.getTime())}
                              </time>
                              {message.fromMe && (
                                <span title="Mensagem enviada pelo atendimento. Leitura não confirmada.">
                                  <Check size={13} />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {!searchMatches && selectedEvents.length > 0 && (
                  <div className={styles.eventHistory}>
                    {selectedEvents
                      .slice()
                      .sort(
                        (a, b) =>
                          Date.parse(a.created_at) - Date.parse(b.created_at),
                      )
                      .map((event) => (
                        <div
                          className={styles.eventPill}
                          key={`${event.event_name}:${event.event_id}`}
                        >
                          <BadgeCheck size={14} />
                          <span>
                            {event.event_name === "Purchase"
                              ? "Compra"
                              : event.event_name}{" "}
                            {event.value !== null
                              ? formatMoney(
                                  event.value,
                                  event.currency ||
                                    selectedClient?.default_currency ||
                                    "BRL",
                                )
                              : ""}
                            {event.is_test ? " · Teste" : ""}
                            <small>
                              {formatDateTime(event.created_at)} ·{" "}
                              {event.status === "enviado"
                                ? "Recebido pela Meta"
                                : "Envio com erro"}
                            </small>
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {newMessages && (
                <button
                  type="button"
                  className={styles.newMessages}
                  onClick={jumpToLatest}
                >
                  <ArrowDown size={15} />
                  Ir às mensagens recentes
                </button>
              )}
              <div className={styles.composerArea}>
                {messageErrors[selected.id] && (
                  <div role="alert" className={styles.messageError}>
                    <CircleAlert size={15} />
                    {messageErrors[selected.id]}
                  </div>
                )}
                {shortcuts.length > 0 && (
                  <div className={styles.shortcuts}>
                    <div>
                      <Zap size={14} />
                      Respostas rápidas
                    </div>
                    {shortcuts.map((shortcut) => (
                      <button
                        type="button"
                        key={shortcut.key}
                        onClick={() => {
                          setDraft(shortcut.text);
                          inputRef.current?.focus();
                        }}
                      >
                        <strong>{shortcut.key}</strong>
                        <span>{shortcut.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className={styles.composerLabel}>
                  <span>
                    <span className={styles.statusDot} />
                    Resposta pelo WhatsApp
                  </span>
                  <button type="button" onClick={openSale}>
                    <Wallet size={13} />
                    Registrar venda
                  </button>
                </div>
                <form
                  className={styles.composer}
                  onSubmit={(event) => void sendMessage(event)}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,audio/*,video/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
                    hidden
                    onChange={(event) => void sendMedia(event)}
                  />
                  <button
                    type="button"
                    className={styles.attachButton}
                    aria-label="Anexar arquivo de até 5 MB"
                    title="Anexar arquivo · até 5 MB"
                    onClick={() => fileRef.current?.click()}
                    disabled={isSending}
                  >
                    <Paperclip size={20} />
                  </button>
                  <textarea
                    ref={inputRef}
                    rows={2}
                    aria-label={`Responder para ${displayName(selected)}`}
                    placeholder={`Responder para ${displayName(selected).split(" ")[0]}…`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        if (shortcuts.length === 1) setDraft(shortcuts[0].text);
                        else void sendMessage();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={isSending || !draft.trim()}
                    aria-label={
                      isSending ? "Enviando mensagem" : "Enviar mensagem"
                    }
                  >
                    {isSending ? (
                      <Loader2 size={19} className={styles.spin} />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </form>
                <div className={styles.composerHint}>
                  <span>
                    <kbd>Enter</kbd> envia · <kbd>Shift + Enter</kbd> nova linha
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("/");
                      inputRef.current?.focus();
                    }}
                  >
                    <Zap size={12} />
                    Atalhos
                  </button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<MessagesSquare size={35} />}
              title="Tudo começa com uma boa conversa"
              text="Selecione um contato à esquerda para acompanhar o histórico e continuar o atendimento."
            />
          )}
        </section>

        <aside className={styles.detailsPanel} aria-label="Detalhes do contato">
          {selected ? (
            <>
              <div className={styles.detailsHeading}>
                <h2>Detalhes do contato</h2>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="Fechar detalhes"
                  onClick={() => {
                    setShowDetails(false);
                    setMobileView("chat");
                  }}
                >
                  <X size={17} />
                </button>
              </div>
              <div className={styles.profile}>
                <Avatar lead={selected} large />
                <h3>{displayName(selected)}</h3>
                <span>{clientNameMap[selected.client_id] || "Cliente"}</span>
                <div className={styles.profileTags}>
                  <span
                    className={
                      selectedPurchases.length > 0
                        ? styles.successTag
                        : styles.neutralTag
                    }
                  >
                    {selectedPurchases.length > 0
                      ? "Cliente"
                      : unansweredCount(selected) > 0
                        ? "Aguardando resposta"
                        : "Em atendimento"}
                  </span>
                  {realClick(selected) && (
                    <span className={styles.trackingTag}>
                      <ShieldCheck size={11} />
                      CTWA recebido
                    </span>
                  )}
                </div>
                <Link
                  href={`/leads/${selected.id}`}
                  className={styles.profileLink}
                >
                  Abrir cadastro completo
                  <ArrowUpRight size={13} />
                </Link>
              </div>
              <div className={styles.detailSection}>
                <h3>
                  <Users size={14} />
                  Informações
                </h3>
                <div className={styles.infoRow}>
                  <span>Telefone</span>
                  <div>
                    {formatPhone(selected.phone)}
                    <button
                      type="button"
                      className={styles.tinyButton}
                      onClick={() => void copyPhone()}
                      aria-label="Copiar telefone"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <span>E-mail</span>
                  <div>{selected.email || "Não informado"}</div>
                </div>
                <div className={styles.infoRow}>
                  <span>Localização</span>
                  <div>
                    {[selected.city, selected.state]
                      .filter(Boolean)
                      .join(", ") || "Não informada"}
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <span>Primeiro contato</span>
                  <div>
                    {new Date(selected.first_seen_at).toLocaleDateString(
                      "pt-BR",
                      { timeZone: "America/Sao_Paulo" },
                    )}
                  </div>
                </div>
              </div>
              <div className={styles.detailSection}>
                <div className={styles.sectionTitle}>
                  <h3>
                    <Megaphone size={14} />
                    Origem da conversa
                  </h3>
                  <button
                    type="button"
                    className={styles.tinyButton}
                    title="Recuperar rastreio recebido"
                    aria-label="Recuperar rastreio recebido"
                    onClick={() => void recoverCtwa()}
                    disabled={ctwaBusy}
                  >
                    {ctwaBusy ? (
                      <Loader2 size={13} className={styles.spin} />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                  </button>
                </div>
                {selected.source_id || realClick(selected) ? (
                  <div className={styles.adCard}>
                    {selected.thumbnail_url || selectedAd?.thumbnail_url ? (
                      <img
                        src={
                          selected.thumbnail_url ||
                          selectedAd?.thumbnail_url ||
                          ""
                        }
                        alt="Criativo do anúncio de origem"
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.adPlaceholder}>
                        <Megaphone size={23} />
                        <span>Meta Ads</span>
                      </div>
                    )}
                    <div>
                      <span className={styles.adLabel}>
                        ANÚNCIO IDENTIFICADO
                      </span>
                      <strong>
                        {selectedAd?.ad_name ||
                          selected.headline ||
                          "Anúncio de origem"}
                      </strong>
                      <p>
                        {selectedAd?.campaign_name ||
                          selected.ad_body ||
                          "Campanha não sincronizada"}
                      </p>
                      <span className={styles.adId}>
                        ID: {selected.source_id || "Não informado"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.organicCard}>
                    <MessageCircle size={19} />
                    <strong>Origem sem anúncio</strong>
                    <p>Nenhum anúncio identificado nos dados recebidos.</p>
                  </div>
                )}
                <p className={styles.attributionHelp}>
                  {realClick(selected)
                    ? "Token de clique preservado. O recebimento do evento não garante atribuição pela Meta."
                    : "Identificar um anúncio não substitui o token de clique CTWA."}
                </p>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    setShowAdForm((previous) => !previous);
                    setAdInput(selected.source_id || "");
                  }}
                >
                  {showAdForm ? "Cancelar vínculo" : "Vincular anúncio"}
                  <ChevronRight size={13} />
                </button>
                {showAdForm && (
                  <form
                    onSubmit={(event) => void assignAd(event)}
                    className={styles.adForm}
                  >
                    <input
                      aria-label="ID do anúncio"
                      placeholder="ID numérico do anúncio"
                      value={adInput}
                      onChange={(event) => setAdInput(event.target.value)}
                      inputMode="numeric"
                      required
                    />
                    <button
                      type="submit"
                      className={styles.secondaryButton}
                      disabled={adBusy}
                    >
                      {adBusy ? "Salvando…" : "Salvar anúncio"}
                    </button>
                  </form>
                )}
                {ctwaNotice && (
                  <p className={styles.inlineNotice} role="status">
                    {ctwaNotice}
                  </p>
                )}
              </div>
              <div className={styles.detailSection}>
                <h3>
                  <Wallet size={14} />
                  Relacionamento
                </h3>
                <div className={styles.revenueRow}>
                  <div>
                    <span>Compras registradas</span>
                    <strong>
                      {formatMoney(
                        purchaseTotal,
                        selectedClient?.default_currency || "BRL",
                      )}
                    </strong>
                  </div>
                  <span>
                    {selectedPurchases.length} venda
                    {selectedPurchases.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.saleButton}
                  onClick={openSale}
                >
                  <Plus size={15} />
                  Registrar uma venda
                </button>
              </div>
              <div className={styles.detailSection}>
                <div className={styles.sectionTitle}>
                  <h3>
                    <FileText size={14} />
                    Anotações internas
                  </h3>
                  <span className={styles.privateLabel}>Só sua equipe</span>
                </div>
                <textarea
                  aria-label="Anotações internas do contato"
                  placeholder="Contexto, preferências e próximos passos…"
                  value={notesValue}
                  onChange={(event) =>
                    setNoteDrafts((previous) => ({
                      ...previous,
                      [selected.id]: event.target.value,
                    }))
                  }
                  rows={4}
                />
                <button
                  type="button"
                  className={styles.noteSave}
                  onClick={() => void saveNotes()}
                  disabled={noteSaving || notesValue === (selected.notes || "")}
                >
                  {noteSaving ? "Salvando…" : "Salvar anotação"}
                  <Check size={13} />
                </button>
                {noteStatus && (
                  <p className={styles.inlineNotice} role="status">
                    {noteStatus}
                  </p>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Info size={25} />}
              title="Contexto do contato"
              text="Os detalhes e a origem aparecerão aqui quando você abrir uma conversa."
            />
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(sale)}
        title="Registrar uma venda"
        onClose={() => {
          if (!saleBusy) setSale(null);
        }}
      >
        {sale && (
          <form
            onSubmit={(event) => void previewSale(event)}
            className={styles.saleForm}
          >
            <div className={styles.saleRecipient}>
              <Avatar lead={sale.lead} />
              <div>
                <strong>{displayName(sale.lead)}</strong>
                <span>
                  {clientNameMap[sale.lead.client_id]} ·{" "}
                  {formatPhone(sale.lead.phone)}
                </span>
              </div>
            </div>
            <label>
              Valor da venda
              <span className={styles.moneyInput}>
                <span>{sale.input.currency}</span>
                <input
                  aria-label="Valor da venda"
                  placeholder="0,00"
                  inputMode="decimal"
                  required
                  disabled={saleBusy || Boolean(sale.preview)}
                  value={sale.input.value}
                  onChange={(event) =>
                    setSale((previous) =>
                      previous
                        ? {
                            ...previous,
                            input: {
                              ...previous.input,
                              value: event.target.value,
                            },
                          }
                        : previous,
                    )
                  }
                />
              </span>
            </label>
            <label>
              Produto ou serviço
              <input
                placeholder="Ex.: Plano mensal, pedido #123"
                disabled={saleBusy || Boolean(sale.preview)}
                value={sale.input.contentName}
                onChange={(event) =>
                  setSale((previous) =>
                    previous
                      ? {
                          ...previous,
                          input: {
                            ...previous.input,
                            contentName: event.target.value,
                          },
                        }
                      : previous,
                  )
                }
              />
            </label>
            <div className={styles.saleExplanation}>
              <ShieldCheck size={17} />
              <p>
                Você confere os dados antes do envio. Esta ação registra uma
                conversão na Meta; ela não envia mensagem ao contato.
              </p>
            </div>
            {sale.preview && (
              <div className={styles.previewPanel}>
                <div className={styles.previewHeading}>
                  <BadgeCheck size={18} />
                  <strong>
                    {sale.preview.isTest
                      ? "Evento de teste"
                      : "Conferência antes de enviar"}
                  </strong>
                </div>
                <p>
                  <strong>
                    {sale.preview.isTest
                      ? "Modo de teste: não é uma venda de produção."
                      : "Destino: API de Conversões da Meta."}
                  </strong>
                </p>
                {sale.preview.errors.map((error) => (
                  <p className={styles.previewError} key={error}>
                    {error}
                  </p>
                ))}
                {sale.preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                {sale.preview.alreadySent > 0 && (
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={saleConfirmed}
                      onChange={(event) =>
                        setSaleConfirmed(event.target.checked)
                      }
                      disabled={saleBusy}
                    />
                    <span>
                      Já existe compra enviada para este contato. Confirmo que
                      esta é uma venda nova.
                    </span>
                  </label>
                )}
                <details>
                  <summary>Ver dados do evento</summary>
                  <pre>{JSON.stringify(sale.preview.payload, null, 2)}</pre>
                </details>
              </div>
            )}
            {saleNotice && (
              <p className={styles.inlineNotice} role="status">
                {saleNotice}
              </p>
            )}
            <div className={styles.dialogActions}>
              {sale.preview ? (
                <>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={saleBusy}
                    onClick={() => {
                      setSale((previous) =>
                        previous ? { ...previous, preview: null } : previous,
                      );
                      setSaleConfirmed(false);
                    }}
                  >
                    Editar dados
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={
                      !sale.preview.ok ||
                      saleBusy ||
                      (sale.preview.alreadySent > 0 && !saleConfirmed)
                    }
                    onClick={() => void confirmSale()}
                  >
                    {saleBusy ? (
                      <Loader2 size={16} className={styles.spin} />
                    ) : (
                      <Send size={15} />
                    )}
                    {saleBusy
                      ? "Enviando…"
                      : sale.preview.isTest
                        ? "Enviar teste"
                        : "Confirmar e enviar"}
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={saleBusy}
                >
                  {saleBusy ? (
                    <Loader2 size={16} className={styles.spin} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  {saleBusy ? "Conferindo…" : "Conferir antes de enviar"}
                </button>
              )}
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(lightbox)}
        title="Imagem da conversa"
        onClose={() => setLightbox(null)}
      >
        {lightbox && (
          <img
            className={styles.lightboxImage}
            src={lightbox}
            alt="Imagem ampliada da conversa"
          />
        )}
      </Modal>
    </div>
  );
}
