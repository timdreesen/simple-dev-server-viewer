import { invoke } from "@tauri-apps/api/core";
import { Box, Database, Eye, EyeOff, FolderOpen, Globe, Search, Server, Smartphone, Square, TerminalSquare, X } from "lucide-react";
import type { SimpleIcon } from "simple-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./App.css";
import { formatBytes, formatUptime } from "./format";
import { t, type MessageKey } from "./i18n";
import { frameworkIcon } from "./icons";
import {
  groupServices,
  HIDDEN_STORAGE_KEY,
  LEGACY_HIDDEN_STORAGE_KEY,
  parseHiddenKeys,
  portAddress,
  sectionServices,
  serializeHiddenKeys,
  serviceDetail,
  serviceName,
  type Category,
  type PortInfo,
  type ScanResult,
  type Service,
} from "./services";

interface ActionResult {
  success: boolean;
  message: string;
  /** Known outcome, shown in the user's language; without it the raw (system) message is shown. */
  code?: Exclude<MessageKey, "processStopped">;
  count?: number;
}

function actionMessage({ message, code, count = 0 }: ActionResult): string {
  if (code === "processesStopped") return t(count === 1 ? "processStopped" : "processesStopped", { count });
  return code ? t(code) : message;
}

interface Actions {
  open: (url: string) => void;
  copy: (text: string) => void;
  reveal: (service: Service) => void;
  stop: (service: Service) => void;
  toggleHidden: (service: Service) => void;
}

const SCAN_INTERVAL_MS = 2000;
const MAX_VISIBLE_PORTS = 3;

const categoryIcons: Record<Category, typeof Server> = {
  web: Globe,
  database: Database,
  container: Box,
  runtime: TerminalSquare,
  emulator: Smartphone,
  unknown: Server,
};

