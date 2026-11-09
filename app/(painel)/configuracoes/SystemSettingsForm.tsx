"use client";
import { useState } from "react";
import {
  Bell,
  Check,
  Image as ImageIcon,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import {
  executeMediaCleanupAction,
  saveSystemSettingsAction,
} from "@/app/actions";
import styles from "./Settings.module.css";
export function SystemSettingsForm({
  initialSettings,
}: {
  initialSettings: Record<string, string | undefined>;
}) {
  const [favicon, setFavicon] = useState(
    initialSettings.system_favicon_url || "/favicon.svg",
  );
  const [sound, setSound] = useState(
    initialSettings.sound_notifications !== "false",
  );
  const [badge, setBadge] = useState(
    initialSettings.tab_badge_notifications !== "false",
  );
  const [days, setDays] = useState(
    initialSettings.media_retention_days || "30",
  );
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const upload = (file?: File) => {
    if (!file) return;
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
      ].includes(file.type) ||
      file.size > 256 * 1024
    ) {
      setNotice("Use uma imagem PNG, JPEG, WebP ou ICO de até 256 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFavicon(String(reader.result));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveSystemSettingsAction({
        system_favicon_url: favicon,
        sound_notifications: String(sound),
        tab_badge_notifications: String(badge),
        media_retention_days: days,
      });
      setNotice(result.message);
      if (result.ok) {
        localStorage.setItem("track_sound_enabled", String(sound));
      }
    } catch {
      setNotice("Não foi possível salvar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  const clean = async () => {
    if (
      !confirm(
        "Remover arquivos de mídia com mais de " +
          days +
          " dias do histórico? Os textos das conversas serão preservados. Esta remoção não pode ser desfeita sem um backup.",
      )
    )
      return;
    setCleaning(true);
    setNotice(null);
    try {
      const result = await executeMediaCleanupAction(Number(days));
      setNotice(result.message);
    } catch {
      setNotice(
        "A limpeza não foi concluída. Confira o histórico e tente novamente.",
      );
    } finally {
      setCleaning(false);
    }
  };
  return (
    <div className={styles.system}>
      <div className={styles.branding}>
        <span className={styles.favicon}>
          <img src={favicon} alt="Ícone do workspace" />
        </span>
        <div>
          <strong>Ícone do workspace</strong>
          <p>Uma identificação simples para a aba do navegador.</p>
          <label className={styles.upload}>
            <Upload size={13} />
            Escolher imagem
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/x-icon"
              onChange={(event) => upload(event.target.files?.[0])}
              hidden
            />
          </label>
          <button
            type="button"
            className={styles.reset}
            onClick={() => setFavicon("/favicon.svg")}
          >
            Restaurar padrão
          </button>
        </div>
      </div>
      <div className={styles.notificationRow}>
        <span>
          <Volume2 size={17} />
        </span>
        <div>
          <strong>Som de novas mensagens</strong>
          <p>
            Um alerta breve quando uma mensagem nova chegar às conversas
            carregadas.
          </p>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            aria-label="Ativar som de novas mensagens"
            checked={sound}
            onChange={(event) => setSound(event.target.checked)}
          />
          <span />
        </label>
      </div>
      <div className={styles.notificationRow}>
        <span>
          <Bell size={17} />
        </span>
        <div>
          <strong>Contagem na aba do navegador</strong>
          <p>Mostra quantas conversas carregadas aguardam resposta.</p>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            aria-label="Mostrar contagem na aba"
            checked={badge}
            onChange={(event) => setBadge(event.target.checked)}
          />
          <span />
        </label>
      </div>
      <div className={styles.retention}>
        <div>
          <strong>Limpeza de mídias antigas</strong>
          <p>
            Remova arquivos pesados mantendo o texto das conversas. A limpeza é
            iniciada por você.
          </p>
        </div>
        <select
          aria-label="Idade das mídias para limpeza"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        >
          {[7, 15, 30, 60, 90].map((value) => (
            <option key={value} value={value}>
              {value} dias
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void clean()}
          disabled={cleaning || busy}
        >
          {cleaning ? (
            <Loader2 size={13} className={styles.spin} />
          ) : (
            <Trash2 size={13} />
          )}
          Limpar mídias
        </button>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={styles.saveRow}>
        <span>
          <ShieldCheck size={13} />
          Preferências do seu workspace.
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || cleaning}
        >
          {busy ? (
            <Loader2 size={14} className={styles.spin} />
          ) : (
            <Save size={14} />
          )}{" "}
          {busy ? "Salvando…" : "Salvar preferências"}
        </button>
      </div>
    </div>
  );
}
