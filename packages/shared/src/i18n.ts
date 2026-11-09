import { zhCNExtraMessages } from "./i18nMessagesExtra.ts";
import { zhCNMessages as zhCNCoreMessages } from "./i18nMessages.ts";

const zhCNMessages: Readonly<Record<string, string>> = {
  ...zhCNCoreMessages,
  ...zhCNExtraMessages,
};

export const UI_LOCALE_SETTINGS = ["system", "en", "zh-CN"] as const;
export type UiLocaleSetting = (typeof UI_LOCALE_SETTINGS)[number];
export type AppLocale = Exclude<UiLocaleSetting, "system">;

export interface TranslateValues {
  readonly [key: string]: string | number;
}

export function resolveAppLocale(
  setting: UiLocaleSetting,
  languages: readonly string[],
): AppLocale {
  if (setting === "en" || setting === "zh-CN") return setting;
  for (const language of languages) {
    if (language.toLowerCase().startsWith("zh")) return "zh-CN";
  }
  return "en";
}

export function translate(
  locale: AppLocale,
  source: string,
  values?: TranslateValues,
): string {
  const template = locale === "zh-CN" ? (zhCNMessages[source] ?? source) : source;
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : String(value);
  });
}
