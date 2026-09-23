"use client";

import { MetalButton } from "@/components/ui/metal-button";

/** Botão metálico que leva até o cartão de login (um clique, rolagem suave). */
export function EntrarButton({ label }: { label: string }) {
  return (
    <MetalButton
      variant="primary"
      className="h-12 px-8 font-btn text-[15px]"
      onClick={() => document.getElementById("entrar")?.scrollIntoView({ behavior: "smooth", block: "center" })}
    >
      {label}
    </MetalButton>
  );
}
