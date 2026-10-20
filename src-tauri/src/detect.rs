//! Pure detection logic: turns process names, command lines, and ports into a
//! classification. Kept free of OS calls so it can be unit tested everywhere.

use std::{
    collections::HashSet,
    net::IpAddr,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub category: &'static str,
    pub framework: String,
    pub is_likely_dev: bool,
}

struct Rule {
    framework: &'static str,
    category: &'static str,
    needles: &'static [&'static str],
}

const fn rule(
    framework: &'static str,
    category: &'static str,
    needles: &'static [&'static str],
) -> Rule {
    Rule {
        framework,
        category,
        needles,
    }
}

/// Ordered from most to least specific: meta-frameworks before the bundlers
/// they run on, and bare runtimes last.
const RULES: &[Rule] = &[
    rule("Next.js", "web", &["next", "next-server"]),
    rule("Nuxt", "web", &["nuxt", "nuxi"]),
    rule("Astro", "web", &["astro", "astrojs"]),
    rule("SvelteKit", "web", &["svelte", "sveltekit", "sveltejs"]),
    rule("Remix", "web", &["remix", "remix-serve"]),
    rule("React Router", "web", &["react-router"]),
    rule("Gatsby", "web", &["gatsby"]),
    rule("Docusaurus", "web", &["docusaurus"]),
    rule("Storybook", "web", &["storybook"]),
    rule("Angular", "web", &["angular", "ng"]),
    rule("Vue", "web", &["vue-cli-service"]),
    rule("Expo", "web", &["expo"]),
    rule("React Native", "web", &["react-native"]),
    rule("Ember", "web", &["ember"]),
    rule("Eleventy", "web", &["eleventy", "11ty"]),
    rule("Hugo", "web", &["hugo"]),
    rule("Jekyll", "web", &["jekyll"]),
    rule("Zola", "web", &["zola"]),
    rule("MkDocs", "web", &["mkdocs"]),
    rule("Wrangler", "web", &["wrangler", "workerd", "miniflare"]),
    rule("Vercel", "web", &["vercel"]),
    rule("Netlify", "web", &["netlify"]),
    rule("Firebase", "web", &["firebase"]),
    rule("Vite", "web", &["vite", "vitepress"]),
    rule("webpack", "web", &["webpack", "webpack-dev-server"]),
    rule("Rspack", "web", &["rspack", "rsbuild"]),
    rule("Parcel", "web", &["parcel"]),
    rule("esbuild", "web", &["esbuild"]),
    rule("Django", "web", &["django", "runserver", "daphne"]),
    rule("Flask", "web", &["flask"]),
    rule("FastAPI", "web", &["fastapi"]),
    rule("Uvicorn", "web", &["uvicorn", "hypercorn"]),
    rule("Gunicorn", "web", &["gunicorn"]),
    rule("Streamlit", "web", &["streamlit"]),
    rule(
        "Jupyter",
        "web",
        &["jupyter", "jupyterlab", "jupyter-lab", "jupyter-notebook"],
    ),
    rule("Rails", "web", &["rails", "puma"]),
    rule("Laravel", "web", &["artisan"]),
    rule("Symfony", "web", &["symfony"]),
    rule("Phoenix", "web", &["phx", "phoenix"]),
    rule("Spring Boot", "web", &["spring-boot", "springframework"]),
    rule(
        "Static server",
        "web",
        &[
            "http-server",
            "live-server",
            "http.server",
            "simplehttpserver",
        ],
    ),
    rule("json-server", "web", &["json-server"]),
    rule("Hardhat", "web", &["hardhat"]),
    rule("Anvil", "web", &["anvil"]),
    rule("Ollama", "web", &["ollama"]),
    rule("ngrok", "web", &["ngrok"]),
    rule("Mailpit", "web", &["mailpit", "mailhog"]),
    rule("LocalStack", "web", &["localstack"]),
    rule("Caddy", "web", &["caddy"]),
    rule("nginx", "web", &["nginx"]),
    rule("Apache", "web", &["httpd", "apache2"]),
    rule("WSL", "web", &["wslrelay"]),
    rule("Supabase", "database", &["supabase"]),
    rule(
        "PostgreSQL",
        "database",
        &["postgres", "postmaster", "postgresql"],
    ),
    rule("MariaDB", "database", &["mariadbd", "mariadb"]),
    rule("MySQL", "database", &["mysqld", "mysql"]),
    rule(
        "Redis",
        "database",
        &["redis", "redis-server", "redis-stack-server"],
    ),
    rule("Valkey", "database", &["valkey", "valkey-server"]),
    rule("Dragonfly", "database", &["dragonfly"]),
    rule("MongoDB", "database", &["mongod", "mongos", "mongo"]),
    rule("Elasticsearch", "database", &["elasticsearch"]),
    rule("OpenSearch", "database", &["opensearch"]),
    rule("Memcached", "database", &["memcached"]),
    rule(
        "ClickHouse",
        "database",
        &["clickhouse", "clickhouse-server"],
    ),
    rule("CockroachDB", "database", &["cockroach"]),
    rule("RabbitMQ", "database", &["rabbitmq", "rabbit"]),
    rule("Kafka", "database", &["kafka"]),
    rule("MinIO", "database", &["minio"]),
    rule("CouchDB", "database", &["couchdb"]),
    rule("Neo4j", "database", &["neo4j"]),
    rule("Cassandra", "database", &["cassandra"]),
    rule("InfluxDB", "database", &["influxd", "influxdb"]),
    rule("etcd", "database", &["etcd"]),
    rule("NATS", "database", &["nats-server", "nats"]),
    rule("Meilisearch", "database", &["meilisearch"]),
    rule("Typesense", "database", &["typesense", "typesense-server"]),
    rule("Qdrant", "database", &["qdrant"]),
    rule("SurrealDB", "database", &["surreal", "surrealdb"]),
    rule("SQL Server", "database", &["sqlservr", "mssql"]),
    rule(
        "Docker",
        "container",
        &["docker", "vpnkit", "rootlesskit", "orbstack"],
    ),
    rule(
        "Podman",
        "container",
        &["podman", "gvproxy", "conmon", "rootlessport"],
    ),
    rule("Android Emulator", "emulator", &["qemu", "emulator"]),
    rule("ADB", "emulator", &["adb"]),
    rule("Deno", "runtime", &["deno"]),
    rule("Bun", "runtime", &["bun"]),
    rule("Node.js", "runtime", &["node", "nodejs"]),
    rule("Python", "runtime", &["python", "pythonw", "py"]),
    rule(".NET", "runtime", &["dotnet"]),
    rule("PHP", "runtime", &["php", "php-fpm", "php-cgi"]),
    rule("Ruby", "runtime", &["ruby"]),
    rule("Elixir", "runtime", &["beam", "elixir", "mix"]),
    rule("Java", "runtime", &["java", "javaw"]),
    rule("Go", "runtime", &["go"]),
    rule("Rust", "runtime", &["cargo", "rust-target"]),
];

