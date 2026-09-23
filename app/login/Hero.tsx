"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/app/Logo";
import { LiquidButton } from "@/components/ui/liquid-glass-button";

/**
 * Seção de abertura do painel: vídeo de fundo em tela cheia, barra de navegação
 * transparente e chamada centralizada. Layout, cores e fontes seguem o design
 * combinado (Manrope na navegação, Cabin nos botões, Instrument Serif no título,
 * Inter no texto). Os textos ficam nas constantes abaixo.
 */

/** Vídeo de fundo: cópia leve (470 KB) em public/, com o original do design como reserva. */
export const VIDEO_URL = "/fundo.mp4";
export const VIDEO_POSTER = "/fundo.jpg";
export const VIDEO_FALLBACK_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260210_031346_d87182fb-b0af-4273-84d1-c6fd17d6bf0f.mp4";

const NAV_LINKS: { label: string; href: string; menu?: boolean }[] = [
  { label: "Início", href: "#topo" },
  { label: "Recursos", href: "#recursos", menu: true },
  { label: "Como Funciona", href: "#como-funciona" },
  { label: "Suporte", href: "#suporte" },
];

const COPY = {
  badge: "Novo",
  tagline: "Track Manual 3.0 está no ar",
  headlineBefore: "Cada venda do WhatsApp contada",
  headlineItalic: "e",
  headlineAfter: "atribuída ao anúncio certo",
  subtext:
    "Os leads chegam da Leona com o clique do anúncio. Você confere, coloca o valor e envia para a API de Conversões do Meta com um clique. Tudo fica registrado, com a resposta do Meta.",
  ctaPrimary: "Entrar no Painel",
  ctaSecondary: "Ver Como Funciona",
};

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const SIGN_IN =
  "inline-flex h-10 items-center justify-center rounded-[8px] border border-[#d4d4d4] bg-white px-4 font-ui text-[14px] font-semibold text-[#171717] transition hover:bg-[#f3f3f3]";
const GET_STARTED =
  "inline-flex h-10 items-center justify-center rounded-[8px] bg-brand px-4 font-ui text-[14px] font-semibold text-[#fafafa] shadow-[0_6px_18px_rgba(123,57,252,0.35)] transition hover:bg-[#8a4fff]";

export function Navbar({ setup }: { setup: boolean }) {
  const [open, setOpen] = useState(false);

  // Trava a rolagem enquanto o menu de celular está aberto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const primaryLabel = setup ? "Criar Senha" : "Começar";

  return (
    <header className="relative z-20 w-full bg-transparent">
      <div className="flex items-center justify-between px-6 py-[16px] lg:px-[120px]">
        <a href="#topo" className="flex items-center gap-2 text-white no-underline hover:no-underline" aria-label="Track Manual">
          <Logo size={28} />
          <span className="font-ui text-[16px] font-bold tracking-[0.2px]">Track Manual</span>
        </a>

        <nav className="ml-10 hidden flex-1 items-center gap-7 lg:flex" aria-label="Principal">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-1 font-ui text-[14px] font-medium text-white no-underline transition hover:opacity-80 hover:no-underline"
            >
              {l.label}
              {l.menu ? <ChevronDown /> : null}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a href="#entrar" className={`${SIGN_IN} no-underline hover:no-underline`}>
            Entrar
          </a>
          <a href="#entrar" className={`${GET_STARTED} no-underline hover:no-underline`}>
            {primaryLabel}
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-white lg:hidden"
          aria-label="Abrir menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-30 flex flex-col bg-black text-white lg:hidden">
          <div className="flex items-center justify-between px-6 py-[16px]">
            <a href="#topo" className="flex items-center gap-2 text-white no-underline" onClick={() => setOpen(false)}>
              <Logo size={28} />
              <span className="font-ui text-[16px] font-bold">Track Manual</span>
            </a>
            <button
              type="button"
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-white"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-6 pt-6" aria-label="Menu">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between border-b border-white/10 py-4 font-ui text-[20px] font-medium text-white no-underline"
              >
                {l.label}
                {l.menu ? <ChevronDown className="opacity-70" /> : null}
              </a>
            ))}
            <div className="mt-8 flex flex-col gap-3">
              <a href="#entrar" onClick={() => setOpen(false)} className={`${SIGN_IN} h-12 no-underline`}>
                Entrar
              </a>
              <a href="#entrar" onClick={() => setOpen(false)} className={`${GET_STARTED} h-12 no-underline`}>
                {primaryLabel}
              </a>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function Hero({ setup }: { setup: boolean }) {
  return (
    <section id="topo" className="relative min-h-screen w-full overflow-hidden bg-brand-dark">
      <video
        className="absolute inset-0 z-0 h-full w-full object-cover"
        poster={VIDEO_POSTER}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src={VIDEO_URL} type="video/mp4" />
        <source src={VIDEO_FALLBACK_URL} type="video/mp4" />
      </video>

      <Navbar setup={setup} />

      <div className="relative z-10 mt-32 flex flex-col items-center px-6 pb-24 text-center">
        <div
          className="inline-flex h-[38px] items-center gap-2 rounded-[10px] border px-2 pr-3 backdrop-blur-md"
          style={{ background: "rgba(85, 80, 110, 0.4)", borderColor: "rgba(164, 132, 215, 0.5)" }}
        >
          <span className="inline-flex h-[24px] items-center rounded-[6px] bg-brand px-2 font-btn text-[13px] font-medium text-white">
            {COPY.badge}
          </span>
          <span className="font-btn text-[14px] font-medium text-white">{COPY.tagline}</span>
        </div>

        <h1 className="mt-6 max-w-[1100px] font-display text-5xl font-normal leading-[1.1] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)] md:text-[96px]">
          {COPY.headlineBefore} <em className="mx-[0.06em] italic">{COPY.headlineItalic}</em> {COPY.headlineAfter}
        </h1>

        <p className="mt-6 max-w-[662px] font-body text-[18px] font-normal leading-[1.55] text-white/70 [text-shadow:0_1px_14px_rgba(0,0,0,0.6)]">{COPY.subtext}</p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="#entrar"
            className="inline-flex h-12 items-center justify-center rounded-[10px] bg-brand px-6 font-btn text-[16px] font-medium text-white no-underline transition hover:bg-[#8a4fff] hover:no-underline"
          >
            {setup ? "Criar Minha Senha" : COPY.ctaPrimary}
          </a>
          <LiquidButton
            asChild
            size="xl"
            className="rounded-[10px] px-6 font-btn text-[16px] font-medium text-[#f6f7f9] no-underline hover:no-underline"
          >
            <a href="#como-funciona">{COPY.ctaSecondary}</a>
          </LiquidButton>
        </div>
      </div>
    </section>
  );
}
