import { t } from "./i18n";
import { frameworkLabel, groupByProject, serviceName, type Service } from "./services";

/** Mirrors `TrayItem` in src-tauri/src/tray.rs. */
export type TrayItem =
  | { kind: "action"; id: string; label: string }
  | { kind: "label"; label: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; items: TrayItem[] };

export interface TrayMenu {
  title: string | null;
  tooltip: string;
  items: TrayItem[];
}

const MAX_TRAY_SERVICES = 15;
const separator: TrayItem = { kind: "separator" };

function serviceLabel(service: Service): string {
  const name = serviceName(service);
  return ["Other", "Docker"].includes(service.framework) ? name : `${name} · ${frameworkLabel(service.framework)}`;
}

function serviceItem(service: Service): TrayItem {
  const items: TrayItem[] = service.ports.flatMap((port): TrayItem[] =>
    port.url ? [{ kind: "action", id: `open:${port.url}`, label: t("openPort", { port: port.port }) }] : [],
  );
  if (service.canStop) {
    if (items.length > 0) items.push(separator);
    items.push({ kind: "action", id: `stop:${service.id}`, label: t("stop") });
  }
  if (items.length === 0) {
    items.push(...service.ports.map((port): TrayItem => ({ kind: "label", label: `:${port.port}` })));
  }
  return { kind: "submenu", label: serviceLabel(service), items };
}

/** The tray menu for the main list: projects and services with open and stop actions. */
export function trayMenu(services: Service[], groupProjects: boolean): TrayMenu {
  const count = services.length;
  const { projects, rest } = groupProjects ? groupByProject(services) : { projects: [], rest: services };
  const items: TrayItem[] = [
    { kind: "action", id: "show", label: t("trayShow") },
    separator,
    { kind: "label", label: count > 0 ? t("trayRunning", { count }) : t("nothingRunning") },
  ];
  for (const project of projects) {
    const stoppable = project.services.filter((service) => service.canStop).length;
    items.push({
      kind: "submenu",
      label: `${project.name} (${project.services.length})`,
      items: [
        ...project.services.map(serviceItem),
        ...(stoppable > 0
          ? [
              separator,
              {
                kind: "action",
                id: `stop-project:${project.name}`,
                label: t("stopAll", { count: stoppable }),
              } as const,
            ]
          : []),
      ],
    });
  }
  items.push(...rest.slice(0, MAX_TRAY_SERVICES).map(serviceItem));
  if (rest.length > MAX_TRAY_SERVICES) {
    items.push({ kind: "label", label: t("trayMore", { count: rest.length - MAX_TRAY_SERVICES }) });
  }
  items.push(separator, { kind: "action", id: "quit", label: t("trayQuit") });
  return { title: count > 0 ? String(count) : null, tooltip: t("trayTooltip", { count }), items };
}