/// Desktop apps and OS services that commonly listen on "dev-looking" ports
/// (macOS AirPlay on 5000/7000, Windows WSD on 5357, Syncthing on 8384, ...).
/// Matched on the process name only.
const IGNORED_PROCESSES: &[&str] = &[
    "system",
    "svchost",
    "lsass",
    "wininit",
    "services",
    "spoolsv",
    "searchhost",
    "msedge",
    "msedgewebview2",
    "chrome",
    "google chrome",
    "firefox",
    "brave",
    "opera",
    "safari",
    "discord",
    "slack",
    "spotify",
    "steam",
    "steamwebhelper",
    "zoom",
    "zoom.us",
    "teams",
    "ms-teams",
    "dropbox",
    "onedrive",
    "googledrivefs",
    "syncthing",
    "controlcenter",
    "rapportd",
    "sharingd",
    "airplayxpchelper",
    "remoted",
    "cupsd",
    "cups-browsed",
    "sshd",
    "systemd",
    "systemd-resolved",
    "avahi-daemon",
    "rpcbind",
    "dnsmasq",
    "smbd",
    "nmbd",
    "kdeconnectd",
    "teamviewerd",
    "anydesk",
    "code",
    "cursor",
    "nvcontainer",
    "jetbrains-toolbox",
    "1password",
    // Android emulator networking helper; the emulator itself is listed.
    "netsimd",
];

