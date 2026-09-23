"use client";

import { useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { saveThemeAction } from "@/app/actions";
import {
  ACCENT_OPTIONS,
  DENSITY_OPTIONS,
  THEME_OPTIONS,
  TITLE_OPTIONS,
  htmlAttrs,
  type ThemePrefs,
} from "@/lib/theme";

/**
 * Escolha de aparência. Cada clique aplica na hora (só troca atributos no <html>,
 * sem recarregar) e salva o cookie em segundo plano. Sem biblioteca, sem estado
 * global: é o jeito mais leve de trocar de tema.
 */
export function ThemeForm({ initial }: { initial: ThemePrefs }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (next: ThemePrefs) => {
    setPrefs(next);
    const html = document.documentElement;
    for (const [k, v] of Object.entries(htmlAttrs(next))) {
      if (v === undefined) html.removeAttribute(k);
      else html.setAttribute(k, v);
    }
    const fd = new FormData();
    fd.set("theme", next.theme);
    fd.set("accent", next.accent);
    fd.set("density", next.density);
    fd.set("titles", next.titles);
    startTransition(async () => {
      await saveThemeAction(fd);
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 1800);
    });
  };

  return (
    <div className="theme-form">
      <fieldset className="theme-group">
        <legend>Tema</legend>
        <div className="theme-options">
          {THEME_OPTIONS.map((o) => (
            <label key={o.value} className="theme-option" data-selected={prefs.theme === o.value}>
              <input
                type="radio"
                name="theme"
                value={o.value}
                checked={prefs.theme === o.value}
                onChange={() => apply({ ...prefs, theme: o.value })}
              />
              <span className={`theme-preview theme-preview-${o.value}`} aria-hidden="true">
                <span className="theme-preview-bar" />
                <span className="theme-preview-card" />
              </span>
              <span className="theme-option-text">
                <strong>{o.label}</strong>
                <span>{o.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="theme-group">
        <legend>Cor de destaque</legend>
        <div className="swatches">
          {ACCENT_OPTIONS.map((o) => (
            <label key={o.value} className="swatch" data-selected={prefs.accent === o.value} title={o.label}>
              <input
                type="radio"
                name="accent"
                value={o.value}
                checked={prefs.accent === o.value}
                onChange={() => apply({ ...prefs, accent: o.value })}
              />
              <span className="swatch-dot" style={{ background: o.color }}>
                {prefs.accent === o.value ? <Check size={14} strokeWidth={3} /> : null}
              </span>
              <span className="swatch-label">{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="cols">
        <fieldset className="theme-group">
          <legend>Densidade</legend>
          <div className="theme-options theme-options-stack">
            {DENSITY_OPTIONS.map((o) => (
              <label key={o.value} className="theme-option" data-selected={prefs.density === o.value}>
                <input
                  type="radio"
                  name="density"
                  value={o.value}
                  checked={prefs.density === o.value}
                  onChange={() => apply({ ...prefs, density: o.value })}
                />
                <span className="theme-option-text">
                  <strong>{o.label}</strong>
                  <span>{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="theme-group">
          <legend>Títulos</legend>
          <div className="theme-options theme-options-stack">
            {TITLE_OPTIONS.map((o) => (
              <label key={o.value} className="theme-option" data-selected={prefs.titles === o.value}>
                <input
                  type="radio"
                  name="titles"
                  value={o.value}
                  checked={prefs.titles === o.value}
                  onChange={() => apply({ ...prefs, titles: o.value })}
                />
                <span className="theme-option-text">
                  <strong className={o.value === "serifa" ? "font-display text-[1.15rem] font-normal" : "font-ui"}>{o.label}</strong>
                  <span>{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="hint" aria-live="polite">
        {pending ? "Salvando…" : saved ? "Salvo. Vale para este navegador; em outro aparelho, escolha de novo." : "A mudança aparece na hora e fica guardada neste navegador."}
      </p>
    </div>
  );
}
