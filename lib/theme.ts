/**
 * Preferências de aparência do painel. Ficam num cookie (um ano), lidas no
 * servidor: a página já chega com o tema certo, sem piscar e sem JavaScript.
 */

export const THEME_COOKIE = "tm_tema";

export const THEME_OPTIONS = [
  { value: "system", label: "Automático", desc: "Segue o tema do celular ou do computador." },
  { value: "light", label: "Claro", desc: "Fundo branco, para ambientes claros." },
  { value: "dark", label: "Escuro", desc: "Fundo escuro com um toque da cor de destaque." },
  { value: "black", label: "Preto", desc: "Preto total, ideal em telas OLED." },
] as const;

export const ACCENT_OPTIONS = [
  { value: "roxo", label: "Roxo", color: "#7b39fc" },
  { value: "vermelho", label: "Vermelho", color: "#e5383b" },
  { value: "azul", label: "Azul", color: "#2f6bff" },
  { value: "verde", label: "Verde", color: "#1fb26b" },
  { value: "laranja", label: "Laranja", color: "#f0742e" },
  { value: "rosa", label: "Rosa", color: "#ec4899" },
  { value: "preto", label: "Preto e branco", color: "linear-gradient(135deg, #17141f 50%, #f4f2f8 50%)" },
] as const;

export const DENSITY_OPTIONS = [
  { value: "confortavel", label: "Confortável", desc: "Mais espaço entre as linhas e os cartões." },
  { value: "compacta", label: "Compacta", desc: "Mais informação na tela, letras um pouco menores." },
] as const;

export const TITLE_OPTIONS = [
  { value: "serifa", label: "Com serifa", desc: "Títulos em Instrument Serif, como na página de entrada." },
  { value: "sans", label: "Sem serifa", desc: "Títulos em Manrope, mais neutros." },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];
export type AccentValue = (typeof ACCENT_OPTIONS)[number]["value"];
export type DensityValue = (typeof DENSITY_OPTIONS)[number]["value"];
export type TitleValue = (typeof TITLE_OPTIONS)[number]["value"];

export interface ThemePrefs {
  theme: ThemeValue;
  accent: AccentValue;
  density: DensityValue;
  titles: TitleValue;
}

export const DEFAULT_PREFS: ThemePrefs = { theme: "system", accent: "roxo", density: "confortavel", titles: "serifa" };

function pick<T extends readonly { value: string }[]>(options: T, v: unknown, fallback: T[number]["value"]): T[number]["value"] {
  return options.some((o) => o.value === v) ? (v as T[number]["value"]) : fallback;
}

/** Lê "tema:cor:densidade:titulos"; qualquer parte inválida cai no padrão. */
export function parsePrefs(raw: string | undefined | null): ThemePrefs {
  const [t, a, d, f] = String(raw || "").split(":");
  return {
    theme: pick(THEME_OPTIONS, t, DEFAULT_PREFS.theme),
    accent: pick(ACCENT_OPTIONS, a, DEFAULT_PREFS.accent),
    density: pick(DENSITY_OPTIONS, d, DEFAULT_PREFS.density),
    titles: pick(TITLE_OPTIONS, f, DEFAULT_PREFS.titles),
  };
}

export function serializePrefs(p: ThemePrefs): string {
  return `${p.theme}:${p.accent}:${p.density}:${p.titles}`;
}

/** Atributos que vão no <html>; ausentes quando é o padrão, para o CSS ficar enxuto. */
export function htmlAttrs(p: ThemePrefs): Record<string, string | undefined> {
  return {
    "data-theme": p.theme === "system" ? undefined : p.theme,
    "data-accent": p.accent === "roxo" ? undefined : p.accent,
    "data-density": p.density === "compacta" ? "compacta" : undefined,
    "data-titles": p.titles === "sans" ? "sans" : undefined,
  };
}

export function prefsFromForm(fd: FormData): ThemePrefs {
  return parsePrefs(`${fd.get("theme")}:${fd.get("accent")}:${fd.get("density")}:${fd.get("titles")}`);
}