const DATABASE_PORTS: &[u16] = &[
    1433, 2379, 3306, 4222, 5432, 5433, 5672, 5984, 6333, 6379, 6380, 7687, 7700, 8086, 8123, 9042,
    9092, 9200, 11211, 26257, 27017,
];

fn is_dev_port(port: u16) -> bool {
    matches!(
        port,
        1313 | 1420 | 2368 | 3000..=5999 | 6006 | 8000..=9999 | 19000..=19006 | 24678
    )
}

fn normalized_process_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower
        .strip_suffix(".exe")
        .map(str::to_string)
        .unwrap_or(lower)
}

fn push_word(out: &mut HashSet<String>, word: &str) {
    if word.is_empty() {
        return;
    }
    out.insert(word.to_string());
    for sub in word.split(['-', '_', '.', '@']) {
        if sub.is_empty() {
            continue;
        }
        out.insert(sub.to_string());
        let trimmed = sub.trim_end_matches(|c: char| c.is_ascii_digit());
        if !trimmed.is_empty() {
            out.insert(trimmed.to_string());
        }
    }
}

/// Extracts identifying words from a process name and its arguments. Only file
/// names (not parent directories) are used, so a project folder called
/// `my-next-app` does not turn every process inside it into "Next.js".
pub fn tokens(name: &str, args: &[String]) -> HashSet<String> {
    let mut out = HashSet::new();
    for part in std::iter::once(name).chain(args.iter().map(String::as_str)) {
        let lower = part.to_lowercase();
        // Packaged Electron/Chromium apps (VS Code, Discord, T3 Code, ...).
        if lower.starts_with("--type=") || lower.contains("app.asar") {
            out.insert("electron-app".into());
        }
        let pieces = lower.split(|c: char| {
            c.is_whitespace() || matches!(c, '=' | ';' | ',' | ':' | '"' | '\'' | '(' | ')')
        });
        for piece in pieces {
            let segments: Vec<&str> = piece.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
            for (index, segment) in segments.iter().enumerate() {
                let next = segments.get(index + 1).copied();
                match *segment {
                    "node_modules" => {
                        out.insert("node".into());
                        if let Some(package) = next {
                            if let Some(scope) = package.strip_prefix('@') {
                                push_word(&mut out, scope);
                                if let Some(name) = segments.get(index + 2) {
                                    push_word(&mut out, name);
                                }
                            } else if !package.starts_with('.') {
                                push_word(&mut out, package);
                            }
                        }
                    }
                    "target" if matches!(next, Some("debug" | "release")) => {
                        out.insert("rust-target".into());
                    }
                    ".venv" | "venv" | "site-packages" => {
                        out.insert("python".into());
                    }
                    segment if segment.starts_with("go-build") => {
                        out.insert("go".into());
                    }
                    _ => {}
                }
            }
            if let Some(basename) = segments.last() {
                push_word(&mut out, basename);
            }
        }
    }
    out
}

fn matching_rule(words: &HashSet<String>) -> Option<&'static Rule> {
    RULES
        .iter()
        .find(|rule| rule.needles.iter().any(|needle| words.contains(*needle)))
}

pub fn classify(name: &str, args: &[String], ports: &[u16]) -> Classification {
    let words = tokens(name, args);
    if IGNORED_PROCESSES.contains(&normalized_process_name(name).as_str())
        || words.contains("electron-app")
    {
        return Classification {
            category: "unknown",
            framework: "Other".into(),
            is_likely_dev: false,
        };
    }

    if let Some(rule) = matching_rule(&words) {
        return Classification {
            category: rule.category,
            framework: rule.framework.into(),
            is_likely_dev: true,
        };
    }

    classify_by_port(ports)
}

