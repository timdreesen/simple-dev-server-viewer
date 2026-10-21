mod detect;
mod preview;

use detect::{
    classify, classify_image, compose_project, docker_host_ports, protocol_for, url_host,
};
use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::{BTreeMap, HashMap},
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};
use tauri::State;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// How long to wait before asking Docker again after it was not reachable.
const DOCKER_RETRY: Duration = Duration::from_secs(30);

struct AppState {
    system: Mutex<System>,
    docker_unavailable_until: Mutex<Option<Instant>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortInfo {
    port: u16,
    address: String,
    url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerInfo {
    container_id: String,
    name: String,
    image: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Service {
    id: String,
    pid: Option<u32>,
    name: String,
    display_name: String,
    command: String,
    working_directory: Option<String>,
    category: &'static str,
    framework: String,
    is_likely_dev: bool,
    cpu_percent: f32,
    memory_bytes: u64,
    uptime_seconds: u64,
    ports: Vec<PortInfo>,
    docker: Option<DockerInfo>,
    can_stop: bool,
    can_reveal: bool,
    hide_key: String,
    /// Groups services that belong together: a Docker Compose project or the
    /// folder a process runs from.
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    services: Vec<Service>,
    scanned_at: u64,
    docker_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    success: bool,
    message: String,
    /// Identifies a known outcome so the interface can show it in the user's
    /// language. `message` is the English fallback, e.g. for system errors.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<usize>,
}

impl ActionResult {
    fn ok(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            code: None,
            count: None,
        }
    }

    fn fail(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            code: None,
            count: None,
        }
    }

    fn code(mut self, code: &'static str) -> Self {
        self.code = Some(code);
        self
    }

    fn count(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }
}

#[derive(Deserialize)]
struct DockerRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Ports")]
    ports: String,
    #[serde(rename = "Labels", default)]
    labels: String,
}

struct Container {
    info: DockerInfo,
    ports: Vec<u16>,
    project: Option<String>,
}

fn quiet_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn docker_containers(state: &AppState) -> Option<Vec<Container>> {
    let mut unavailable_until = state.docker_unavailable_until.lock().ok()?;
    if unavailable_until.is_some_and(|until| Instant::now() < until) {
        return None;
    }
    let output = quiet_command("docker")
        .args(["ps", "--no-trunc", "--format", "{{json .}}"])
        .output();
    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => {
            *unavailable_until = Some(Instant::now() + DOCKER_RETRY);
            return None;
        }
    };
    *unavailable_until = None;
    let containers = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<DockerRow>(line).ok())
        .map(|row| Container {
            ports: docker_host_ports(&row.ports),
            project: compose_project(&row.labels),
            info: DockerInfo {
                container_id: row.id,
                name: row.names.split(',').next().unwrap_or_default().to_string(),
                image: row.image,
            },
        })
        .collect();
    Some(containers)
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Every listening TCP port, grouped by owning PID. Sockets whose owner cannot
/// be read (e.g. root-owned `docker-proxy` on Linux) are kept under `None`
/// instead of being dropped.
fn listeners() -> Result<HashMap<Option<u32>, BTreeMap<u16, IpAddr>>, String> {
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP,
    )
    .map_err(|error| error.to_string())?;
    let mut by_pid: HashMap<Option<u32>, BTreeMap<u16, IpAddr>> = HashMap::new();
    for socket in sockets {
        let ProtocolSocketInfo::Tcp(tcp) = socket.protocol_socket_info else {
            continue;
        };
        if tcp.state != TcpState::Listen {
            continue;
        }
        let owners: Vec<Option<u32>> = if socket.associated_pids.is_empty() {
            vec![None]
        } else {
            socket.associated_pids.into_iter().map(Some).collect()
        };
        for owner in owners {
            let ports = by_pid.entry(owner).or_default();
            // Prefer the most reachable address when a port is bound twice.
            let entry = ports.entry(tcp.local_port).or_insert(tcp.local_addr);
            if tcp.local_addr.is_unspecified() || tcp.local_addr.is_loopback() {
                *entry = tcp.local_addr;
            }
        }
    }
    Ok(by_pid)
}

fn port_infos(ports: &BTreeMap<u16, IpAddr>, category: &str) -> Vec<PortInfo> {
    ports
        .iter()
        .map(|(&port, &address)| {
            let host = url_host(address);
            PortInfo {
                port,
                url: protocol_for(port, category).map(|scheme| format!("{scheme}://{host}:{port}")),
                address: host,
            }
        })
        .collect()
}

fn process_hide_key(process: Option<&Process>, name: &str) -> String {
    let identity = process
        .and_then(|process| process.exe())
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| name.to_string());
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    format!("process:{identity}")
}

