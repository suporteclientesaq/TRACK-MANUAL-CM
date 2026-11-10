"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Cloud,
  Info,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  Monitor,
  PlugZap,
  Power,
  QrCode,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  UsersRound,
  Wifi,
  Zap,
} from "lucide-react";
import {
  configureAndConnectChannelAction,
  disconnectChannelAction,
} from "@/app/channel-actions";
import type {
  ChannelProvider,
  ChannelStatus,
  PublicChannelConfiguration,
} from "@/lib/channels";
import styles from "./Channels.module.css";
interface Client {
  id: string;
  name: string;
  configuration: PublicChannelConfiguration;
}
const PROVIDERS = [
  {
    id: "native" as const,
    title: "Conexão direta",
    subtitle: "Baileys",
    icon: Smartphone,
  },
  {
    id: "waha" as const,
    title: "WAHA",
    subtitle: "Servidor próprio",
    icon: Server,
  },
  {
    id: "evolution" as const,
    title: "Evolution",
    subtitle: "API externa",
    icon: Cloud,
  },
];
function statusFailure(error: string): ChannelStatus {
  return { ok: false, state: "close", qrcode: null, phone: null, error };
}

async function fetchChannelStatus(
  clientId: string,
  signal?: AbortSignal,
): Promise<ChannelStatus> {
  const timeout = AbortSignal.timeout(25_000);
  try {
    const response = await fetch(
      "/api/whatsapp/" + encodeURIComponent(clientId) + "/status",
      {
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (response.status === 401)
      return statusFailure("Sua sessão expirou. Entre novamente no Track Manual.");
    if (!response.ok && response.status !== 502)
      return statusFailure("Não foi possível consultar o canal.");
    return (await response.json()) as ChannelStatus;
  } catch {
    return statusFailure(
      timeout.aborted
        ? "O servidor demorou para responder. Tente atualizar o status."
        : "Não foi possível atualizar o canal. Confira a conexão e tente novamente.",
    );
  }
}

function mergePolledStatus(
  provider: ChannelProvider,
  previous: ChannelStatus | null,
  result: ChannelStatus,
): ChannelStatus {
  if (provider === "evolution" && result.ok && result.state === "connecting")
    return { ...result, qrcode: result.qrcode || previous?.qrcode || null };
  return result;
}

export function ChannelPanel({
  clients,
  nativeAvailable,
}: {
  clients: Client[];
  nativeAvailable: boolean;
}) {
  const [selected, setSelected] = useState(clients[0]?.id || "");
  const [configs, setConfigs] = useState<
    Record<string, PublicChannelConfiguration>
  >(() =>
    Object.fromEntries(
      clients.map((client) => [client.id, client.configuration]),
    ),
  );
  const [provider, setProvider] = useState<ChannelProvider>(
    clients[0]?.configuration.provider || "native",
  );
  const [url, setUrl] = useState(clients[0]?.configuration.serverUrl || "");
  const [session, setSession] = useState(
    clients[0]?.configuration.sessionName || "default",
  );
  const [key, setKey] = useState("");
  const [useDefaults, setUseDefaults] = useState(
    !!clients[0]?.configuration.managedByEnvironment,
  );
  const sequence = useRef(0);
  const operationBusy = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const draft =
    provider !== configs[selected]?.provider ||
    useDefaults !== !!configs[selected]?.managedByEnvironment ||
    !!key.trim() ||
    (!useDefaults &&
      (url !== configs[selected]?.serverUrl ||
        session !== configs[selected]?.sessionName));
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const client = clients.find((item) => item.id === selected);
  const waitingForQr =
    provider === "waha" &&
    status?.state === "connecting" &&
    !status.qrcode &&
    !status.error;
  useEffect(() => {
    setWaitingTooLong(false);
    if (!waitingForQr) return;
    const timer = setTimeout(() => setWaitingTooLong(true), 60_000);
    return () => clearTimeout(timer);
  }, [waitingForQr, selected]);
  useEffect(() => {
    const configuration = configs[selected];
    setProvider(configuration?.provider || "native");
    setUrl(configuration?.serverUrl || "");
    setSession(configuration?.sessionName || "default");
    setKey("");
    setUseDefaults(!!configuration?.managedByEnvironment);
    sequence.current++;
    setStatus(null);
    setNotice(null);
  }, [selected]);
  useEffect(() => {
    if (draft) {
      setStatus(null);
      setNotice(null);
    }
  }, [draft]);
  useEffect(() => {
    if (!selected || draft || busy) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden || operationBusy.current) return;
      pending = true;
      const version = sequence.current;
      try {
        const result = await fetchChannelStatus(selected, controller.signal);
        if (
          !controller.signal.aborted &&
          version === sequence.current &&
          selectedRef.current === selected
        )
          setStatus((previous) => mergePolledStatus(provider, previous, result));
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selected, draft, busy, provider]);
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (operationBusy.current) return;
    operationBusy.current = true;
    const request = ++sequence.current;
    const target = selected;
    setBusy(true);
    setNotice(null);
    setStatus(null);
    try {
      const result = await configureAndConnectChannelAction(selected, {
        provider,
        serverUrl: url,
        sessionName: session,
        apiKey: key,
        useServerDefaults: provider === "waha" && useDefaults,
      });
      if (request !== sequence.current || target !== selectedRef.current)
        return;
      setStatus(result);
      if (result.configuration) {
        const configuration = result.configuration;
        setConfigs((previous) => ({
          ...previous,
          [selected]: {
            ...configuration,
            serverDefaultsAvailable:
              previous[selected]?.serverDefaultsAvailable,
          },
        }));
        setUrl(configuration.serverUrl);
        setSession(configuration.sessionName);
        setUseDefaults(!!configuration.managedByEnvironment);
        setKey("");
      }
      if (!result.ok) setNotice(result.error || "Não foi possível conectar.");
    } catch {
      if (request === sequence.current && target === selectedRef.current)
        setNotice("Falha ao conectar o canal. Consulte o estado antes de tentar novamente.");
    } finally {
      operationBusy.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (operationBusy.current) return;
    if (draft) {
      setNotice("Salve a configuração antes de consultar o canal.");
      return;
    }
    operationBusy.current = true;
    const request = ++sequence.current;
    const target = selected;
    setChecking(true);
    setNotice(null);
    try {
      const result = await fetchChannelStatus(target);
      if (request === sequence.current && selectedRef.current === target)
        setStatus((previous) => mergePolledStatus(provider, previous, result));
    } finally {
      operationBusy.current = false;
      setChecking(false);
    }
  };
  const disconnect = async () => {
    if (
      !window.confirm(
        "Desconectar o WhatsApp deste cliente? Será necessário parear novamente para retomar o atendimento.",
      )
    )
      return;
    operationBusy.current = true;
    sequence.current++;
    setBusy(true);
    try {
      const result = await disconnectChannelAction(selected);
      setNotice(
        result.ok
          ? "Canal desconectado."
          : result.error || "Não foi possível desconectar.",
      );
      if (result.ok)
        setStatus({ ok: true, state: "close", qrcode: null, phone: null });
    } catch {
      setNotice(
        "Não foi possível desconectar o canal. Consulte o estado antes de tentar novamente.",
      );
    } finally {
      operationBusy.current = false;
      setBusy(false);
    }
  };
  const qr =
    status?.qrcode && /^(data:image\/|https?:\/\/)/.test(status.qrcode)
      ? status.qrcode
      : null;
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>CONEXÕES</span>
          <h1>O seu atendimento começa aqui.</h1>
          <p>
            Conecte o WhatsApp de cada cliente e mantenha suas conversas no
            mesmo lugar.
          </p>
        </div>
        <span className={styles.secure}>
          <ShieldCheck size={15} />
          Credenciais no servidor
        </span>
      </div>
      <div className={styles.summary}>
        <span>
          <UsersRound size={16} />
          <strong>{clients.length}</strong>clientes
        </span>
        <span>
          <PlugZap size={16} />
          <strong>3</strong>formas de conectar
        </span>
        <span>
          <ShieldCheck size={16} />
          Configuração por cliente
        </span>
      </div>
      {!clients.length ? (
        <div className={styles.empty}>
          <MessageCircle size={35} />
          <h2>Primeiro, vamos conhecer sua empresa.</h2>
          <p>
            Cadastre um cliente para conectar o WhatsApp e receber os primeiros
            contatos.
          </p>
          <Link href="/clientes/novo">
            Cadastrar cliente
            <ArrowUpRight size={15} />
          </Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.clients}>
            <div>
              <h2>Seus canais</h2>
              <span>{clients.length}</span>
            </div>
            {clients.map((item) => (
              <button
                key={item.id}
                disabled={busy || checking}
                className={selected === item.id ? styles.activeClient : ""}
                onClick={() => setSelected(item.id)}
              >
                <span className={styles.avatar}>
                  {item.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {PROVIDERS.find((p) => p.id === configs[item.id]?.provider)
                      ?.title || "Conexão direta"}
                  </small>
                </span>
                <ChevronDown size={13} />
              </button>
            ))}
            <Link href="/clientes/novo">
              <Link2 size={13} />
              Cadastrar outro cliente
            </Link>
          </aside>
          <div className={styles.main}>
            <section className={styles.config}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>Configurar conexão</h2>
                  <p>{client?.name} · selecione o provedor do canal</p>
                </div>
                <span
                  className={
                    status?.state === "open" ? styles.online : styles.offline
                  }
                >
                  <i />
                  {status && !status.ok
                    ? "Falha na conexão"
                    : status?.state === "open"
                    ? "Conectado"
                    : status?.state === "connecting"
                      ? "Conectando"
                      : status
                        ? "Desconectado"
                        : draft
                          ? "Configuração pendente"
                          : "Consultando"}
                </span>
              </div>
              {configs[selected]?.configurationError && (
                <p className={styles.notice} role="status">
                  {configs[selected].configurationError}
                </p>
              )}
              <form onSubmit={connect}>
                <div className={styles.providers}>
                  {PROVIDERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        provider === item.id ? styles.activeProvider : ""
                      }
                      disabled={busy}
                      onClick={() => {
                        sequence.current++;
                        setProvider(item.id);
                        if (item.id !== "waha") setUseDefaults(false);
                        setStatus(null);
                        if (
                          item.id === "waha" &&
                          configs[selected]?.provider !== "waha"
                        )
                          setSession("default");
                      }}
                    >
                      <item.icon size={21} />
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                      {provider === item.id && (
                        <Check size={13} className={styles.check} />
                      )}
                    </button>
                  ))}
                </div>
                {provider === "native" ? (
                  <div className={styles.nativeNote}>
                    <Monitor size={20} />
                    <div>
                      <strong>Conexão direta com seu workspace</strong>
                      <p>
                        O WhatsApp se conecta ao servidor do Track Manual.
                        Mantenha o servidor em execução para receber mensagens
                        continuamente.
                      </p>
                      {!nativeAvailable && (
                        <p className={styles.warning}>
                          Esta hospedagem não mantém uma conexão contínua.
                          Selecione WAHA ou Evolution para usar um servidor
                          externo.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.fields}>
                    <p className={styles.serverHelp}>
                      {provider === "waha" ? (
                        <>
                          O WAHA deve estar instalado e em execução na VPS. Estes
                          dados ligam o Track Manual ao serviço. No WAHA Core,
                          use a sessão <strong>default</strong>.
                        </>
                      ) : (
                        "Informe o endereço da sua instalação Evolution, a sessão e a chave de API."
                      )}
                    </p>
                    {provider === "waha" &&
                      configs[selected]?.serverDefaultsAvailable && (
                        <label className={styles.environmentOption}>
                          <input
                            type="checkbox"
                            checked={useDefaults}
                            onChange={(event) => {
                              sequence.current++;
                              setUseDefaults(event.target.checked);
                              setStatus(null);
                            }}
                          />
                          Usar WAHA da VPS configurado no ambiente do servidor
                        </label>
                      )}
                    {useDefaults && provider === "waha" ? (
                      <p>
                        O endereço, a sessão e a chave são lidos no servidor.
                        Você não precisa digitar a chave aqui.
                      </p>
                    ) : (
                      <>
                        <label>
                          Endereço do servidor
                          <span>
                            <Server size={14} />
                            <input
                              type="url"
                              required
                              placeholder="https://seu-servidor.exemplo.com"
                              value={url}
                              onChange={(event) => setUrl(event.target.value)}
                            />
                          </span>
                        </label>
                        <div>
                          <label>
                            Nome da sessão
                            <input
                              required
                              value={session}
                              onChange={(event) =>
                                setSession(event.target.value)
                              }
                              placeholder={
                                provider === "waha"
                                  ? "default"
                                  : "minha-empresa"
                              }
                            />
                          </label>
                          <label>
                            {provider === "waha"
                              ? "Chave de API do WAHA"
                              : "Chave de acesso"}
                            <span>
                              <KeyRound size={14} />
                              <input
                                type="password"
                                autoComplete="new-password"
                                value={key}
                                onChange={(event) => setKey(event.target.value)}
                                placeholder={
                                  configs[selected]?.provider === provider &&
                                  configs[selected]?.serverUrl === url &&
                                  configs[selected]?.hasApiKey
                                    ? "Salva · preencha para substituir"
                                    : "Chave do provedor"
                                }
                              />
                            </span>
                          </label>
                        </div>
                      </>
                    )}
                    <p>
                      <ShieldCheck size={12} />
                      {provider === "waha" && useDefaults
                        ? "A chave permanece no ambiente do servidor e não é devolvida ao navegador."
                        : "A chave salva no banco é criptografada e não é devolvida ao navegador."}
                    </p>
                  </div>
                )}
                {notice && !status?.error && (
                  <div className={styles.notice} role="status">
                    <Info size={15} />
                    {notice}
                  </div>
                )}
                {status?.error && (
                  <div className={styles.notice} role="status">
                    <CircleAlert size={15} />
                    {status.error}
                  </div>
                )}
                <div className={styles.formFooter}>
                  <span>
                    <ShieldCheck size={13} />
                    Cada cliente tem sua própria conexão.
                  </span>
                  <button
                    className={styles.primary}
                    type="submit"
                    disabled={
                      busy || (provider === "native" && !nativeAvailable)
                    }
                  >
                    {busy ? (
                      <Loader2 size={15} className={styles.spin} />
                    ) : (
                      <Zap size={15} />
                    )}{" "}
                    {busy
                      ? "Conectando…"
                      : status?.state === "open"
                        ? "Salvar e verificar"
                        : "Salvar e conectar"}
                  </button>
                </div>
              </form>
            </section>
            <div className={styles.bottomCards}>
              <div>
                <span>
                  <MessageCircle size={18} />
                </span>
                <h3>Atenda com todo o contexto</h3>
                <p>
                  Depois de conectar, acompanhe as mensagens, notas e origem do
                  anúncio na central.
                </p>
                <Link href="/conversas">
                  Abrir conversas
                  <ArrowUpRight size={13} />
                </Link>
              </div>
              <div>
                <span>
                  <ShieldCheck size={18} />
                </span>
                <h3>Dados no cliente certo</h3>
                <p>
                  O canal recebe contatos pelo endereço de integração da empresa
                  selecionada.
                </p>
                <Link href={"/clientes/" + selected}>
                  Ver integrações
                  <ArrowUpRight size={13} />
                </Link>
              </div>
            </div>
          </div>
          <aside className={styles.qrCard}>
            <div className={styles.qrHeading}>
              <QrCode size={18} />
              <h2>Parear WhatsApp</h2>
              <button
                aria-label="Atualizar status"
                onClick={() => void refresh()}
                disabled={checking || busy}
              >
                <RefreshCw size={15} className={checking ? styles.spin : ""} />
              </button>
            </div>
            <div className={styles.qrArea}>
              {status?.state === "open" ? (
                <div className={styles.connected}>
                  <CheckCircle2 size={50} />
                  <strong>Você está conectado.</strong>
                  <span>
                    {status.phone
                      ? "+" + status.phone
                      : "Canal pronto para atendimento"}
                  </span>
                </div>
              ) : qr ? (
                <img
                  src={qr}
                  alt={"QR Code de pareamento para " + client?.name}
                />
              ) : (
                <div className={styles.qrPlaceholder}>
                  {status?.state === "connecting" && !status.error && !waitingTooLong ? (
                    <Loader2 size={46} className={styles.spin} />
                  ) : (
                    <QrCode size={58} strokeWidth={1} />
                  )}
                  <strong>
                    {status?.error
                      ? "QR Code indisponível"
                      : waitingTooLong
                        ? "O WAHA ainda não enviou o QR Code"
                      : status?.state === "connecting"
                      ? "Preparando seu QR Code…"
                      : "Pronto para conectar?"}
                  </strong>
                  <p>
                    {status?.error
                      ? "Veja a mensagem no painel de configuração do canal."
                      : waitingTooLong
                        ? "Confira a sessão no painel do WAHA e tente novamente."
                        : status?.providerStatus === "STARTING"
                          ? "O WAHA está iniciando a sessão."
                          : status?.providerStatus === "SCAN_QR_CODE"
                            ? "Aguardando o código de pareamento do WAHA."
                            : "Salve a configuração para gerar o código de pareamento."}
                  </p>
                </div>
              )}
            </div>
            <ol>
              <li>
                <span>1</span>Abra o WhatsApp no celular.
              </li>
              <li>
                <span>2</span>Toque em Aparelhos conectados.
              </li>
              <li>
                <span>3</span>Selecione Conectar um aparelho e escaneie o
                código.
              </li>
            </ol>
            <div className={styles.qrNote}>
              <ShieldCheck size={14} />
              <p>
                Compartilhe o QR Code somente com quem administra este WhatsApp.
              </p>
            </div>
            {status?.state === "open" && (
              <button
                className={styles.disconnect}
                onClick={() => void disconnect()}
                disabled={busy}
              >
                <Power size={14} />
                Desconectar canal
              </button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