/// Classifies a Docker container from its image name, falling back to a
/// generic container label.
pub fn classify_image(image: &str, ports: &[u16]) -> Classification {
    let repository = image.split('@').next().unwrap_or(image);
    let repository = repository
        .rsplit_once(':')
        .filter(|(_, tag)| !tag.contains('/'))
        .map_or(repository, |(name, _)| name);
    let basename = repository.rsplit('/').next().unwrap_or(repository);
    match matching_rule(&tokens(basename, &[])) {
        Some(rule) if !matches!(rule.category, "runtime" | "emulator") => Classification {
            category: rule.category,
            framework: rule.framework.into(),
            is_likely_dev: true,
        },
        _ => {
            let database = ports.iter().any(|port| DATABASE_PORTS.contains(port));
            Classification {
                category: if database { "database" } else { "container" },
                framework: "Docker".into(),
                is_likely_dev: true,
            }
        }
    }
}

fn classify_by_port(ports: &[u16]) -> Classification {
    if ports.iter().any(|port| DATABASE_PORTS.contains(port)) {
        Classification {
            category: "database",
            framework: "Database".into(),
            is_likely_dev: true,
        }
    } else if ports.iter().copied().any(is_dev_port) {
        Classification {
            category: "web",
            framework: "Local server".into(),
            is_likely_dev: true,
        }
    } else {
        Classification {
            category: "unknown",
            framework: "Other".into(),
            is_likely_dev: false,
        }
    }
}

/// Parses the host ports out of `docker ps` "Ports" output, e.g.
/// `0.0.0.0:5432->5432/tcp, :::5432->5432/tcp, 127.0.0.1:8000-8002->8000-8002/tcp`.
pub fn docker_host_ports(ports: &str) -> Vec<u16> {
    let mut result = Vec::new();
    for mapping in ports.split(',') {
        let Some((host, _)) = mapping.split_once("->") else {
            continue;
        };
        if !mapping.contains("/tcp") {
            continue;
        }
        let spec = host.rsplit(':').next().unwrap_or(host).trim();
        let (start, end) = match spec.split_once('-') {
            Some((start, end)) => (start.parse::<u16>(), end.parse::<u16>()),
            None => (spec.parse::<u16>(), spec.parse::<u16>()),
        };
        if let (Ok(start), Ok(end)) = (start, end) {
            if start <= end && end - start < 1024 {
                result.extend(start..=end);
            }
        }
    }
    result.sort_unstable();
    result.dedup();
    result
}

/// Host part of a browsable URL for a listening address.
pub fn url_host(address: IpAddr) -> String {
    if address.is_unspecified() || address.is_loopback() {
        "localhost".into()
    } else if address.is_ipv6() {
        format!("[{address}]")
    } else {
        address.to_string()
    }
}

pub fn protocol_for(port: u16, category: &str) -> Option<&'static str> {
    if matches!(category, "database" | "emulator") {
        return None;
    }
    match port {
        443 | 8443 => Some("https"),
        _ => Some("http"),
    }
}

