import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  ChevronDown,
  CircleStop,
  Database,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Globe2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  siAngular,
  siAstro,
  siBun,
  siDeno,
  siDocker,
  siDotnet,
  siElasticsearch,
  siMariadb,
  siMongodb,
  siMysql,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siPhp,
  siPostgresql,
  siPython,
  siRedis,
  siRemix,
  siRubyonrails,
  siSupabase,
  siSvelte,
  siVite,
  siWebpack,
  type SimpleIcon,
} from "simple-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { formatBytes, formatUptime } from "./format";
import {
  groupServices,
  parseFalsePositiveKeys,
  serializeFalsePositiveKeys,
  type Category,
  type Service,
  type SortKey,
} from "./services";

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

const frameworkIcons: Record<string, SimpleIcon> = {
  ".NET": siDotnet,
  Angular: siAngular,
  Astro: siAstro,
  Bun: siBun,
  Deno: siDeno,
  Docker: siDocker,
  Elasticsearch: siElasticsearch,
  MariaDB: siMariadb,
  MongoDB: siMongodb,
  MySQL: siMysql,
  "Next.js": siNextdotjs,
  "Node.js": siNodedotjs,
  Nuxt: siNuxt,
  PHP: siPhp,
  PostgreSQL: siPostgresql,
  Python: siPython,
  Rails: siRubyonrails,
  Redis: siRedis,
  Remix: siRemix,
  Supabase: siSupabase,
  SvelteKit: siSvelte,
  Vite: siVite,
  webpack: siWebpack,
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
  const [falsePositiveKeys, setFalsePositiveKeys] = useState(
    () => parseFalsePositiveKeys(localStorage.getItem("falsePositiveKeys")),
  );
  const [falsePositivesExpanded, setFalsePositivesExpanded] = useState(false);

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
  useEffect(
    () => localStorage.setItem("falsePositiveKeys", serializeFalsePositiveKeys(falsePositiveKeys)),
    [falsePositiveKeys],
  );

  const groups = useMemo(
    () => groupServices(scan.services, falsePositiveKeys, showAll, category, query, sortKey),
    [scan.services, falsePositiveKeys, showAll, category, query, sortKey],
  );

  const metrics = useMemo(() => {
    const included = scan.services.filter((service) => !falsePositiveKeys.has(service.falsePositiveKey));
    const likelyDev = included.filter((service) => service.isLikelyDev);
    return {
      active: likelyDev.length,
      ports: likelyDev.flatMap((service) => service.ports).length,
      memory: likelyDev.reduce((sum, service) => sum + service.memoryBytes, 0),
      containers: included.filter((service) => service.docker).length,
    };
  }, [scan.services, falsePositiveKeys]);

  const setFalsePositive = (service: Service, marked: boolean) => {
    setFalsePositiveKeys((current) => {
      const next = new Set(current);
      if (marked) next.add(service.falsePositiveKey);
      else next.delete(service.falsePositiveKey);
      return next;
    });
    if (marked) setFalsePositivesExpanded(true);
  };

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
      <section className="overview">
        <header className="overview-header">
          <div className="brand">
            <div className="brand-mark"><span /></div>
            <div>
              <h1>Simple Dev Server Viewer</h1>
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
        <div className="metrics">
          <Metric label="Dev services" value={metrics.active.toString()} />
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
          <span className="result-count">{groups.main.length} visible</span>
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
          ) : (
            <div>
              {groups.main.length === 0 ? (
                <EmptyState title="No matching services" detail={showAll ? "No unmarked listening processes match these filters." : "No unmarked likely development servers are currently active."} compact={groups.falsePositives.length > 0} />
              ) : (
                <div className="service-list">
                  {groups.main.map((service) => <ServiceRow key={service.id} service={service} onAction={runAction} onStop={setConfirming} onFalsePositive={setFalsePositive} />)}
                </div>
              )}
              {groups.falsePositives.length > 0 && (
                <section className="false-positive-section">
                  <button
                    className="false-positive-toggle"
                    onClick={() => setFalsePositivesExpanded((expanded) => !expanded)}
                    aria-expanded={falsePositivesExpanded}
                  >
                    <span><EyeOff size={14} /> False positives</span>
                    <span>{groups.falsePositives.length} marked <ChevronDown size={14} /></span>
                  </button>
                  {falsePositivesExpanded && (
                    <div className="service-list false-positive-list">
                      {groups.falsePositives.map((service) => <ServiceRow key={service.id} service={service} onAction={runAction} onStop={setConfirming} onFalsePositive={setFalsePositive} marked />)}
                    </div>
                  )}
                </section>
              )}
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

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{detail || "Currently active"}</small></article>;
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}<ChevronDown size={12} /></button>;
}

function ServiceRow({ service, onAction, onStop, onFalsePositive, marked = false }: { service: Service; onAction: (command: string, args: Record<string, unknown>) => void; onStop: (service: Service) => void; onFalsePositive: (service: Service, marked: boolean) => void; marked?: boolean }) {
  const Icon = categoryIcon(service.category);
  const frameworkIcon = service.docker ? siDocker : frameworkIcons[service.framework];
  const primaryPort = service.ports[0];
  return (
    <article className="service-row">
      <div className="service-main">
        <div className={`service-icon ${service.category}`}>
          {frameworkIcon ? <BrandIcon icon={frameworkIcon} /> : <Icon size={18} />}
        </div>
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
        <button className="false-positive-action" onClick={() => onFalsePositive(service, !marked)} aria-label={`${marked ? "Restore" : "Mark"} ${service.displayName}`} title={marked ? "Restore to main results" : "Mark as false positive"}>{marked ? <RotateCcw size={15} /> : <EyeOff size={15} />}</button>
        <button className="stop" disabled={!service.canStop} onClick={() => onStop(service)} aria-label={`Stop ${service.displayName}`} title={service.docker ? "Container controls are disabled in version 1" : "Stop process tree"}><CircleStop size={15} /></button>
      </div>
    </article>
  );
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="brand-icon" style={{ color: `#${icon.hex}` }}>
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function EmptyState({ title, detail, loading = false, compact = false }: { title: string; detail: string; loading?: boolean; compact?: boolean }) {
  return <div className={`empty ${compact ? "compact" : ""}`}><div className={loading ? "empty-pulse" : ""}><Server size={24} /></div><strong>{title}</strong><p>{detail}</p></div>;
}

export default App;
