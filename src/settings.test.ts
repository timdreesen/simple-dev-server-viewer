import { describe, expect, it } from "vitest";
import { DEFAULT_SCAN_INTERVAL_MS, parseCloseAction, parseScanInterval } from "./settings";

describe("parseScanInterval", () => {
  it("accepts the offered intervals and falls back to the default", () => {
    expect(parseScanInterval("5000")).toBe(5000);
    expect(parseScanInterval("1234")).toBe(DEFAULT_SCAN_INTERVAL_MS);
    expect(parseScanInterval(null)).toBe(DEFAULT_SCAN_INTERVAL_MS);
  });
});

describe("parseCloseAction", () => {
  it("keeps the app in the tray unless told to quit", () => {
    expect(parseCloseAction("quit")).toBe("quit");
    expect(parseCloseAction("tray")).toBe("tray");
    expect(parseCloseAction(null)).toBe("tray");
  });
});
