export type Category = "web" | "database" | "container" | "runtime" | "emulator" | "unknown";

export interface PortInfo {
  port: number;
  address: string;
  url?: string;
}

export interface DockerInfo {
  containerId: string;
  name: string;
  image: string;
}

export interface Service {
  id: string;
  pid?: number;
  name: string;
  displayName: string;
  command: string;
  workingDirectory?: string;
  category: Category;
  framework: string;
  isLikelyDev: boolean;
  cpuPercent: number;
  memoryBytes: number;
  uptimeSeconds: number;
  ports: PortInfo[];
  docker?: DockerInfo;
  canStop: boolean;
  canReveal: boolean;
  hideKey: string;
}

export interface ScanResult {
  services: Service[];
  scannedAt: number;
  dockerAvailable: boolean;
}

export interface Sections {
  /** Likely development services: the main list. */
  servers: Service[];
  /** Everything else that listens on a port. */
  others: Service[];
  /** Services the user chose to hide. */
  hidden: Service[];
}

export const HIDDEN_STORAGE_KEY = "hiddenKeys";
/** Storage key used before hiding was renamed from "false positives". */
export const LEGACY_HIDDEN_STORAGE_KEY = "falsePositiveKeys";

export function parseHiddenKeys(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function serializeHiddenKeys(keys: Set<string>): string {
  return JSON.stringify([...keys].sort());
}

export function matchesQuery(service: Service, query: string): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return [
    service.displayName,
    service.name,
    service.framework,
    service.command,
    service.workingDirectory,
    service.docker?.image,
    service.pid,
    ...service.ports.map((port) => port.port),
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

export function sectionServices(services: Service[], hiddenKeys: Set<string>, query: string): Sections {
  const sections: Sections = { servers: [], others: [], hidden: [] };
  for (const service of services) {
    if (!matchesQuery(service, query)) continue;
    if (hiddenKeys.has(service.hideKey)) sections.hidden.push(service);
    else if (service.isLikelyDev) sections.servers.push(service);
    else sections.others.push(service);
  }
  return sections;
}

export interface Group {
  title: string;
  services: Service[];
}

const groupTitles = ["Servers", "Databases", "Emulators"] as const;

function groupTitle(service: Service): (typeof groupTitles)[number] {
  if (service.category === "database") return "Databases";
  if (service.category === "emulator") return "Emulators";
  return "Servers";
}

/** Splits the main list by kind, keeping the scan order inside each group. */
export function groupServices(services: Service[]): Group[] {
  return groupTitles
    .map((title) => ({ title, services: services.filter((service) => groupTitle(service) === title) }))
    .filter((group) => group.services.length > 0);
}

/** What the port chip shows and what gets copied for non-browsable ports. */
export function portAddress(port: PortInfo): string {
  return `${port.address}:${port.port}`;
}

export function serviceDetail(service: Service): string {
  if (service.docker) return service.framework === "Docker" ? service.docker.image : `${service.framework} · Docker`;
  if (service.pid === undefined) return "Owned by another user";
  return service.framework === "Other" ? service.name : service.framework;
}
