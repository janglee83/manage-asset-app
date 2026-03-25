"use client";

/**
 * lib/i18n.ts
 *
 * Client-side i18n system.
 * - Stores locale preference in localStorage + <html lang> attribute.
 * - Provides useT() hook to consume translations in any client component.
 * - LanguageProvider wraps _everything_ in app/layout.tsx.
 *
 * Usage in a client component:
 *   const { t, locale, setLocale } = useI18n();
 *   t.hero.headline1
 */

import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { en } from "@/messages/en";
import { vi } from "@/messages/vi";
import type { Messages } from "@/messages/en";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Locale = "en" | "vi";

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
];

const MESSAGES: Record<Locale, Messages> = { en, vi };
const STORAGE_KEY = "av_locale";

// ── Context ───────────────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: en,
  setLocale: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Restore saved locale on mount (client only).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    const preferred = saved ?? getBrowserLocale();
    if (preferred && preferred !== "en") setLocaleState(preferred);
  }, []);

  // Keep <html lang> in sync for screen readers + SEO crawlers.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: Locale) {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  const value: I18nContextValue = {
    locale,
    t: MESSAGES[locale],
    setLocale,
  };

  return createElement(I18nContext.Provider, { value }, children);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect browser preferred language and map to a supported locale. */
function getBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language?.toLowerCase() ?? "";
  if (lang.startsWith("vi")) return "vi";
  return "en";
}

/**
 * Template string interpolation helper.
 * Usage: interpolate(t.hero.badge, { version: '0.1.0' })
 * → "v0.1.0 — Now with GPU-accelerated embeddings"
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return Object.entries(vars).reduce<string>(
    (acc, [key, val]) => acc.replaceAll(`{${key}}`, String(val)),
    template,
  );
}
