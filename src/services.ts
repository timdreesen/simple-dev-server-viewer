export type Category = "web" | "database" | "container" | "runtime" | "unknown";
export type SortKey = "name" | "port" | "cpu" | "memory" | "uptime";

export interface PortInfo {
  port: number;
  address: string;
  protocol?: string;
  url?: string;
}

export interface DockerInfo {
  containerId: string;
  name: string;
  image: string;
}

export interface Service {
  id: string;
  pid: number;
  name: string;
  displayName: string;
  command: string;
  workingDirectory?: string;
  parentPid?: number;
  category: Category;
  framework: string;
  confidence: number;
  isLikelyDev: boolean;
  cpuPercent: number;
  memoryBytes: number;
  uptimeSeconds: number;
  ports: PortInfo[];
  docker?: DockerInfo;
  canStop: boolean;
  canReveal: boolean;
  falsePositiveKey: string;
}

export interface ServiceGroups {
  main: Service[];
  falsePositives: Service[];
}

export function parseFalsePositiveKeys(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function serializeFalsePositiveKeys(keys: Set<string>): string {
  return JSON.stringify([...keys].sort());
}

export function groupServices(
  services: Service[],
  falsePositiveKeys: Set<string>,
  showAll: boolean,
  category: Category | "all",
  query: string,
  sortKey: SortKey,
): ServiceGroups {
  const search = query.trim().toLowerCase();
  const matchesFilters = (service: Service) =>
    (category === "all" || service.category === category) &&
    (!search ||
      [
        service.displayName,
        service.framework,
        service.command,
        service.workingDirectory,
        service.pid,
        ...service.ports.map((port) => port.port),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search));
  const sortServices = (items: Service[]) =>
    items.sort((a, b) => {
      if (sortKey === "port") return a.ports[0].port - b.ports[0].port;
      if (sortKey === "cpu") return b.cpuPercent - a.cpuPercent;
      if (sortKey === "memory") return b.memoryBytes - a.memoryBytes;
      if (sortKey === "uptime") return b.uptimeSeconds - a.uptimeSeconds;
      return a.displayName.localeCompare(b.displayName);
    });

  const matching = services.filter(matchesFilters);
  return {
    main: sortServices(
      matching.filter(
        (service) => !falsePositiveKeys.has(service.falsePositiveKey) && (showAll || service.isLikelyDev),
      ),
    ),
    falsePositives: sortServices(
      matching.filter((service) => falsePositiveKeys.has(service.falsePositiveKey)),
    ),
  };
}