function App() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [hiddenKeys, setHiddenKeys] = useState(() =>
    parseHiddenKeys(localStorage.getItem(HIDDEN_STORAGE_KEY) ?? localStorage.getItem(LEGACY_HIDDEN_STORAGE_KEY)),
  );
  const [showOthers, setShowOthers] = useState(() => localStorage.getItem("showOthers") === "true");
  const [showHidden, setShowHidden] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scanning = useRef(false);
  const toastTimer = useRef<number>(undefined);

  const refresh = useCallback(async () => {
    if (scanning.current) return;
    scanning.current = true;
    try {
      setScan(await invoke<ScanResult>("scan_services"));
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      scanning.current = false;
    }
  }, []);

  // Scan continuously, but only while the window is visible.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, SCAN_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement === searchRef.current;
      if ((event.key === "f" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        if (query) setQuery("");
        else searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  useEffect(() => {
    localStorage.setItem(HIDDEN_STORAGE_KEY, serializeHiddenKeys(hiddenKeys));
    localStorage.removeItem(LEGACY_HIDDEN_STORAGE_KEY);
  }, [hiddenKeys]);
  useEffect(() => localStorage.setItem("showOthers", String(showOthers)), [showOthers]);

  // Forget "stopping" markers once the service is gone from the scan.
  useEffect(() => {
    if (!scan) return;
    setStoppingIds((current) => {
      const alive = new Set(scan.services.map((service) => service.id));
      const next = new Set([...current].filter((id) => alive.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [scan]);

  const sections = useMemo(
    () => sectionServices(scan?.services ?? [], hiddenKeys, query),
    [scan, hiddenKeys, query],
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3000);
  }, []);

  const actions: Actions = useMemo(() => {
    const run = async (command: string, args: Record<string, unknown>, announce = false) => {
      try {
        const result = await invoke<ActionResult>(command, args);
        if (!result.success || announce) notify(actionMessage(result));
        return result.success;
      } catch (reason) {
        notify(String(reason));
        return false;
      }
    };
    return {
      open: (url) => void run("open_service", { url }),
      copy: (text) =>
        navigator.clipboard.writeText(text).then(
          () => notify(t("copied", { text })),
          () => notify(t("copyFailed")),
        ),
      reveal: (service) => service.pid !== undefined && void run("reveal_process_directory", { pid: service.pid }),
      stop: async (service) => {
        setStoppingIds((current) => new Set(current).add(service.id));
        const stopped = service.docker
          ? await run("stop_container", { containerId: service.docker.containerId }, true)
          : await run("stop_process_tree", { pid: service.pid }, true);
        if (!stopped) {
          setStoppingIds((current) => {
            const next = new Set(current);
            next.delete(service.id);
            return next;
          });
        }
        window.setTimeout(refresh, 600);
      },
      toggleHidden: (service) => {
        setHiddenKeys((current) => {
          const next = new Set(current);
          if (next.has(service.hideKey)) next.delete(service.hideKey);
          else {
            next.add(service.hideKey);
            notify(t("hid", { name: serviceName(service) }));
          }
          return next;
        });
      },
    };
  }, [notify, refresh]);

  const renderList = (services: Service[], hidden = false) => (
    <ul className="service-list">
      {services.map((service) => (
        <ServiceRow
          key={service.id}
          service={service}
          hidden={hidden}
          stopping={stoppingIds.has(service.id)}
          expanded={expandedId === service.id}
          onToggle={() => setExpandedId((current) => (current === service.id ? null : service.id))}
          actions={actions}
        />
      ))}
    </ul>
  );

  const renderGroups = (services: Service[]) => {
    const groups = groupServices(services);
    if (groups.length === 1) return renderList(services);
    return groups.map((group, index) => (
      <Section key={group.title} title={group.title} first={index === 0}>
        {renderList(group.services)}
      </Section>
    ));
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          {t("running")} {scan && <span className="count">{sections.servers.length}</span>}
        </h1>
        <label className="search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("filter")}
            aria-label={t("filterLabel")}
            spellCheck={false}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label={t("clearFilter")}>
              <X size={13} />
            </button>
          )}
        </label>
      </header>

      <main className="content">
        {error && !scan ? (
          <EmptyState title={t("cantReadPorts")} detail={error} />
        ) : !scan ? (
          <EmptyState title={t("lookingForServers")} />
        ) : (
          <>
            {sections.servers.length > 0 ? (
              renderGroups(sections.servers)
            ) : query ? (
              <EmptyState title={t("noMatches")} detail={t("noMatchesDetail", { query })} />
            ) : (
              <EmptyState title={t("nothingRunning")} detail={<NothingRunningDetail />} />
            )}
            {showOthers && sections.others.length > 0 && (
              <Section title={t("otherProcesses")}>{renderList(sections.others)}</Section>
            )}
            {showHidden && sections.hidden.length > 0 && (
              <Section title={t("hidden")}>{renderList(sections.hidden, true)}</Section>
            )}
          </>
        )}
      </main>

      <footer className="statusbar">
        <span className={`live ${error ? "offline" : ""}`} title={error || t("liveTitle")}>
          <i aria-hidden /> {error ? t("scanFailed") : t("live")}
        </span>
        <label className="checkbox">
          <input type="checkbox" checked={showOthers} onChange={(event) => setShowOthers(event.target.checked)} />
          {t("showOtherProcesses")}{scan ? ` (${sections.others.length})` : ""}
        </label>
        {sections.hidden.length > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
            {t("showHidden")} ({sections.hidden.length})
          </label>
        )}
        {scan && !scan.dockerAvailable && (
          <span className="muted push" title={t("dockerNotDetectedTitle")}>
            {t("dockerNotDetected")}
          </span>
        )}
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, first = false }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <section className={`section ${first ? "first" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ServiceRow({
  service,
  hidden,
  stopping,
  expanded,
  onToggle,
  actions,
}: {
  service: Service;
  hidden: boolean;
  stopping: boolean;
  expanded: boolean;
  onToggle: () => void;
  actions: Actions;
}) {
  const meta = [
    serviceDetail(service),
    service.uptimeSeconds > 0 && formatUptime(service.uptimeSeconds),
    service.memoryBytes > 0 && formatBytes(service.memoryBytes),
  ].filter(Boolean);
  const extraPorts = service.ports.length - MAX_VISIBLE_PORTS;

  return (
    <li className={`service ${expanded ? "expanded" : ""} ${stopping ? "stopping" : ""}`}>
      <div
        className="service-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <ServiceIcon service={service} />
        <div className="service-title">
          <span className="service-name">{serviceName(service)}</span>
          <span className="service-meta">{stopping ? t("stopping") : meta.join(" · ")}</span>
        </div>
        <div className="ports">
          {service.ports.slice(0, MAX_VISIBLE_PORTS).map((port) => (
            <PortChip key={port.port} port={port} actions={actions} />
          ))}
          {extraPorts > 0 && <span className="more-ports">+{extraPorts}</span>}
        </div>
        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
          {service.canReveal && (
            <IconButton label={t("openFolder")} onClick={() => actions.reveal(service)}>
              <FolderOpen size={15} />
            </IconButton>
          )}
          <IconButton label={hidden ? t("unhide") : t("hide")} onClick={() => actions.toggleHidden(service)}>
            {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </IconButton>
          {service.canStop && <StopButton disabled={stopping} onConfirm={() => actions.stop(service)} />}
        </div>
      </div>
      {expanded && <ServiceDetails service={service} actions={actions} />}
    </li>
  );
}

function PortChip({ port, actions }: { port: PortInfo; actions: Actions }) {
  const address = portAddress(port);
  return (
    <button
      className={`port ${port.url ? "link" : ""}`}
      title={port.url ? t("openUrl", { url: port.url }) : t("copyAddress", { address })}
      onClick={(event) => {
        event.stopPropagation();
        if (port.url) actions.open(port.url);
        else actions.copy(address);
      }}
    >
      :{port.port}
    </button>
  );
}

function StopButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (armed) {
    return (
      <button
        className="confirm-stop"
        autoFocus
        onBlur={() => setArmed(false)}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {t("stop")}
      </button>
    );
  }
  return (
    <IconButton label={t("stop")} danger disabled={disabled} onClick={() => setArmed(true)}>
      <Square size={11} fill="currentColor" />
    </IconButton>
  );
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${danger ? "danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ServiceDetails({ service, actions }: { service: Service; actions: Actions }) {
  const rows: [string, ReactNode][] = [];
  if (service.docker) {
    rows.push([t("container"), service.docker.name], [t("image"), service.docker.image]);
  }
  if (service.command) rows.push([t("command"), <code key="command">{service.command}</code>]);
  if (service.workingDirectory) rows.push([t("folder"), <code key="folder">{service.workingDirectory}</code>]);
  rows.push([
    t("ports"),
    <span key="ports" className="detail-ports">
      {service.ports.map((port) => (
        <button key={port.port} className="text-button" onClick={() => actions.copy(port.url ?? portAddress(port))}>
          {port.url ?? portAddress(port)}
        </button>
      ))}
    </span>,
  ]);
  if (service.pid !== undefined) {
    rows.push(
      [t("process"), t("processWithPid", { name: service.name, pid: service.pid })],
      [t("resources"), `${service.cpuPercent.toFixed(1)}% CPU · ${formatBytes(service.memoryBytes)}`],
    );
  } else if (!service.docker) {
    rows.push([t("process"), t("restrictedProcess")]);
  }

  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ServiceIcon({ service }: { service: Service }) {
  const brand = frameworkIcon(service.framework);
  const Fallback = categoryIcons[service.category] ?? Server;
  return <div className="service-icon">{brand ? <BrandIcon icon={brand} /> : <Fallback size={16} />}</div>;
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-label={icon.title} role="img">
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function NothingRunningDetail() {
  const [before, after] = t("nothingRunningDetail").split("{command}");
  return (
    <>
      {before}
      <code>npm run dev</code>
      {after}
    </>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export default App;
