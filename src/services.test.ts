import { describe, expect, it } from "vitest";
import {
  groupServices,
  parseFalsePositiveKeys,
  serializeFalsePositiveKeys,
  type Service,
} from "./services";

const service = (overrides: Partial<Service>): Service => ({
  id: "1:3000",
  pid: 1,
  name: "node",
  displayName: "App",
  command: "node app.js",
  category: "web",
  framework: "Node.js",
  confidence: 78,
  isLikelyDev: true,
  cpuPercent: 1,
  memoryBytes: 100,
  uptimeSeconds: 10,
  ports: [{ port: 3000, address: "localhost" }],
  canStop: true,
  canReveal: true,
  falsePositiveKey: "process:node",
  ...overrides,
});

describe("false-positive key persistence", () => {
  it("serializes, restores, and tolerates invalid storage", () => {
    const serialized = serializeFalsePositiveKeys(new Set(["process:svchost", "process:discord"]));
    expect([...parseFalsePositiveKeys(serialized)]).toEqual(["process:discord", "process:svchost"]);
    expect(parseFalsePositiveKeys("invalid")).toEqual(new Set());
  });
});

describe("groupServices", () => {
  const services = [
    service({ displayName: "Dev App", falsePositiveKey: "process:node" }),
    service({
      id: "2:8080",
      pid: 2,
      name: "discord",
      displayName: "Discord",
      command: "discord",
      category: "unknown",
      framework: "Unknown listener",
      isLikelyDev: false,
      ports: [{ port: 8080, address: "localhost" }],
      falsePositiveKey: "process:discord",
    }),
  ];
  const marked = new Set(["process:discord"]);

  it("keeps marked services separate even when show-all is off", () => {
    const unmarkedUnknown = service({
      id: "3:9000",
      displayName: "Other Listener",
      isLikelyDev: false,
      ports: [{ port: 9000, address: "localhost" }],
      falsePositiveKey: "process:other",
    });
    const groups = groupServices([...services, unmarkedUnknown], marked, false, "all", "", "name");
    expect(groups.main.map((item) => item.displayName)).toEqual(["Dev App"]);
    expect(groups.falsePositives.map((item) => item.displayName)).toEqual(["Discord"]);
    expect(groupServices([...services, unmarkedUnknown], marked, true, "all", "", "name").main).toHaveLength(2);
  });

  it("applies search and category filters to both groups", () => {
    expect(groupServices(services, marked, true, "unknown", "discord", "name").falsePositives).toHaveLength(1);
    expect(groupServices(services, marked, true, "web", "discord", "name").falsePositives).toHaveLength(0);
  });

  it("sorts both groups with the selected sort", () => {
    const groups = groupServices(
      [...services, service({ id: "3:4000", displayName: "Other App", ports: [{ port: 4000, address: "localhost" }] })],
      marked,
      true,
      "all",
      "",
      "port",
    );
    expect(groups.main.map((item) => item.ports[0].port)).toEqual([3000, 4000]);
  });
});
