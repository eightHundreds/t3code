import { useEffect } from "react";

import { resolveAppLocale, translate, type TranslateValues } from "@t3tools/shared/i18n";
import { useClientSettings } from "./hooks/useSettings";

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return [navigator.language];
}

export function useAppLocale() {
  const setting = useClientSettings((settings) => settings.uiLocale);
  return resolveAppLocale(setting, systemLanguages());
}

export function useTranslate() {
  const locale = useAppLocale();
  return (source: string, values?: TranslateValues) => translate(locale, source, values);
}

export function LocaleDocument() {
  const locale = useAppLocale();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- screen readers read the document language from <html lang>
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
