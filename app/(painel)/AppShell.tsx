"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  Settings2,
  ShieldCheck,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Logo } from "@/app/Logo";
import { WhatsAppHeaderBadge } from "@/components/WhatsAppHeaderBadge";
import styles from "./AppShell.module.css";

const navigation = [
  {
    href: "/dashboard",
    title: "Visão geral",
    icon: LayoutDashboard,
    group: "WORKSPACE",
  },
  { href: "/conversas", title: "Conversas", icon: MessageCircle },
  { href: "/", title: "Contatos", icon: UsersRound },
  { href: "/funil", title: "Funil de vendas", icon: GitBranch },
  { href: "/eventos", title: "Eventos Meta", icon: Activity },
  {
    href: "/whatsapp",
    title: "Canais WhatsApp",
    icon: Zap,
    group: "GERENCIAR",
  },
  { href: "/clientes", title: "Clientes", icon: Building2 },
  { href: "/configuracoes", title: "Configurações", icon: Settings2 },
];
const matches = (path: string, href: string) =>
  href === "/"
    ? path === "/" || path.startsWith("/leads")
    : path.startsWith(href);

export function AppShell({
  children,
  clients,
  dateLabel,
}: {
  children: ReactNode;
  clients: { id: string; name: string }[];
  dateLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active =
    navigation.find((item) => matches(pathname, item.href)) || navigation[0];
  const clientId = params.get("cliente") || "";

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, params]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
      if (event.key === "Tab" && menuOpen) {
        const nodes = sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled])",
        );
        const first = nodes?.[0];
        const last = nodes?.[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [menuOpen]);
  useEffect(() => {
    if (menuOpen)
      sidebarRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [menuOpen]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (helpOpen && !dialog?.open) dialog?.showModal();
    if (!helpOpen && dialog?.open) dialog.close();
  }, [helpOpen]);

  return (
    <div className={styles.app}>
      <a href="#workspace-content" className={styles.skipLink}>
        Ir para o conteúdo
      </a>
      {menuOpen && (
        <button
          className={styles.overlay}
          aria-label="Fechar navegação"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={styles.sidebar}
        data-open={menuOpen}
        aria-label="Navegação principal"
      >
        <Link
          className={styles.brand}
          href="/dashboard"
          aria-label="Track Manual — início"
        >
          <span className={styles.brandIcon}>
            <Logo size={25} />
          </span>
          <span>
            track<span className={styles.brandWord}>manual</span>
          </span>
          <span className={styles.brandTag}>CRM</span>
        </Link>
        <button
          className={styles.mobileClose}
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        >
          <X size={20} />
        </button>
        <div className={styles.workspaceBadge}>
          <span className={styles.workspaceIcon}>TM</span>
          <div>
            <strong>Meu workspace</strong>
            <span>
              {clients.length}{" "}
              {clients.length === 1
                ? "cliente cadastrado"
                : "clientes cadastrados"}
            </span>
          </div>
          <ShieldCheck size={16} />
        </div>
        <nav className={styles.navigation}>
          {navigation.map(({ href, title, icon: Icon, group }) => (
            <div key={href}>
              {group && <p className={styles.navGroup}>{group}</p>}
              <Link
                href={
                  clientId &&
                  ["/dashboard", "/conversas", "/", "/funil"].includes(href)
                    ? href + "?cliente=" + encodeURIComponent(clientId)
                    : href
                }
                className={
                  styles.navLink +
                  (matches(pathname, href) ? " " + styles.navActive : "")
                }
                aria-current={matches(pathname, href) ? "page" : undefined}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{title}</span>
                {matches(pathname, href) && (
                  <span className={styles.activeIndicator} />
                )}
              </Link>
            </div>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.helpCard}>
            <span className={styles.helpIcon}>
              <MessageCircle size={18} />
            </span>
            <strong>Seu atendimento, conectado.</strong>
            <p>Organize conversas e acompanhe cada oportunidade.</p>
            <button onClick={() => setHelpOpen(true)}>
              Guia de primeiros passos
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className={styles.sidebarUser}>
            <span className={styles.userAvatar}>AD</span>
            <div>
              <strong>Administrador</strong>
              <span>Acesso ao workspace</span>
            </div>
            <form action={logoutAction}>
              <button aria-label="Sair da conta" title="Sair da conta">
                <LogOut size={17} />
              </button>
            </form>
          </div>
          <span className={styles.version}>
            TRACK MANUAL <span>v3.0 · Flow</span>
          </span>
        </div>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              ref={menuRef}
              className={styles.mobileMenu}
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir navegação"
              aria-expanded={menuOpen}
            >
              <Menu size={21} />
            </button>
            <span className={styles.breadcrumb}>
              Workspace
              <ChevronRight size={13} />
              <strong>{active.title}</strong>
            </span>
          </div>
          <form className={styles.search} action="/" method="get">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="Buscar contatos no workspace"
              name="q"
              placeholder="Buscar contatos…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {clientId && (
              <input type="hidden" name="cliente" value={clientId} />
            )}
            <kbd>⌘ K</kbd>
          </form>
          <div className={styles.topbarRight}>
            <span className={styles.date}>{dateLabel}</span>
            <span className={styles.topbarDivider} />
            <WhatsAppHeaderBadge />
            <button
              className={styles.helpButton}
              aria-label="Abrir guia de ajuda"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={19} />
            </button>
            <Link
              href="/configuracoes"
              className={styles.topAvatar}
              title="Minha conta e preferências"
            >
              AD
            </Link>
          </div>
        </header>
        <div className={styles.contextBar}>
          <span>
            <span className={styles.contextMark} />
            Visão organizada. Atendimento mais próximo.
          </span>
          <label className={styles.contextWorkspace}>
            <Building2 size={13} />
            <select
              aria-label="Selecionar cliente no workspace"
              value={clientId}
              onChange={(event) => {
                const next = new URLSearchParams(params.toString());
                next.delete("lead");
                if (event.target.value) next.set("cliente", event.target.value);
                else next.delete("cliente");
                const target = [
                  "/dashboard",
                  "/conversas",
                  "/",
                  "/funil",
                ].includes(pathname)
                  ? pathname
                  : "/dashboard";
                router.push(target + (next.size ? "?" + next : ""));
              }}
            >
              <option value="">Todos os clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
        </div>
        <main id="workspace-content" className={styles.content} tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.footer}>
          <span>
            Track Manual <span>·</span> Seu relacionamento em movimento.
          </span>
          <Link href="/configuracoes">
            <ShieldCheck size={12} />
            Workspace protegido
          </Link>
        </footer>
      </div>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="help-title"
        onCancel={() => setHelpOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setHelpOpen(false);
        }}
      >
        <div className={styles.dialogHeading}>
          <span className={styles.eyebrow}>SEU WORKSPACE</span>
          <button aria-label="Fechar guia" onClick={() => setHelpOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <h2 id="help-title">Tudo pronto para começar?</h2>
        <p>
          Conecte os canais, organize os contatos e confira cada conversão antes
          de enviar.
        </p>
        <div className={styles.helpSteps}>
          {[
            {
              href: "/clientes",
              title: "Cadastre sua empresa",
              text: "Configure pixel, moeda e credenciais de cada cliente.",
            },
            {
              href: "/whatsapp",
              title: "Conecte o WhatsApp",
              text: "Escolha seu provedor e acompanhe o status da conexão.",
            },
            {
              href: "/conversas",
              title: "Comece uma conversa",
              text: "Atenda, registre notas e acompanhe oportunidades.",
            },
            {
              href: "/eventos",
              title: "Confira seus eventos",
              text: "Veja o retorno da Meta e mantenha as tentativas no histórico.",
            },
          ].map((step, index) => (
            <Link
              href={step.href}
              key={step.href}
              onClick={() => setHelpOpen(false)}
            >
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </div>
        <div className={styles.helpNote}>
          <Check size={15} />
          Eventos de teste não compõem a receita em produção.
        </div>
      </dialog>
    </div>
  );
}
