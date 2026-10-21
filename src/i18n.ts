import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export type MessageKey = keyof typeof en;

const locales = { en, "pt-BR": ptBR } satisfies Record<string, Record<MessageKey, string>>;

export type Locale = keyof typeof locales;

/** Picks the first supported locale from the user's preferences, matching "pt-PT" to "pt-BR" and so on. */
export function detectLocale(languages: readonly string[]): Locale {
  const supported = Object.keys(locales) as Locale[];
  for (const language of languages) {
    const exact = supported.find((locale) => locale.toLowerCase() === language.toLowerCase());
    if (exact) return exact;
    const base = language.split("-")[0].toLowerCase();
    const sameLanguage = supported.find((locale) => locale.split("-")[0].toLowerCase() === base);
    if (sameLanguage) return sameLanguage;
  }
  return "en";
}

/** The user's choice in the settings: a locale, or "auto" to follow the system. */
export type LanguagePreference = Locale | "auto";

export const LANGUAGE_STORAGE_KEY = "language";
export const supportedLocales = Object.keys(locales) as Locale[];

/** Each language's name in its own language, so it is recognizable whatever the current locale. */
export const localeNames: Record<Locale, string> = { en: "English", "pt-BR": "Português (Brasil)" };

export function parseLanguagePreference(value: string | null): LanguagePreference {
  return supportedLocales.find((locale) => locale === value) ?? "auto";
}

export function resolveLocale(preference: LanguagePreference): Locale {
  return preference === "auto" ? detectLocale(globalThis.navigator?.languages ?? []) : preference;
}

function storedPreference(): LanguagePreference {
  try {
    return parseLanguagePreference(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null);
  } catch {
    return "auto";
  }
}

let current: Locale = resolveLocale(storedPreference());

export const getLocale = () => current;

export function setLocale(locale: Locale) {
  current = locale;
}

/** Looks up a string in the current locale and fills in `{name}` placeholders; unknown ones are left as is. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return locales[current][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
