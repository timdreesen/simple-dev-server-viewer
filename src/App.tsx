import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  ChevronDown,
  CircleStop,
  Database,
  ExternalLink,
  FolderOpen,
  Globe2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { formatBytes, formatUptime } from "./format";

type Category = "web" | "database" | "container" | "runtime" | "unknown";
type SortKey = "name" | "port" | "cpu" | "memory" | "uptime";

interface PortInfo {
  port: number;
  address: string;
  protocol?: string;
  url?: string;
}

interface DockerInfo {
  containerId: string;
  name: string;
  image: string;
}

interface Service {
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
}

interface ScanResult {
  services: Service[];
  scannedAt: number;
  listenerCount: number;
  inaccessibleCount: number;
  dockerAvailable: boolean;
}

interface ActionResult {
  success: boolean;
  message: string;
}

const categories: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "web", label: "Web" },
  { id: "database", label: "Databases" },
  { id: "container", label: "Containers" },
  { id: "runtime", label: "Runtimes" },
  { id: "unknown", label: "Unknown" },
];

const emptyResult: ScanResult = {
  services: [],
  scannedAt: 0,
  listenerCount: 0,
  inaccessibleCount: 0,
  dockerAvailable: false,
};

const categoryIcon = (category: Category) => {
  const icons = {
    web: Globe2,
    database: Database,
    container: Box,
    runtime: TerminalSquare,
    unknown: Server,
  };
  return icons[category];
};

