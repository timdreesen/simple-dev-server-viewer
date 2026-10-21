import { t, type MessageKey } from "./i18n";

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

/** Title and icon read from a web service's page; both empty when it isn't HTML. */
export interface PageInfo {
  title?: string;
  favicon?: string;
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
    serviceName(service),
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

const groupKeys = ["servers", "databases", "emulators"] as const;

function groupKey(service: Service): (typeof groupKeys)[number] {
  if (service.category === "database") return "databases";
  if (service.category === "emulator") return "emulators";
  return "servers";
}

/** Splits the main list by kind, keeping the scan order inside each group. */
export function groupServices(services: Service[]): Group[] {
  return groupKeys
    .map((key) => ({ title: t(key), services: services.filter((service) => groupKey(service) === key) }))
    .filter((group) => group.services.length > 0);
}

/** The page a web service serves, used for its title, favicon, and thumbnail. */
export function previewUrl(service: Service): string | undefined {
  return service.ports.find((port) => port.url)?.url;
}

/** What the port chip shows and what gets copied for non-browsable ports. */
export function portAddress(port: PortInfo): string {
  return `${port.address}:${port.port}`;
}

/** Generic labels the scanner uses when it can't tell what a service is. */
const genericLabels: Record<string, MessageKey> = { "Local server": "localServer", Database: "database" };

export function frameworkLabel(framework: string): string {
  const key = genericLabels[framework];
  return key ? t(key) : framework;
}

/** The display name in the user's language; services the scanner can't inspect are named after their port. */
export function serviceName(service: Service): string {
  if (service.id.startsWith("port:") && service.ports.length > 0) return t("port", { port: service.ports[0].port });
  return frameworkLabel(service.displayName);
}

export function serviceDetail(service: Service): string {
  const framework = frameworkLabel(service.framework);
  if (service.docker) return service.framework === "Docker" ? service.docker.image : `${framework} · Docker`;
  if (service.pid === undefined) return t("ownedByAnotherUser");
  return service.framework === "Other" ? service.name : framework;
}
