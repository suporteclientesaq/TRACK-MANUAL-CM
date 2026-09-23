"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Leads", match: (p: string) => p === "/" || p.startsWith("/leads") },
  { href: "/eventos", label: "Eventos", match: (p: string) => p.startsWith("/eventos") },
  { href: "/clientes", label: "Clientes", match: (p: string) => p.startsWith("/clientes") },
  { href: "/configuracoes", label: "Configurações", match: (p: string) => p.startsWith("/configuracoes") },
];

/** Navegação do painel com a página atual marcada. */
export function PanelNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="nav" aria-label="Painel">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} data-active={l.match(pathname) ? "true" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
