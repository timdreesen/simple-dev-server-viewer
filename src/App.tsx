import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Box,
  ChevronRight,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  FolderTree,
  LayoutGrid,
  List,
  Search,
  Server,
  Smartphone,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import type { SimpleIcon } from "simple-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./App.css";
import { formatBytes, formatUptime } from "./format";
import {
  getLocale,
  LANGUAGE_STORAGE_KEY,
  parseLanguagePreference,
  resolveLocale,
  setLocale,
  t,
  type LanguagePreference,
  type MessageKey,
} from "./i18n";
import { frameworkIcon } from "./icons";
import { trayMenu } from "./tray";
import {
  groupByProject,
  groupServices,
  HIDDEN_STORAGE_KEY,
  LEGACY_HIDDEN_STORAGE_KEY,
  parseHiddenKeys,
  portAddress,
  previewUrl,
  sectionServices,
  serializeHiddenKeys,
  serviceDetail,
  serviceName,
  typeOptions,
  type Category,
  type PageInfo,
  type PortInfo,
  type ProjectGroup,
  type ScanResult,
  type Service,
  type TypeOption,
} from "./services";
import { HIDDEN_SCAN_INTERVAL_MS, parseCloseAction, parseScanInterval } from "./settings";
import { formatSeconds, SettingsMenu, type SettingsValues } from "./SettingsMenu";
import { TypeFilter } from "./TypeFilter";

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
  stopProject: (project: ProjectGroup) => void;
  toggleHidden: (service: Service) => void;
}

type ViewMode = "list" | "cards";

const MAX_VISIBLE_PORTS = 3;

