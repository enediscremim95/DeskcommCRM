"use client";

import Link from "next/link";
import { ArrowRight, Check, Palette } from "@/lib/ui/icons";
import { useTheme, type Appearance } from "@/lib/theme";
import { useT } from "@/hooks/i18n/useT";
import styles from "./appearance-settings.module.css";

const OPTIONS = [
  { id: "veritas", label: "Veritas", description: "Verde lima e floresta" },
  { id: "asaas", label: "Azul Asaas", description: "Branco e azul, inspirado no Asaas" },
  { id: "chatgpt-light", label: "ChatGPT claro", description: "Branco e cinzas suaves" },
  { id: "chatgpt-dark", label: "ChatGPT escuro", description: "Grafite e cinzas profundos" },
] as const satisfies readonly { id: Appearance; label: string; description: string }[];

/** Preferência pessoal: só o navegador muda, sem alterar a marca da empresa. */
export function AppearanceSettings() {
  const { appearance, setAppearance } = useTheme();
  const t = useT();
  const selected = OPTIONS.find((option) => option.id === appearance) ?? OPTIONS[0];
  return (
    <section className={styles.page} aria-labelledby="appearance-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <Palette size={16} aria-hidden />
          {t("Personalize seu espaço")}
        </p>
        <h1 id="appearance-title">{t("Aparência")}</h1>
        <p>{t("Escolha o visual que combina com o seu jeito de trabalhar.")}</p>
      </header>
      <fieldset className={styles.fieldset}>
        <legend>{t("Tema")}</legend>
        <div className={styles.options}>
          {OPTIONS.map((option) => (
            <label
              key={option.id}
              className={styles.option}
              data-selected={appearance === option.id}
            >
              <input
                className={styles.radio}
                type="radio"
                name="appearance"
                value={option.id}
                checked={appearance === option.id}
                onChange={() => setAppearance(option.id)}
                aria-label={t(option.label)}
                aria-describedby={`appearance-${option.id}-description`}
              />
              <span className={styles.preview} data-preview={option.id} aria-hidden="true">
                <span className={styles.miniSidebar}>
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.miniMain}>
                  <span className={styles.miniHeading} />
                  <span className={styles.miniSubtitle} />
                  <span className={styles.miniSheet}>
                    <span className={styles.miniAccent} />
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
              </span>
              <span className={styles.optionLabel}>
                <span className={styles.indicator} aria-hidden="true">
                  <Check size={12} weight="bold" />
                </span>
                {t(option.label)}
              </span>
              <span id={`appearance-${option.id}-description`} className={styles.description}>
                {t(option.description)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.selection}>
        <div>
          <p className={styles.selectionTitle} role="status" aria-live="polite">
            {t(selected.label)} <span>{t("selecionado")}</span>
          </p>
          <p>{t("Sua escolha fica salva neste navegador e acompanha você em todas as telas.")}</p>
        </div>
        <Link href="/app/inbox" className={styles.openInbox}>
          {t("Ver nas conversas")}
          <ArrowRight size={17} aria-hidden />
        </Link>
      </div>
      <div className={styles.note}>
        <Palette size={20} aria-hidden />
        <p>
          {t(
            "A aparência é só sua. O nome, o logotipo e as configurações da empresa continuam os mesmos.",
          )}
        </p>
      </div>
    </section>
  );
}
