import { Children, useSyncExternalStore, type ReactNode } from "react";

import {
  resolveAppLocale,
  translate,
  type AppLocale,
  type TranslateValues,
  type UiLocaleSetting,
} from "@t3tools/shared/i18n";

let uiLocaleSetting: UiLocaleSetting = "zh-CN";
const uiLocaleListeners = new Set<() => void>();

export function setUiLocaleSetting(next: UiLocaleSetting): void {
  if (uiLocaleSetting === next) return;
  uiLocaleSetting = next;
  for (const listener of uiLocaleListeners) listener();
}

function subscribeUiLocale(onStoreChange: () => void): () => void {
  uiLocaleListeners.add(onStoreChange);
  return () => {
    uiLocaleListeners.delete(onStoreChange);
  };
}

function readAppLocale(): AppLocale {
  const languages =
    typeof navigator === "undefined"
      ? []
      : navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
  return resolveAppLocale(uiLocaleSetting, languages);
}

export function translateUi(source: string, values?: TranslateValues): string {
  return translate(readAppLocale(), source, values);
}

export function useUiTranslate(): (source: string, values?: TranslateValues) => string {
  const setting = useSyncExternalStore(
    subscribeUiLocale,
    () => uiLocaleSetting,
    () => uiLocaleSetting,
  );
  return (source, values) =>
    translate(resolveAppLocale(setting, systemLanguages()), source, values);
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return [navigator.language];
}

export function useLocalizedText(children: ReactNode): ReactNode {
  const t = useUiTranslate();
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const trimmed = child.trim();
    if (trimmed.length === 0) return child;
    const translated = t(trimmed);
    return translated === trimmed ? child : child.replace(trimmed, translated);
  });
}
