import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "./i18n";
import type { Service } from "./services";
import { trayMenu, type TrayItem } from "./tray";

const service = (overrides: Partial<Service>): Service => ({
  id: "pid:1",
  pid: 1,
  name: "node",
  displayName: "web",
  command: "vite",
  category: "web",
  framework: "Vite",
  isLikelyDev: true,
  cpuPercent: 0,
  memoryBytes: 0,
  uptimeSeconds: 0,
  ports: [{ port: 5173, address: "localhost", url: "http://localhost:5173" }],
  canStop: true,
  canReveal: true,
  hideKey: "process:node",
  ...overrides,
});

const labels = (items: TrayItem[]): unknown[] =>
  items.map((item) =>
    item.kind === "submenu" ? [item.label, labels(item.items)] : item.kind === "separator" ? "---" : item.label,
  );

beforeEach(() => setLocale("en"));

describe("trayMenu", () => {
  it("lists projects and services with open and stop actions", () => {
    const menu = trayMenu(
      [
        service({}),
        service({
          id: "docker:a",
          displayName: "db",
          framework: "PostgreSQL",
          category: "database",
          project: "shop",
          ports: [{ port: 5432, address: "localhost" }],
        }),
        service({ id: "docker:b", displayName: "api", framework: "Docker", project: "shop" }),
      ],
      true,
    );
    expect(menu.title).toBe("3");
    expect(labels(menu.items)).toEqual([
      "Open Devtop",
      "---",
      "3 running",
      ["shop (2)", [["api", ["Open :5173", "---", "Stop"]], ["db · PostgreSQL", ["Stop"]], "---", "Stop 2"]],
      ["web · Vite", ["Open :5173", "---", "Stop"]],
      "---",
      "Quit Devtop",
    ]);
  });

  it("has no title when nothing runs", () => {
    const menu = trayMenu([], true);
    expect(menu.title).toBeNull();
    expect(labels(menu.items)).toContain("Nothing running");
  });
});
