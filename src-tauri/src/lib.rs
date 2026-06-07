use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use regex::Regex;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashMap,
    net::IpAddr,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
use tauri::State;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppState {
    system: Mutex<System>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortInfo {
    port: u16,
    address: String,
    protocol: Option<String>,
    url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerInfo {
    container_id: String,
    name: String,
    image: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Service {
    id: String,
    pid: u32,
    name: String,
    display_name: String,
    command: String,
    working_directory: Option<String>,
    parent_pid: Option<u32>,
    category: String,
    framework: String,
    confidence: u8,
    is_likely_dev: bool,
    cpu_percent: f32,
    memory_bytes: u64,
    uptime_seconds: u64,
    ports: Vec<PortInfo>,
    docker: Option<DockerInfo>,
    can_stop: bool,
    can_reveal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    services: Vec<Service>,
    scanned_at: u64,
    listener_count: usize,
    inaccessible_count: usize,
    docker_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    success: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenServiceRequest {
    url: String,
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
}

fn classify(name: &str, command: &str, ports: &[PortInfo]) -> (String, String, u8, bool) {
    let haystack = format!("{} {}", name, command).to_lowercase();
    let rules = [
        ("next", "Next.js", "web", 98),
        ("astro", "Astro", "web", 98),
        ("vite", "Vite", "web", 96),
        ("nuxt", "Nuxt", "web", 96),
        ("svelte", "SvelteKit", "web", 94),
        ("remix", "Remix", "web", 94),
        ("ng serve", "Angular", "web", 94),
        ("webpack", "webpack", "web", 90),
        ("parcel", "Parcel", "web", 90),
        ("supabase", "Supabase", "database", 98),
        ("postgres", "PostgreSQL", "database", 96),
        ("mysqld", "MySQL", "database", 96),
        ("mariadb", "MariaDB", "database", 96),
        ("redis", "Redis", "database", 96),
        ("mongod", "MongoDB", "database", 96),
        ("elasticsearch", "Elasticsearch", "database", 96),
        ("deno", "Deno", "runtime", 82),
        ("bun", "Bun", "runtime", 82),
        ("node", "Node.js", "runtime", 78),
        ("python", "Python", "runtime", 76),
        ("dotnet", ".NET", "runtime", 76),
        ("rails", "Rails", "web", 88),
        ("php", "PHP", "runtime", 72),
    ];
    for (needle, framework, category, confidence) in rules {
        if haystack.contains(needle) {
            return (
                category.to_string(),
                framework.to_string(),
                confidence,
                true,
            );
        }
    }

    let database_port = ports
        .iter()
        .any(|p| matches!(p.port, 5432 | 3306 | 6379 | 27017 | 9200));
    let dev_port = ports.iter().any(|p| {
        matches!(
            p.port,
            3000..=3999 | 4173 | 4200 | 4321 | 5000..=5999 | 8000..=8999
        )
    });
    if database_port {
        ("database".into(), "Database".into(), 65, true)
    } else if dev_port {
        ("web".into(), "Local server".into(), 58, true)
    } else {
        ("unknown".into(), "Unknown listener".into(), 20, false)
    }
}

fn protocol_for(port: u16, category: &str) -> Option<&'static str> {
    if category == "database" {
        return None;
    }
    match port {
        443 | 8443 => Some("https"),
        _ => Some("http"),
    }
}

fn docker_services() -> (bool, HashMap<u16, DockerInfo>) {
    let mut command = Command::new("docker");
    command.args(["ps", "--format", "{{json .}}"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = match command.output() {
        Ok(output) if output.status.success() => output,
        _ => return (false, HashMap::new()),
    };
    let port_re = Regex::new(r"(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1):(\d+)->").unwrap();
    let mut by_port = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Ok(row) = serde_json::from_str::<DockerRow>(line) else {
            continue;
        };
        for capture in port_re.captures_iter(&row.ports) {
            if let Ok(port) = capture[1].parse::<u16>() {
                by_port.insert(
                    port,
                    DockerInfo {
                        container_id: row.id.clone(),
                        name: row.names.clone(),
                        image: row.image.clone(),
                    },
                );
            }
        }
    }
    (true, by_port)
}

fn display_address(address: IpAddr) -> String {
    if address.is_unspecified() {
        "localhost".into()
    } else {
        address.to_string()
    }
}

#[tauri::command]
fn scan_services(state: State<AppState>) -> Result<ScanResult, String> {
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::TCP;
    let sockets = get_sockets_info(af_flags, proto_flags).map_err(|error| error.to_string())?;
    let listener_count = sockets
        .iter()
        .filter(|socket| {
            matches!(
                socket.protocol_socket_info,
                ProtocolSocketInfo::Tcp(ref tcp) if tcp.state == TcpState::Listen
            )
        })
        .count();

    let mut ports_by_pid: HashMap<u32, Vec<PortInfo>> = HashMap::new();
    let mut inaccessible_count = 0;
    for socket in sockets {
        let ProtocolSocketInfo::Tcp(tcp) = socket.protocol_socket_info else {
            continue;
        };
        if tcp.state != TcpState::Listen {
            continue;
        }
        if socket.associated_pids.is_empty() {
            inaccessible_count += 1;
        }
        for pid in socket.associated_pids {
            ports_by_pid.entry(pid).or_default().push(PortInfo {
                port: tcp.local_port,
                address: display_address(tcp.local_addr),
                protocol: None,
                url: None,
            });
        }
    }

    let (docker_available, docker_by_port) = docker_services();
    let mut system = state
        .system
        .lock()
        .map_err(|_| "Process scanner unavailable")?;
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::everything(),
    );
    let mut services = Vec::new();
    for (pid, mut ports) in ports_by_pid {
        ports.sort_by_key(|item| item.port);
        ports.dedup_by_key(|item| item.port);
        let process = system.process(Pid::from_u32(pid));
        let name = process
            .map(|p| p.name().to_string_lossy().into_owned())
            .unwrap_or_else(|| "Restricted process".into());
        let command = process
            .map(|p| {
                p.cmd()
                    .iter()
                    .map(|part| part.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();
        let (category, framework, confidence, is_likely_dev) = classify(&name, &command, &ports);
        for port in &mut ports {
            port.protocol = protocol_for(port.port, &category).map(str::to_string);
            port.url = port
                .protocol
                .as_ref()
                .map(|protocol| format!("{}://{}:{}", protocol, port.address, port.port));
        }
        let docker = ports
            .iter()
            .find_map(|port| docker_by_port.get(&port.port).cloned());
        let is_docker = docker.is_some();
        let display_name = docker
            .as_ref()
            .map(|value| value.name.clone())
            .or_else(|| {
                process
                    .and_then(|p| p.cwd())
                    .and_then(|path| path.file_name())
                    .map(|value| value.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| framework.clone());
        services.push(Service {
            id: format!("{}:{}", pid, ports[0].port),
            pid,
            name,
            display_name,
            command,
            working_directory: process
                .and_then(|p| p.cwd())
                .map(|path| path.to_string_lossy().into_owned()),
            parent_pid: process.and_then(|p| p.parent()).map(|value| value.as_u32()),
            category: if is_docker {
                "container".into()
            } else {
                category
            },
            framework: if is_docker {
                "Docker".into()
            } else {
                framework
            },
            confidence: if is_docker { 100 } else { confidence },
            is_likely_dev: is_docker || is_likely_dev,
            cpu_percent: process.map_or(0.0, |p| p.cpu_usage()),
            memory_bytes: process.map_or(0, |p| p.memory()),
            uptime_seconds: process.map_or(0, |p| p.run_time()),
            ports,
            docker,
            can_stop: process.is_some() && !is_docker,
            can_reveal: process.and_then(|p| p.cwd()).is_some(),
        });
    }
    services.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });

    Ok(ScanResult {
        services,
        scanned_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        listener_count,
        inaccessible_count,
        docker_available,
    })
}

fn collect_descendants(system: &System, root: Pid) -> Vec<Pid> {
    let mut result = Vec::new();
    let mut queue = vec![root];
    while let Some(parent) = queue.pop() {
        for (pid, process) in system.processes() {
            if process.parent() == Some(parent) && !result.contains(pid) {
                result.push(*pid);
                queue.push(*pid);
            }
        }
    }
    result
}

#[tauri::command]
fn stop_process_tree(pid: u32, state: State<AppState>) -> ActionResult {
    let Ok(mut system) = state.system.lock() else {
        return ActionResult {
            success: false,
            message: "Process scanner unavailable".into(),
        };
    };
    system.refresh_processes(ProcessesToUpdate::All, true);
    let root = Pid::from_u32(pid);
    let mut targets = collect_descendants(&system, root);
    targets.reverse();
    targets.push(root);
    let mut stopped = 0;
    for target in targets {
        if let Some(process) = system.process(target) {
            if process
                .kill_with(Signal::Term)
                .unwrap_or_else(|| process.kill())
            {
                stopped += 1;
            }
        }
    }
    ActionResult {
        success: stopped > 0,
        message: if stopped > 0 {
            format!(
                "Stop signal sent to {} process{}",
                stopped,
                if stopped == 1 { "" } else { "es" }
            )
        } else {
            "The process is no longer running or could not be stopped".into()
        },
    }
}

fn reveal_path(path: &PathBuf) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    return Command::new("explorer").arg(path).spawn().map(|_| ());
    #[cfg(target_os = "macos")]
    return Command::new("open").arg(path).spawn().map(|_| ());
    #[cfg(target_os = "linux")]
    return Command::new("xdg-open").arg(path).spawn().map(|_| ());
}

#[tauri::command]
fn reveal_process_directory(pid: u32, state: State<AppState>) -> ActionResult {
    let Ok(system) = state.system.lock() else {
        return ActionResult {
            success: false,
            message: "Process scanner unavailable".into(),
        };
    };
    let path = system
        .process(Pid::from_u32(pid))
        .and_then(|process| process.cwd())
        .map(PathBuf::from);
    match path.and_then(|value| reveal_path(&value).ok().map(|_| value)) {
        Some(path) => ActionResult {
            success: true,
            message: format!("Opened {}", path.display()),
        },
        None => ActionResult {
            success: false,
            message: "Working directory is unavailable".into(),
        },
    }
}

#[tauri::command]
fn open_service(request: OpenServiceRequest) -> ActionResult {
    if !request.url.starts_with("http://") && !request.url.starts_with("https://") {
        return ActionResult {
            success: false,
            message: "Only local HTTP and HTTPS URLs can be opened".into(),
        };
    }
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &request.url])
            .spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&request.url).spawn()
    } else {
        Command::new("xdg-open").arg(&request.url).spawn()
    };
    ActionResult {
        success: result.is_ok(),
        message: result
            .map(|_| format!("Opened {}", request.url))
            .unwrap_or_else(|error| error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(port: u16) -> PortInfo {
        PortInfo {
            port,
            address: "localhost".into(),
            protocol: None,
            url: None,
        }
    }

    #[test]
    fn classifies_frameworks_from_command() {
        assert_eq!(classify("node", "next dev", &[port(3000)]).1, "Next.js");
        assert_eq!(classify("node", "astro dev", &[port(4321)]).1, "Astro");
    }

    #[test]
    fn recognizes_common_dev_ports() {
        let result = classify("custom", "custom", &[port(5173)]);
        assert!(result.3);
        assert_eq!(result.1, "Local server");
    }

    #[test]
    fn leaves_unusual_listeners_unclassified() {
        assert!(!classify("custom", "custom", &[port(123)]).3);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            system: Mutex::new(System::new_all()),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_services,
            stop_process_tree,
            reveal_process_directory,
            open_service
        ])
        .run(tauri::generate_context!())
        .expect("error while running Simple Dev Server Viewer");
}
