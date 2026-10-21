import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "./i18n";
import {
  groupServices,
  parseHiddenKeys,
  portAddress,
  sectionServices,
  serializeHiddenKeys,
  serviceDetail,
  serviceName,
  type Service,
} from "./services";

const service = (overrides: Partial<Service>): Service => ({
  id: "pid:1",
  pid: 1,
  name: "node",
  displayName: "App",
  command: "node app.js",
  category: "web",
  framework: "Node.js",
  isLikelyDev: true,
  cpuPercent: 1,
  memoryBytes: 100,
  uptimeSeconds: 10,
  ports: [{ port: 3000, address: "localhost", url: "http://localhost:3000" }],
  canStop: true,
  canReveal: true,
  hideKey: "process:node",
  ...overrides,
});

beforeEach(() => setLocale("en"));

describe("hidden key persistence", () => {
  it("serializes, restores, and tolerates invalid storage", () => {
    const serialized = serializeHiddenKeys(new Set(["process:svchost", "process:discord"]));
    expect([...parseHiddenKeys(serialized)]).toEqual(["process:discord", "process:svchost"]);
    expect(parseHiddenKeys("invalid")).toEqual(new Set());
    expect(parseHiddenKeys('[1, "process:x"]')).toEqual(new Set(["process:x"]));
    expect(parseHiddenKeys(null)).toEqual(new Set());
  });
});

describe("sectionServices", () => {
  const app = service({ displayName: "Dev App" });
  const discord = service({
    id: "pid:2",
    name: "Discord",
    displayName: "Discord",
    command: "discord",
    category: "unknown",
    framework: "Other",
    isLikelyDev: false,
    ports: [{ port: 6463, address: "localhost" }],
    hideKey: "process:discord",
  });
  const other = service({
    id: "pid:3",
    displayName: "Other Listener",
    isLikelyDev: false,
    ports: [{ port: 9000, address: "localhost" }],
    hideKey: "process:other",
  });

  it("splits dev servers, other listeners, and hidden services", () => {
    const sections = sectionServices([app, discord, other], new Set(["process:discord"]), "");
    expect(sections.servers.map((item) => item.displayName)).toEqual(["Dev App"]);
    expect(sections.others.map((item) => item.displayName)).toEqual(["Other Listener"]);
    expect(sections.hidden.map((item) => item.displayName)).toEqual(["Discord"]);
  });

  it("filters every section by name, port, or command", () => {
    expect(sectionServices([app, discord, other], new Set(["process:discord"]), "discord").hidden).toHaveLength(1);
    expect(sectionServices([app, discord, other], new Set(), "3000").servers).toEqual([app]);
    expect(sectionServices([app, discord, other], new Set(), "app.js").servers).toEqual([app]);
    expect(sectionServices([app, discord, other], new Set(), "nothing").servers).toHaveLength(0);
  });
});

describe("display helpers", () => {
  it("formats port addresses for copying", () => {
    expect(portAddress({ port: 5432, address: "localhost" })).toBe("localhost:5432");
  });

  it("describes Docker, restricted, and regular services", () => {
    const docker = { containerId: "abc", name: "db", image: "postgres:16" };
    expect(serviceDetail(service({ framework: "PostgreSQL", docker }))).toBe("PostgreSQL · Docker");
    expect(serviceDetail(service({ framework: "Docker", docker }))).toBe("postgres:16");
    expect(serviceDetail(service({ pid: undefined }))).toBe("Owned by another user");
    expect(serviceDetail(service({ framework: "Other", name: "steam" }))).toBe("steam");
    expect(serviceDetail(service({}))).toBe("Node.js");
  });
});

describe("groupServices", () => {
  it("groups servers, databases, and emulators in a fixed order", () => {
    const groups = groupServices([
      service({ id: "e", category: "emulator", displayName: "Pixel 8" }),
      service({ id: "d", category: "database", displayName: "db" }),
      service({ id: "w", displayName: "web" }),
      service({ id: "c", category: "container", displayName: "api" }),
    ]);
    expect(groups.map((group) => [group.title, group.services.map((item) => item.displayName)])).toEqual([
      ["Servers", ["web", "api"]],
      ["Databases", ["db"]],
      ["Emulators", ["Pixel 8"]],
    ]);
  });
});

describe("serviceName", () => {
  it("translates names the scanner made up", () => {
    const restricted = service({
      id: "port:5432",
      pid: undefined,
      displayName: "Port 5432",
      framework: "Database",
      ports: [{ port: 5432, address: "localhost" }],
    });
    setLocale("pt-BR");
    expect(serviceName(restricted)).toBe("Porta 5432");
    expect(serviceName(service({ displayName: "Local server" }))).toBe("Servidor local");
    expect(serviceDetail(service({ framework: "Database" }))).toBe("Banco de dados");
    expect(serviceName(service({ displayName: "my-app" }))).toBe("my-app");
  });
});
