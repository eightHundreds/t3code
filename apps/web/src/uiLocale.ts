import {
  resolveAppLocale,
  translate,
  type AppLocale,
  type UiLocaleSetting,
} from "@t3tools/shared/i18n";

let uiLocaleSetting: UiLocaleSetting = "zh-CN";

export function setUiLocaleSetting(next: UiLocaleSetting): void {
  uiLocaleSetting = next;
}

export function readAppLocale(): AppLocale {
  const languages =
    typeof navigator === "undefined" ? [] : navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return resolveAppLocale(uiLocaleSetting, languages);
}

export function translateUi(source: string): string {
  return translate(readAppLocale(), source);
}