fn process_service(pid: u32, ports: &BTreeMap<u16, IpAddr>, system: &System) -> Service {
    let process = system.process(Pid::from_u32(pid));
    let name = process
        .map(|p| p.name().to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown process".into());
    let args: Vec<String> = process
        .map(|p| {
            p.cmd()
                .iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let port_numbers: Vec<u16> = ports.keys().copied().collect();
    let classification = classify(&name, &args, &port_numbers);
    let cwd = process.and_then(|p| p.cwd());
    let project = if classification.category == "emulator" {
        None
    } else {
        detect::project_name(cwd, &args, detect::home_dir().as_deref())
    };
    let display_name = if classification.category == "emulator" {
        detect::emulator_name(&args)
    } else {
        project.clone()
    }
    .unwrap_or_else(|| match classification.framework.as_str() {
        "Other" | "Local server" | "Database" if process.is_some() => name.clone(),
        framework => framework.to_string(),
    });
    Service {
        id: format!("pid:{pid}"),
        pid: Some(pid),
        hide_key: process_hide_key(process, &name),
        display_name,
        command: args.join(" "),
        working_directory: cwd.map(|path| path.to_string_lossy().into_owned()),
        ports: port_infos(ports, classification.category),
        category: classification.category,
        framework: classification.framework,
        is_likely_dev: classification.is_likely_dev,
        cpu_percent: process.map_or(0.0, |p| p.cpu_usage()),
        memory_bytes: process.map_or(0, |p| p.memory()),
        uptime_seconds: process.map_or(0, |p| p.run_time()),
        docker: None,
        can_stop: process.is_some(),
        can_reveal: cwd.is_some(),
        project,
        name,
    }
}

fn restricted_service(port: u16, address: IpAddr) -> Service {
    let classification = classify("", &[], &[port]);
    let ports = BTreeMap::from([(port, address)]);
    Service {
        id: format!("port:{port}"),
        pid: None,
        name: "Restricted process".into(),
        display_name: format!("Port {port}"),
        command: String::new(),
        working_directory: None,
        ports: port_infos(&ports, classification.category),
        category: classification.category,
        framework: classification.framework,
        is_likely_dev: classification.is_likely_dev,
        cpu_percent: 0.0,
        memory_bytes: 0,
        uptime_seconds: 0,
        docker: None,
        can_stop: false,
        can_reveal: false,
        hide_key: format!("port:{port}"),
        project: None,
    }
}

fn container_service(container: Container, listening: &BTreeMap<u16, IpAddr>) -> Service {
    let classification = classify_image(&container.info.image, &container.ports);
    let ports: BTreeMap<u16, IpAddr> = container
        .ports
        .iter()
        .map(|port| {
            let address = listening
                .get(port)
                .copied()
                .unwrap_or(IpAddr::from([127, 0, 0, 1]));
            (*port, address)
        })
        .collect();
    Service {
        id: format!("docker:{}", container.info.container_id),
        pid: None,
        name: container.info.image.clone(),
        display_name: container.info.name.clone(),
        command: container.info.image.clone(),
        working_directory: None,
        ports: port_infos(&ports, classification.category),
        category: classification.category,
        framework: classification.framework,
        is_likely_dev: true,
        cpu_percent: 0.0,
        memory_bytes: 0,
        uptime_seconds: 0,
        hide_key: format!("docker:{}", container.info.name),
        docker: Some(container.info),
        can_stop: true,
        can_reveal: false,
        project: container.project,
    }
}

#[tauri::command(async)]
fn scan_services(state: State<AppState>) -> Result<ScanResult, String> {
    let mut by_pid = listeners()?;
    let containers = docker_containers(&state);
    let docker_available = containers.is_some();

    // Ports published by Docker belong to the container, not to whichever
    // proxy process (docker-proxy, com.docker.backend, wslrelay, ...) happens
    // to hold the socket. Containers are listed even if no proxy is visible.
    let mut services = Vec::new();
    if let Some(containers) = containers {
        let mut all_listening = BTreeMap::new();
        for ports in by_pid.values() {
            all_listening.extend(ports.iter().map(|(port, addr)| (*port, *addr)));
        }
        for container in containers.into_iter().filter(|c| !c.ports.is_empty()) {
            for ports in by_pid.values_mut() {
                ports.retain(|port, _| !container.ports.contains(port));
            }
            services.push(container_service(container, &all_listening));
        }
        by_pid.retain(|_, ports| !ports.is_empty());
    }

    let mut system = state
        .system
        .lock()
        .map_err(|_| "Process scanner unavailable")?;
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cwd(UpdateKind::OnlyIfNotSet),
    );

    for (owner, ports) in &by_pid {
        match owner {
            Some(pid) => services.push(process_service(*pid, ports, &system)),
            None => services.extend(
                ports
                    .iter()
                    .map(|(port, address)| restricted_service(*port, *address)),
            ),
        }
    }
    services.sort_by_key(|service| service.ports.first().map_or(u16::MAX, |port| port.port));

    Ok(ScanResult {
        services,
        scanned_at: now_seconds(),
        docker_available,
    })
}

fn collect_descendants(system: &System, root: Pid) -> Vec<Pid> {
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let mut result = Vec::new();
    let mut queue = vec![root];
    while let Some(parent) = queue.pop() {
        for child in children.get(&parent).into_iter().flatten() {
            if !result.contains(child) {
                result.push(*child);
                queue.push(*child);
            }
        }
    }
    result
}

fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "es" })
}

