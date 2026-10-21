import { afterEach, describe, expect, it } from "vitest";
import { detectLocale, parseLanguagePreference, setLocale, t } from "./i18n";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

afterEach(() => setLocale("en"));

describe("detectLocale", () => {
  it("matches exact locales, then the same language, then falls back to English", () => {
    expect(detectLocale(["pt-BR", "en-US"])).toBe("pt-BR");
    expect(detectLocale(["pt-PT"])).toBe("pt-BR");
    expect(detectLocale(["pt"])).toBe("pt-BR");
    expect(detectLocale(["de-DE", "en-GB"])).toBe("en");
    expect(detectLocale(["fr"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("parseLanguagePreference", () => {
  it("accepts supported locales and falls back to following the system", () => {
    expect(parseLanguagePreference("pt-BR")).toBe("pt-BR");
    expect(parseLanguagePreference("en")).toBe("en");
    expect(parseLanguagePreference("auto")).toBe("auto");
    expect(parseLanguagePreference("de")).toBe("auto");
    expect(parseLanguagePreference(null)).toBe("auto");
  });
});

describe("t", () => {
  it("translates and fills in placeholders", () => {
    expect(t("port", { port: 5432 })).toBe("Port 5432");
    setLocale("pt-BR");
    expect(t("port", { port: 5432 })).toBe("Porta 5432");
  });

  it("leaves unknown placeholders in place", () => {
    expect(t("nothingRunningDetail")).toContain("{command}");
  });

  it("keeps the same placeholders in every translation", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ptBR[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