/// A human-friendly project name: the folder that owns `node_modules` when the
/// script lives there, otherwise the working directory (unless it is a
/// meaningless location such as the home directory or `/`).
pub fn project_name(cwd: Option<&Path>, args: &[String], home: Option<&Path>) -> Option<String> {
    for arg in args {
        let normalized = arg.replace('\\', "/");
        if let Some((root, _)) = normalized.split_once("/node_modules/") {
            if let Some(name) = Path::new(root).file_name() {
                return Some(name.to_string_lossy().into_owned());
            }
        }
    }
    let cwd = cwd?;
    let is_meaningless = cwd.parent().is_none()
        || home.is_some_and(|home| home == cwd)
        || ["/usr", "/bin", "/sbin", "/etc", "/System", "/Library"]
            .iter()
            .any(|prefix| cwd.starts_with(prefix))
        || ["/tmp", "/opt", "/var", "/Applications"]
            .iter()
            .any(|dir| cwd == Path::new(dir))
        || cwd.to_string_lossy().to_lowercase().contains("\\windows\\");
    if is_meaningless {
        return None;
    }
    cwd.file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

/// The virtual device name of an Android emulator (`-avd Pixel_8_API_35`).
pub fn emulator_name(args: &[String]) -> Option<String> {
    args.iter()
        .position(|arg| arg == "-avd" || arg == "@")
        .and_then(|index| args.get(index + 1))
        .or_else(|| {
            args.iter()
                .find_map(|arg| arg.strip_prefix('@').filter(|n| !n.is_empty()).map(|_| arg))
        })
        .map(|name| name.trim_start_matches('@').replace('_', " "))
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(command: &str) -> Vec<String> {
        command.split_whitespace().map(str::to_string).collect()
    }

    fn framework(name: &str, command: &str, ports: &[u16]) -> String {
        classify(name, &args(command), ports).framework
    }

    #[test]
    fn classifies_frameworks_from_command() {
        assert_eq!(framework("node", "next dev", &[3000]), "Next.js");
        assert_eq!(framework("next-server (v15.0.0)", "", &[3000]), "Next.js");
        assert_eq!(framework("node", "astro dev", &[4321]), "Astro");
        assert_eq!(
            framework("node", "node /home/me/app/node_modules/.bin/vite", &[5173]),
            "Vite"
        );
        assert_eq!(
            framework("node", "node /p/node_modules/@sveltejs/kit/x.js", &[5173]),
            "SvelteKit"
        );
        assert_eq!(
            framework(
                "node",
                "node /p/node_modules/@angular/cli/bin/ng.js serve",
                &[4200]
            ),
            "Angular"
        );
    }

    #[test]
    fn classifies_backend_frameworks() {
        assert_eq!(
            framework("python3", "python3 manage.py runserver", &[8000]),
            "Django"
        );
        assert_eq!(
            framework("python3.12", "/proj/.venv/bin/uvicorn main:app", &[8000]),
            "Uvicorn"
        );
        assert_eq!(
            framework("python3", "python3 -m http.server 8000", &[8000]),
            "Static server"
        );
        assert_eq!(framework("php8.3", "php artisan serve", &[8000]), "Laravel");
        assert_eq!(framework("ruby", "ruby bin/rails server", &[3000]), "Rails");
        assert_eq!(framework("hugo", "hugo server", &[1313]), "Hugo");
        assert_eq!(
            framework("main", "/tmp/go-build123/b001/exe/main", &[8080]),
            "Go"
        );
        assert_eq!(
            framework("api", "/home/me/api/target/debug/api", &[8080]),
            "Rust"
        );
        assert_eq!(framework("wslrelay.exe", "", &[3000]), "WSL");
    }

    #[test]
    fn avoids_substring_false_positives() {
        // "bundle" and "ubuntu" used to match "bun"; "nextcloud" matched "next".
        assert_eq!(
            framework("ruby", "bundle exec rails server", &[3000]),
            "Rails"
        );
        assert_eq!(
            framework("custom", "/usr/lib/ubuntu-advantage/daemon", &[123]),
            "Other"
        );
        assert_eq!(framework("nextcloud", "nextcloud", &[123]), "Other");
        assert_eq!(
            framework("node", "node /home/me/my-next-app/server.js", &[3000]),
            "Node.js"
        );
        assert_eq!(
            framework("node", "node /home/me/invite-api/index.js", &[3000]),
            "Node.js"
        );
    }

    #[test]
    fn classifies_databases() {
        assert_eq!(
            framework("postgres", "postgres: 16/main: checkpointer", &[5432]),
            "PostgreSQL"
        );
        assert_eq!(
            framework("redis-server", "redis-server *:6379", &[6379]),
            "Redis"
        );
        assert_eq!(classify("mysqld", &[], &[3306]).category, "database");
    }

    #[test]
    fn recognizes_common_dev_ports() {
        let result = classify("custom", &args("custom"), &[5173]);
        assert!(result.is_likely_dev);
        assert_eq!(result.framework, "Local server");
        assert_eq!(classify("custom", &[], &[5432]).category, "database");
    }

    #[test]
    fn leaves_unusual_listeners_unclassified() {
        assert!(!classify("custom", &args("custom"), &[123]).is_likely_dev);
    }

    #[test]
    fn ignores_known_desktop_apps_on_dev_ports() {
        assert!(!classify("ControlCenter", &[], &[5000, 7000]).is_likely_dev);
        assert!(!classify("svchost.exe", &[], &[5040]).is_likely_dev);
        assert!(!classify("syncthing", &[], &[8384]).is_likely_dev);
        assert!(
            !classify(
                "t3code",
                &args("/opt/T3/t3code --require /opt/T3/resources/app.asar/main.js"),
                &[3773]
            )
            .is_likely_dev
        );
        assert!(!classify("Discord", &args("Discord --type=renderer"), &[6463]).is_likely_dev);
        let emulator = classify(
            "qemu-system-x86",
            &args("qemu-system-x86_64-headless -avd x"),
            &[5554],
        );
        assert_eq!(emulator.framework, "Android Emulator");
        assert!(emulator.is_likely_dev);
        assert_eq!(emulator.category, "emulator");
        assert_eq!(
            framework("adb", "adb -L tcp:5037 fork-server server", &[5037]),
            "ADB"
        );
        assert!(!classify("netsimd", &[], &[6402]).is_likely_dev);
    }

    #[test]
    fn classifies_docker_images() {
        assert_eq!(
            classify_image("postgres:16-alpine", &[5432]).framework,
            "PostgreSQL"
        );
        assert_eq!(
            classify_image("bitnami/redis:latest", &[6379]).framework,
            "Redis"
        );
        assert_eq!(
            classify_image("localhost:5000/team/api:dev", &[8080]).framework,
            "Docker"
        );
        assert_eq!(
            classify_image("ghcr.io/acme/web", &[8080]).category,
            "container"
        );
    }

    #[test]
    fn parses_docker_ports() {
        assert_eq!(
            docker_host_ports("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"),
            vec![5432]
        );
        assert_eq!(docker_host_ports("[::]:80->80/tcp"), vec![80]);
        assert_eq!(docker_host_ports("192.168.1.5:8080->80/tcp"), vec![8080]);
        assert_eq!(
            docker_host_ports("127.0.0.1:8000-8002->8000-8002/tcp"),
            vec![8000, 8001, 8002]
        );
        assert!(docker_host_ports("5432/tcp").is_empty());
        assert!(docker_host_ports("0.0.0.0:53->53/udp").is_empty());
    }

    #[test]
    fn builds_browsable_hosts() {
        assert_eq!(url_host("0.0.0.0".parse().unwrap()), "localhost");
        assert_eq!(url_host("::".parse().unwrap()), "localhost");
        assert_eq!(url_host("::1".parse().unwrap()), "localhost");
        assert_eq!(url_host("192.168.1.5".parse().unwrap()), "192.168.1.5");
        assert_eq!(url_host("fe80::1".parse().unwrap()), "[fe80::1]");
    }

    #[test]
    fn derives_emulator_names() {
        assert_eq!(
            emulator_name(&args(
                "qemu-system-x86_64-headless -avd Pixel_8_API_35 -port 5554"
            )),
            Some("Pixel 8 API 35".into())
        );
        assert_eq!(
            emulator_name(&args("emulator @doko-api35")),
            Some("doko-api35".into())
        );
        assert_eq!(emulator_name(&args("adb fork-server")), None);
    }

    #[test]
    fn derives_project_names() {
        let home = Path::new("/home/me");
        assert_eq!(
            project_name(
                Some(Path::new("/home/me")),
                &args("node /home/me/shop/node_modules/.bin/vite"),
                Some(home)
            ),
            Some("shop".into())
        );
        assert_eq!(
            project_name(Some(Path::new("/home/me/blog")), &[], Some(home)),
            Some("blog".into())
        );
        assert_eq!(
            project_name(Some(Path::new("/home/me")), &[], Some(home)),
            None
        );
        assert_eq!(project_name(Some(Path::new("/")), &[], Some(home)), None);
    }
}