function App() {
  const [scan, setScan] = useState<ScanResult>(emptyResult);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">(
    () => (localStorage.getItem("category") as Category | "all") || "all",
  );
  const [showAll, setShowAll] = useState(() => localStorage.getItem("showAll") === "true");
  const [sortKey, setSortKey] = useState<SortKey>(
    () => (localStorage.getItem("sortKey") as SortKey) || "name",
  );
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [confirming, setConfirming] = useState<Service | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<ScanResult>("scan_services");
      setScan(result);
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (paused) return;
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [paused, refresh]);

  useEffect(() => localStorage.setItem("category", category), [category]);
  useEffect(() => localStorage.setItem("showAll", String(showAll)), [showAll]);
  useEffect(() => localStorage.setItem("sortKey", sortKey), [sortKey]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return scan.services
      .filter((service) => showAll || service.isLikelyDev)
      .filter((service) => category === "all" || service.category === category)
      .filter(
        (service) =>
          !search ||
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
            .includes(search),
      )
      .sort((a, b) => {
        if (sortKey === "port") return a.ports[0].port - b.ports[0].port;
        if (sortKey === "cpu") return b.cpuPercent - a.cpuPercent;
        if (sortKey === "memory") return b.memoryBytes - a.memoryBytes;
        if (sortKey === "uptime") return b.uptimeSeconds - a.uptimeSeconds;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [scan.services, showAll, category, query, sortKey]);

  const metrics = useMemo(
    () => ({
      active: scan.services.filter((service) => service.isLikelyDev).length,
      ports: scan.services.filter((service) => service.isLikelyDev).flatMap((service) => service.ports)
        .length,
      memory: scan.services
        .filter((service) => service.isLikelyDev)
        .reduce((sum, service) => sum + service.memoryBytes, 0),
      containers: scan.services.filter((service) => service.docker).length,
    }),
    [scan.services],
  );

  const runAction = async (command: string, args: Record<string, unknown>) => {
    try {
      const result = await invoke<ActionResult>(command, args);
      setToast(result.message);
      if (result.success) window.setTimeout(refresh, 500);
    } catch (reason) {
      setToast(String(reason));
    }
    window.setTimeout(() => setToast(""), 3500);
  };

  const stopService = async () => {
    if (!confirming) return;
    const service = confirming;
    setConfirming(null);
    await runAction("stop_process_tree", { pid: service.pid });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div>
            <h1>Simple Dev Server Viewer</h1>
            <p>Local runtime control</p>
          </div>
        </div>
        <div className="top-actions">
          <div className={`scan-state ${paused ? "paused" : ""}`}>
            <span /> {paused ? "Scanning paused" : "Live scan · 2s"}
          </div>
          <button className="icon-button" onClick={() => setPaused(!paused)} aria-label={paused ? "Resume scanning" : "Pause scanning"}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button className="icon-button" onClick={refresh} aria-label="Refresh now">
            <RefreshCw size={16} className={loading ? "spinning" : ""} />
          </button>
        </div>
      </header>

      <section className="overview">
        <div className="overview-copy">
          <p className="eyebrow">SYSTEM OVERVIEW</p>
          <h2>Everything listening.<br /><em>Nothing forgotten.</em></h2>
          <p className="subcopy">A focused view of the development processes currently alive on this machine.</p>
        </div>
        <div className="metrics">
          <Metric label="Dev services" value={metrics.active.toString()} accent />
          <Metric label="Open ports" value={metrics.ports.toString()} />
          <Metric label="Memory used" value={formatBytes(metrics.memory)} />
          <Metric label="Containers" value={metrics.containers.toString()} detail={scan.dockerAvailable ? "Docker connected" : "Docker unavailable"} />
        </div>
      </section>

      <section className="workspace">
        <div className="toolbar">
          <label className="search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services, ports, commands…" />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
          </label>
          <div className="select-wrap">
            <SlidersHorizontal size={15} />
            <select value={category} onChange={(event) => setCategory(event.target.value as Category | "all")}>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <ChevronDown size={14} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            <span /> Show all listeners
          </label>
          <span className="result-count">{filtered.length} visible</span>
        </div>

        <div className="table-shell">
          <div className="table-head">
            <SortButton label="Service" active={sortKey === "name"} onClick={() => setSortKey("name")} />
            <SortButton label="Endpoint" active={sortKey === "port"} onClick={() => setSortKey("port")} />
            <SortButton label="CPU" active={sortKey === "cpu"} onClick={() => setSortKey("cpu")} />
            <SortButton label="Memory" active={sortKey === "memory"} onClick={() => setSortKey("memory")} />
            <SortButton label="Uptime" active={sortKey === "uptime"} onClick={() => setSortKey("uptime")} />
            <span>Actions</span>
          </div>

          {error ? (
            <EmptyState title="Scanner unavailable" detail={error} />
          ) : loading && !scan.scannedAt ? (
            <EmptyState title="Inspecting local ports" detail="Correlating listeners with active processes…" loading />
          ) : filtered.length === 0 ? (
            <EmptyState title="No matching services" detail={showAll ? "No listening processes match these filters." : "No likely development servers are currently active."} />
          ) : (
            <div className="service-list">
              {filtered.map((service) => <ServiceRow key={service.id} service={service} onAction={runAction} onStop={setConfirming} />)}
            </div>
          )}
        </div>
        <footer>
          <span>Last scan {scan.scannedAt ? new Date(scan.scannedAt * 1000).toLocaleTimeString() : "—"}</span>
          <span>{scan.listenerCount} TCP listeners · {scan.inaccessibleCount} restricted</span>
        </footer>
      </section>

      {confirming && (
        <div className="modal-backdrop" onMouseDown={() => setConfirming(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stop-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="danger-icon"><CircleStop size={22} /></div>
            <p className="eyebrow">STOP PROCESS TREE</p>
            <h3 id="stop-title">Stop {confirming.displayName}?</h3>
            <p>This sends a graceful termination signal to PID {confirming.pid} and its child processes. Unsaved work may be lost.</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="danger" onClick={stopService}>Stop service</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) {
  return <article className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail || "Currently active"}</small></article>;
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}<ChevronDown size={12} /></button>;
}

function ServiceRow({ service, onAction, onStop }: { service: Service; onAction: (command: string, args: Record<string, unknown>) => void; onStop: (service: Service) => void }) {
  const Icon = categoryIcon(service.category);
  const primaryPort = service.ports[0];
  return (
    <article className="service-row">
      <div className="service-main">
        <div className={`service-icon ${service.category}`}><Icon size={18} /></div>
        <div className="service-title">
          <div><strong>{service.displayName}</strong><span className={`badge ${service.category}`}>{service.framework}</span></div>
          <span className="command" title={service.command || service.name}>{service.workingDirectory || service.command || service.name}</span>
        </div>
      </div>
      <div className="endpoint">
        <strong>{primaryPort.url ? `:${primaryPort.port}` : `TCP ${primaryPort.port}`}</strong>
        <span>{service.ports.length > 1 ? `+${service.ports.length - 1} ports` : primaryPort.address}</span>
      </div>
      <div className="resource"><strong>{service.cpuPercent.toFixed(1)}%</strong><span>PID {service.pid}</span></div>
      <div className="resource"><strong>{formatBytes(service.memoryBytes)}</strong><span>{service.name}</span></div>
      <div className="resource"><strong>{formatUptime(service.uptimeSeconds)}</strong><span>{service.confidence}% match</span></div>
      <div className="row-actions">
        <button disabled={!primaryPort.url} onClick={() => onAction("open_service", { request: { url: primaryPort.url } })} aria-label={`Open ${service.displayName}`} title="Open in browser"><ExternalLink size={15} /></button>
        <button disabled={!service.canReveal} onClick={() => onAction("reveal_process_directory", { pid: service.pid })} aria-label={`Reveal ${service.displayName}`} title="Reveal directory"><FolderOpen size={15} /></button>
        <button className="stop" disabled={!service.canStop} onClick={() => onStop(service)} aria-label={`Stop ${service.displayName}`} title={service.docker ? "Container controls are disabled in version 1" : "Stop process tree"}><CircleStop size={15} /></button>
      </div>
    </article>
  );
}

function EmptyState({ title, detail, loading = false }: { title: string; detail: string; loading?: boolean }) {
  return <div className="empty"><div className={loading ? "empty-pulse" : ""}><Server size={24} /></div><strong>{title}</strong><p>{detail}</p></div>;
}

export default App;
