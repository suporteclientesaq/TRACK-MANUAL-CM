import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Cabin, Inter, Instrument_Serif, Manrope } from "next/font/google";
import { THEME_COOKIE, htmlAttrs, parsePrefs } from "@/lib/theme";
import "./globals.css";

// Fontes do design: Manrope (interface e navegação), Cabin (botões e etiquetas),
// Instrument Serif (títulos) e Inter (texto corrido). Baixadas no build, servidas pelo site.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cabin = Cabin({ subsets: ["latin"], variable: "--font-cabin", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Track Manual",
  description: "Envio manual de conversões de anúncios Click-to-WhatsApp para o Meta",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2b2344" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Aparência escolhida em Configurações: aplicada no servidor, sem piscar.
  const prefs = parsePrefs((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${cabin.variable} ${instrumentSerif.variable} ${inter.variable}`}
      {...htmlAttrs(prefs)}
    >
      <body>{children}</body>
    </html>
  );
}