/** Pages are read once per process and URL, so a restarted server is read again. */
const pageKey = (service: Service, url: string) => `${service.id} ${url}`;

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
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [hiddenKeys, setHiddenKeys] = useState(() =>
    parseHiddenKeys(localStorage.getItem(HIDDEN_STORAGE_KEY) ?? localStorage.getItem(LEGACY_HIDDEN_STORAGE_KEY)),
  );
  const [showOthers, setShowOthers] = useState(() => localStorage.getItem("showOthers") === "true");
  const [showHidden, setShowHidden] = useState(false);
  const [showPreviews, setShowPreviews] = useState(() => localStorage.getItem("showPreviews") !== "false");
  const [groupProjects, setGroupProjects] = useState(() => localStorage.getItem("groupProjects") !== "false");
  // Stored like hidden keys: a sorted JSON array of names.
  const [collapsedProjects, setCollapsedProjects] = useState(() =>
    parseHiddenKeys(localStorage.getItem("collapsedProjects")),
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem("viewMode") === "cards" ? "cards" : "list",
  );
  const [language, setLanguage] = useState(() => parseLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY)));
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [closeAction, setCloseAction] = useState(() => parseCloseAction(localStorage.getItem("closeAction")));
  const [scanInterval, setScanInterval] = useState(() => parseScanInterval(localStorage.getItem("scanInterval")));
  const [pages, setPages] = useState<Record<string, PageInfo>>({});
  const requestedPages = useRef(new Set<string>());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scanning = useRef(false);
  const lastScan = useRef(0);
  const scanRef = useRef<ScanResult | null>(null);
  const lastTrayMenu = useRef("");
  const toastTimer = useRef<number>(undefined);

  const refresh = useCallback(async () => {
    if (scanning.current) return;
    scanning.current = true;
    lastScan.current = Date.now();
    try {
      setScan(await invoke<ScanResult>("scan_services"));
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      scanning.current = false;
    }
  }, []);

  // Scan continuously, and less often while the window is hidden; slower scans keep the tray menu current.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      const visible = document.visibilityState === "visible";
      const interval = visible ? scanInterval : Math.max(scanInterval, HIDDEN_SCAN_INTERVAL_MS);
      if (Date.now() - lastScan.current >= interval - scanInterval / 2) refresh();
    }, scanInterval);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, scanInterval]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
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
  useEffect(() => localStorage.setItem("showPreviews", String(showPreviews)), [showPreviews]);
  useEffect(() => localStorage.setItem("scanInterval", String(scanInterval)), [scanInterval]);
  useEffect(() => {
    localStorage.setItem("closeAction", closeAction);
    invoke("set_close_to_tray", { enabled: closeAction === "tray" }).catch(() => {});
  }, [closeAction]);
  useEffect(() => {
    invoke<boolean>("launch_at_login").then(setLaunchAtLogin, () => setLaunchAtLogin(null));
  }, []);
  useEffect(() => localStorage.setItem("groupProjects", String(groupProjects)), [groupProjects]);
  useEffect(
    () => localStorage.setItem("collapsedProjects", serializeHiddenKeys(collapsedProjects)),
    [collapsedProjects],
  );
  useEffect(() => localStorage.setItem("viewMode", viewMode), [viewMode]);

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
    () => sectionServices(scan?.services ?? [], hiddenKeys, query, types),
    [scan, hiddenKeys, query, types],
  );

  // Offer the types of everything that can currently be listed, regardless of the other filters.
  const typeChoices = useMemo(() => {
    const all = sectionServices(scan?.services ?? [], hiddenKeys, "");
    const listed = [...all.servers, ...(showOthers ? all.others : []), ...(showHidden ? all.hidden : [])];
    return typeOptions(listed, types);
  }, [scan, hiddenKeys, showOthers, showHidden, types, language]);

  // Read the title and favicon of web services as they appear in the list.
  useEffect(() => {
    if (!showPreviews) return;
    const visible = [
      ...sections.servers,
      ...(showOthers ? sections.others : []),
      ...(showHidden ? sections.hidden : []),
    ];
    for (const service of visible) {
      const url = previewUrl(service);
      if (!url) continue;
      const key = pageKey(service, url);
      if (requestedPages.current.has(key)) continue;
      requestedPages.current.add(key);
      invoke<PageInfo>("page_info", { url }).then(
        (page) => setPages((current) => ({ ...current, [key]: page })),
        () => {},
      );
    }
  }, [sections, showOthers, showHidden, showPreviews]);

  const settings: SettingsValues = { language, launchAtLogin, closeAction, scanInterval, showPreviews, showOthers };

  const changeSettings = (changes: Partial<SettingsValues>) => {
    if (changes.language) changeLanguage(changes.language);
    if (changes.closeAction) setCloseAction(changes.closeAction);
    if (changes.scanInterval) setScanInterval(changes.scanInterval);
    if (changes.showPreviews !== undefined) setShowPreviews(changes.showPreviews);
    if (changes.showOthers !== undefined) setShowOthers(changes.showOthers);
    if (changes.launchAtLogin != null) {
      invoke<boolean>("set_launch_at_login", { enabled: changes.launchAtLogin }).then(setLaunchAtLogin, (reason) =>
        notify(String(reason)),
      );
    }
  };

  const changeLanguage = (preference: LanguagePreference) => {
    setLocale(resolveLocale(preference));
    document.documentElement.lang = getLocale();
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    setLanguage(preference);
  };

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
    const stopService = async (service: Service, announce: boolean) => {
      setStoppingIds((current) => new Set(current).add(service.id));
      const stopped = service.docker
        ? await run("stop_container", { containerId: service.docker.containerId }, announce)
        : await run("stop_process_tree", { pid: service.pid }, announce);
      if (!stopped) {
        setStoppingIds((current) => {
          const next = new Set(current);
          next.delete(service.id);
          return next;
        });
      }
      return stopped;
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
        await stopService(service, true);
        window.setTimeout(refresh, 600);
      },
      stopProject: async ({ name, services }) => {
        const results = await Promise.all(
          services.filter((service) => service.canStop).map((service) => stopService(service, false)),
        );
        const count = results.filter(Boolean).length;
        if (count > 0) notify(t(count === 1 ? "projectStoppedOne" : "projectStopped", { name, count }));
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

  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);

  // Keep the tray menu in sync with the main list; it is only rebuilt when it changes.
  useEffect(() => {
    if (!scan) return;
    const menu = trayMenu(sectionServices(scan.services, hiddenKeys, "").servers, groupProjects);
    const serialized = JSON.stringify(menu);
    if (serialized === lastTrayMenu.current) return;
    lastTrayMenu.current = serialized;
    invoke("update_tray", { menu }).catch(() => {});
  }, [scan, hiddenKeys, groupProjects, language]);

  // Stop actions chosen in the tray menu.
  useEffect(() => {
    const unlisten = listen<string>("tray-action", ({ payload }) => {
      const services = scanRef.current?.services ?? [];
      if (payload.startsWith("stop-project:")) {
        const name = payload.slice("stop-project:".length);
        const members = services.filter((service) => service.project === name);
        if (members.length > 0) actions.stopProject({ name, services: members });
      } else if (payload.startsWith("stop:")) {
        const service = services.find((item) => item.id === payload.slice("stop:".length));
        if (service) actions.stop(service);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, [actions]);

  const pageFor = (service: Service) => {
    const url = previewUrl(service);
    return url ? pages[pageKey(service, url)] : undefined;
  };

  const renderList = (services: Service[], hidden = false) =>
    viewMode === "cards" ? (
      <ul className="service-grid">
        {services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            hidden={hidden}
            stopping={stoppingIds.has(service.id)}
            page={showPreviews ? pageFor(service) : undefined}
            actions={actions}
          />
        ))}
      </ul>
    ) : (
      <ul className="service-list">
        {services.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            hidden={hidden}
            stopping={stoppingIds.has(service.id)}
            page={showPreviews ? pageFor(service) : undefined}
            expanded={expandedId === service.id}
            onToggle={() => setExpandedId((current) => (current === service.id ? null : service.id))}
            actions={actions}
          />
        ))}
      </ul>
    );

  const toggleProject = (name: string) =>
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const renderGroups = (services: Service[]) => {
    const { projects, rest } = groupProjects ? groupByProject(services) : { projects: [], rest: services };
    const groups = groupServices(rest);
    if (projects.length === 0 && groups.length === 1) return renderList(services);
    return (
      <>
        {projects.map((project, index) => (
          <ProjectSection
            key={project.name}
            project={project}
            first={index === 0}
            collapsed={collapsedProjects.has(project.name)}
            stopping={project.services.every((service) => !service.canStop || stoppingIds.has(service.id))}
            onToggle={() => toggleProject(project.name)}
            onStop={() => actions.stopProject(project)}
          >
            {renderList(project.services)}
          </ProjectSection>
        ))}
        {groups.map((group, index) => (
          <Section key={group.title} title={group.title} first={projects.length === 0 && index === 0}>
            {renderList(group.services)}
          </Section>
        ))}
      </>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          {t("running")} {scan && <span className="count">{sections.servers.length}</span>}
        </h1>
        <div className="topbar-filters">
          <div className="view-switch" role="group" aria-label={t("viewMode")}>
            {(
              [
                ["list", List, t("listView")],
                ["cards", LayoutGrid, t("cardView")],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                aria-label={label}
                title={label}
                onClick={() => setViewMode(mode)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <TypeFilter
            options={typeChoices}
            selected={types}
            onChange={setTypes}
            renderIcon={(option: TypeOption) => (
              <TypeIcon framework={option.type} category={option.category} size={14} />
            )}
          />
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
        </div>
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
            ) : query || types.size > 0 ? (
              <EmptyState
                title={t("noMatches")}
                detail={query ? t("noMatchesDetail", { query }) : t("noMatchesTypes")}
              />
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
        <SettingsMenu
          values={settings}
          othersCount={scan ? sections.others.length : undefined}
          onChange={changeSettings}
        />
        <span
          className={`live ${error ? "offline" : ""}`}
          title={error || t("liveTitle", { interval: formatSeconds(scanInterval) })}
        >
          <i aria-hidden /> {error ? t("scanFailed") : t("live")}
          {!error && <span className="live-interval">{formatSeconds(scanInterval)}</span>}
        </span>
        <div className="filters">
          <FilterToggle
            icon={FolderTree}
            label={t("projectsFilter")}
            title={t("projectsFilterTitle")}
            pressed={groupProjects}
            onChange={setGroupProjects}
          />
          {sections.hidden.length > 0 && (
            <FilterToggle
              icon={EyeOff}
              label={t("hidden")}
              title={t("showHidden")}
              count={sections.hidden.length}
              pressed={showHidden}
              onChange={setShowHidden}
            />
          )}
        </div>
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

function FilterToggle({
  icon: Icon,
  label,
  title,
  count,
  pressed,
  onChange,
}: {
  icon: typeof Server;
  label: string;
  title: string;
  count?: number;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="filter-toggle"
      aria-pressed={pressed}
      title={title}
      onClick={() => onChange(!pressed)}
    >
      <Icon size={13} aria-hidden />
      {label}
      {count !== undefined && <span className="filter-count">{count}</span>}
    </button>
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

function ProjectSection({
  project,
  first,
  collapsed,
  stopping,
  onToggle,
  onStop,
  children,
}: {
  project: ProjectGroup;
  first: boolean;
  collapsed: boolean;
  stopping: boolean;
  onToggle: () => void;
  onStop: () => void;
  children: ReactNode;
}) {
  const memory = project.services.reduce((total, service) => total + service.memoryBytes, 0);
  const stoppable = project.services.filter((service) => service.canStop).length;
  const meta = [t("projectServices", { count: project.services.length }), memory > 0 && formatBytes(memory)];
  return (
    <section className={`section project ${first ? "first" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="project-header">
        <button type="button" className="project-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <ChevronRight size={14} className="project-chevron" aria-hidden />
          <span className="project-name">{project.name}</span>
          <span className="project-meta">{meta.filter(Boolean).join(" · ")}</span>
        </button>
        {stoppable > 0 && (
          <StopButton
            disabled={stopping}
            label={t("stopProject")}
            confirmLabel={t("stopAll", { count: stoppable })}
            onConfirm={onStop}
          />
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

/** What a service row or card shows, in the user's language. */
function describe(service: Service, page?: PageInfo) {
  const name = serviceName(service);
  return {
    name,
    meta: [
      serviceDetail(service),
      service.uptimeSeconds > 0 && formatUptime(service.uptimeSeconds),
      service.memoryBytes > 0 && formatBytes(service.memoryBytes),
    ]
      .filter(Boolean)
      .join(" · "),
    pageTitle: page?.title && page.title.toLowerCase() !== name.toLowerCase() ? page.title : undefined,
    // Only HTML pages report a title or favicon, so only they get a thumbnail.
    thumbnailUrl: page?.title || page?.favicon ? previewUrl(service) : undefined,
  };
}

function Ports({ service, actions }: { service: Service; actions: Actions }) {
  const extraPorts = service.ports.length - MAX_VISIBLE_PORTS;
  return (
    <div className="ports">
      {service.ports.slice(0, MAX_VISIBLE_PORTS).map((port) => (
        <PortChip key={port.port} port={port} actions={actions} />
      ))}
      {extraPorts > 0 && <span className="more-ports">+{extraPorts}</span>}
    </div>
  );
}

/** Opens the service in the browser, asking which port to open when it serves several. */
function OpenButton({ service, actions }: { service: Service; actions: Actions }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const urls = service.ports.filter((port): port is PortInfo & { url: string } => Boolean(port.url));

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  if (urls.length === 0) return null;
  if (urls.length === 1) {
    const { url } = urls[0];
    return (
      <IconButton label={t("openInBrowserUrl", { url })} onClick={() => actions.open(url)}>
        <ExternalLink size={15} />
      </IconButton>
    );
  }
  return (
    <div
      className="port-menu-anchor"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Keep the app's Escape shortcut from clearing the name filter.
        event.stopPropagation();
        setMenuOpen(false);
      }}
    >
      <IconButton label={t("openInBrowser")} expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
        <ExternalLink size={15} />
      </IconButton>
      {menuOpen && (
        <div className="port-menu" role="menu" aria-label={t("choosePort")}>
          <span className="port-menu-title">{t("choosePort")}</span>
          {urls.map((port, index) => (
            <button
              key={port.port}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              onClick={() => {
                setMenuOpen(false);
                actions.open(port.url);
              }}
            >
              <span className="port-menu-port">:{port.port}</span>
              <span className="port-menu-url">{port.url}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RowActions({
  service,
  hidden,
  stopping,
  actions,
}: {
  service: Service;
  hidden: boolean;
  stopping: boolean;
  actions: Actions;
}) {
  return (
    <div className="row-actions" onClick={(event) => event.stopPropagation()}>
      <OpenButton service={service} actions={actions} />
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
  );
}

function ServiceCard({
  service,
  hidden,
  stopping,
  page,
  actions,
}: {
  service: Service;
  hidden: boolean;
  stopping: boolean;
  page?: PageInfo;
  actions: Actions;
}) {
  const { name, meta, pageTitle, thumbnailUrl } = describe(service, page);
  return (
    <li className={`card ${stopping ? "stopping" : ""}`}>
      <div className="card-preview">
        {thumbnailUrl ? (
          <PagePreview url={thumbnailUrl} name={name} actions={actions} />
        ) : (
          <div className="card-placeholder">
            <TypeIcon framework={service.framework} category={service.category} size={28} />
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="card-heading">
          <ServiceIcon service={service} favicon={page?.favicon} />
          <div className="service-title">
            <span className="service-name" title={name}>
              {name}
            </span>
            <span className="service-meta" title={pageTitle ?? meta}>
              {stopping ? t("stopping") : (pageTitle ?? meta)}
            </span>
          </div>
        </div>
        {pageTitle && !stopping && <span className="card-meta">{meta}</span>}
        <div className="card-footer">
          <Ports service={service} actions={actions} />
          <RowActions service={service} hidden={hidden} stopping={stopping} actions={actions} />
        </div>
      </div>
    </li>
  );
}

function ServiceRow({
  service,
  hidden,
  stopping,
  page,
  expanded,
  onToggle,
  actions,
}: {
  service: Service;
  hidden: boolean;
  stopping: boolean;
  page?: PageInfo;
  expanded: boolean;
  onToggle: () => void;
  actions: Actions;
}) {
  const { name, meta, pageTitle, thumbnailUrl } = describe(service, page);

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
        <ServiceIcon service={service} favicon={page?.favicon} />
        <div className="service-title">
          <span className="service-name">
            {name}
            {pageTitle && <span className="page-title"> · {pageTitle}</span>}
          </span>
          <span className="service-meta">{stopping ? t("stopping") : meta}</span>
        </div>
        <Ports service={service} actions={actions} />
        <RowActions service={service} hidden={hidden} stopping={stopping} actions={actions} />
      </div>
      {expanded &&
        (thumbnailUrl ? (
          <div className="expanded-body">
            <div className="thumbnail">
              <PagePreview url={thumbnailUrl} name={name} actions={actions} />
            </div>
            <ServiceDetails service={service} actions={actions} />
          </div>
        ) : (
          <ServiceDetails service={service} actions={actions} />
        ))}
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

function StopButton({
  disabled,
  onConfirm,
  label = t("stop"),
  confirmLabel = t("stop"),
}: {
  disabled: boolean;
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
}) {
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
        {confirmLabel}
      </button>
    );
  }
  return (
    <IconButton label={label} danger disabled={disabled} onClick={() => setArmed(true)}>
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
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Set for buttons that open a menu. */
  expanded?: boolean;
}) {
  return (
    <button
      className={`icon-button ${danger ? "danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
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

/** Width of the desktop viewport the page is rendered at before being scaled down. */
const PREVIEW_WIDTH = 1280;

/**
 * A scaled-down live view of the page that fills its container. Sandboxed so it
 * can't navigate the app window; clicking it opens the page in the browser.
 */
function PagePreview({ url, name, actions }: { url: string; name: string; actions: Actions }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / PREVIEW_WIDTH));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="page-preview" ref={containerRef}>
      {scale > 0 && (
        <iframe
          src={url}
          title={t("pagePreview", { name })}
          sandbox="allow-scripts allow-same-origin allow-forms"
          loading="lazy"
          tabIndex={-1}
          style={{ width: PREVIEW_WIDTH, height: PREVIEW_WIDTH * 0.625, transform: `scale(${scale})` }}
        />
      )}
      <button
        className="page-preview-open"
        onClick={() => actions.open(url)}
        aria-label={t("openUrl", { url })}
        title={t("openUrl", { url })}
      >
        <span className="page-preview-hint" aria-hidden>
          <ExternalLink size={12} />
          {t("openInBrowser")}
        </span>
      </button>
    </div>
  );
}

function TypeIcon({ framework, category, size = 16 }: { framework: string; category: Category; size?: number }) {
  const brand = frameworkIcon(framework);
  const Fallback = categoryIcons[category] ?? Server;
  return brand ? <BrandIcon icon={brand} size={size} /> : <Fallback size={size} />;
}

function ServiceIcon({ service, favicon }: { service: Service; favicon?: string }) {
  const [failedFavicon, setFailedFavicon] = useState<string>();
  const fallback = <TypeIcon framework={service.framework} category={service.category} />;
  return (
    <div className="service-icon">
      {favicon && favicon !== failedFavicon ? (
        <img className="favicon" src={favicon} alt="" onError={() => setFailedFavicon(favicon)} />
      ) : (
        fallback
      )}
    </div>
  );
}

function BrandIcon({ icon, size = 16 }: { icon: SimpleIcon; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-label={icon.title} role="img">
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
