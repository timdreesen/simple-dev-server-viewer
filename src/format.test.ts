import { describe, expect, it } from "vitest";
import { formatBytes, formatUptime } from "./format";

describe("formatBytes", () => {
  it("formats zero and process-sized values", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(1024 ** 2 * 12.5)).toBe("12.5 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2.0 GB");
  });
});

describe("formatUptime", () => {
  it("uses compact useful units", () => {
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(125)).toBe("2m");
    expect(formatUptime(7380)).toBe("2h 3m");
    expect(formatUptime(93600)).toBe("1d 2h");
  });
});