#[tauri::command(async)]
fn stop_process_tree(pid: u32, state: State<AppState>) -> ActionResult {
    let Ok(mut system) = state.system.lock() else {
        return ActionResult::fail("Process scanner unavailable").code("scannerUnavailable");
    };
    system.refresh_processes(ProcessesToUpdate::All, true);
    let root = Pid::from_u32(pid);
    let mut targets = collect_descendants(&system, root);
    targets.reverse();
    targets.push(root);
    let stopped = targets
        .into_iter()
        .filter_map(|target| system.process(target))
        .filter(|process| {
            process
                .kill_with(Signal::Term)
                .unwrap_or_else(|| process.kill())
        })
        .count();
    if stopped > 0 {
        ActionResult::ok(format!("Stopped {}", plural(stopped, "process")))
            .code("processesStopped")
            .count(stopped)
    } else {
        ActionResult::fail("The process is no longer running or could not be stopped")
            .code("stopFailed")
    }
}

#[tauri::command(async)]
fn stop_container(container_id: String) -> ActionResult {
    if container_id.is_empty() || !container_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return ActionResult::fail("Invalid container ID").code("invalidContainerId");
    }
    match quiet_command("docker")
        .args(["stop", &container_id])
        .output()
    {
        Ok(output) if output.status.success() => {
            ActionResult::ok("Container stopped").code("containerStopped")
        }
        Ok(output) => {
            ActionResult::fail(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
        Err(error) => ActionResult::fail(error.to_string()),
    }
}

#[tauri::command(async)]
fn reveal_process_directory(pid: u32, state: State<AppState>) -> ActionResult {
    let path: Option<PathBuf> = state.system.lock().ok().and_then(|system| {
        system
            .process(Pid::from_u32(pid))
            .and_then(|process| process.cwd())
            .map(Path::to_path_buf)
    });
    let Some(path) = path else {
        return ActionResult::fail("Working directory is unavailable").code("folderUnavailable");
    };
    match tauri_plugin_opener::open_path(&path, None::<&str>) {
        Ok(()) => ActionResult::ok(format!("Opened {}", path.display())),
        Err(error) => ActionResult::fail(error.to_string()),
    }
}

#[tauri::command(async)]
fn open_service(url: String) -> ActionResult {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return ActionResult::fail("Only HTTP and HTTPS URLs can be opened").code("unsupportedUrl");
    }
    match tauri_plugin_opener::open_url(&url, None::<&str>) {
        Ok(()) => ActionResult::ok(format!("Opened {url}")),
        Err(error) => ActionResult::fail(error.to_string()),
    }
}

#[tauri::command(async)]
fn page_info(url: String) -> Result<preview::PageInfo, String> {
    preview::fetch(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_process_name_for_hide_key() {
        assert_eq!(process_hide_key(None, "svchost.exe"), "process:svchost.exe");
    }

    #[test]
    fn restricted_listeners_stay_visible() {
        let service = restricted_service(5173, IpAddr::from([0, 0, 0, 0]));
        assert!(service.is_likely_dev);
        assert_eq!(
            service.ports[0].url.as_deref(),
            Some("http://localhost:5173")
        );
    }

    #[test]
    fn containers_own_their_published_ports() {
        let container = Container {
            info: DockerInfo {
                container_id: "abc123".into(),
                name: "local-postgres".into(),
                image: "postgres:16".into(),
            },
            ports: vec![5432],
            project: Some("shop".into()),
        };
        let service = container_service(container, &BTreeMap::new());
        assert_eq!(service.framework, "PostgreSQL");
        assert_eq!(service.project.as_deref(), Some("shop"));
        assert_eq!(service.hide_key, "docker:local-postgres");
        assert!(service.ports[0].url.is_none());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            system: Mutex::new(System::new()),
            docker_unavailable_until: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_services,
            stop_process_tree,
            stop_container,
            reveal_process_directory,
            open_service,
            page_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Devtop");
}
