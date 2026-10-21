# Devtop

A small task manager for everything your dev work runs locally: dev servers, databases, containers, and emulators.

AI coding agents are pretty good at starting test servers. They are not always as good at turning them off. This app gives you one place to see what is running, which ports it is using, and how to stop it.

## What It Does

- Finds running dev servers, databases, Docker containers, and Android emulators, grouped in one list.
- Click a port to open it in your browser (or copy it, for databases).
- Click a row to see the full command, folder, PID, and resource use.
- Stop a server (process tree or Docker container) with two clicks, open its folder, or hide it.
- Shows likely dev services by default, with a toggle for other processes listening on ports.
- Follows your system's light or dark theme. Press `/` or `Ctrl+F` to filter.
- Speaks your system's language: English and Brazilian Portuguese so far.
- Runs on Windows 10/11, macOS, and Linux.
- Has no accounts, telemetry, cloud services, or background process.

## Run It Yourself

Install the platform requirements from [the building guide](docs/BUILDING.md), then:

```bash
git clone https://github.com/timdreesen/simple-dev-server-viewer.git
cd simple-dev-server-viewer
npm install
npm run tauri dev
```

To build an installer:

```bash
npm run tauri build
```

The finished builds will be in `src-tauri/target/release/bundle/`.

## What It Recognizes

Detection uses the process name and the script names in its command line (not parent folders, so a project called `my-next-app` is not mistaken for Next.js).

- **Web frameworks:** Next.js, Nuxt, Astro, SvelteKit, Remix, React Router, Gatsby, Docusaurus, Storybook, Angular, Vue CLI, Expo, React Native, Ember, Eleventy, Hugo, Jekyll, Zola, MkDocs, Vite, webpack, Rspack, Parcel, esbuild, Wrangler, Vercel, Netlify, Firebase
- **Backends:** Django, Flask, FastAPI, Uvicorn, Gunicorn, Streamlit, Jupyter, Rails, Laravel, Symfony, Phoenix, Spring Boot, static servers, json-server, Ollama, ngrok, Mailpit, LocalStack, Caddy, nginx, Apache
- **Databases and queues:** PostgreSQL, MySQL, MariaDB, Redis, Valkey, MongoDB, Elasticsearch, OpenSearch, Memcached, ClickHouse, CockroachDB, RabbitMQ, Kafka, MinIO, Neo4j, InfluxDB, Meilisearch, Qdrant, SQL Server, Supabase, and more
- **Runtimes:** Node.js, Bun, Deno, Python, PHP, Ruby, .NET, Java, Go (`go run`), Rust (`cargo run`), Elixir
- **Containers:** Docker containers are listed with their published ports, even when the proxy process belongs to root. Their image is used to label them (e.g. a `postgres:16` container shows as PostgreSQL).
- **WSL:** servers forwarded from WSL on Windows.
- **Emulators:** Android emulators (named after their virtual device) and ADB.

Unrecognized processes on common dev ports are shown as "Local server". Desktop apps and OS services that happen to use dev-looking ports (Electron apps, AirPlay, Windows services, Steam, Discord, ...) are moved to "other processes".

## How It Works

The Rust backend scans listening ports, matches them to running processes, and sends the results to the React interface.

- `src-tauri/src/detect.rs`: service detection rules (pure, unit tested)
- `src-tauri/src/lib.rs`: port scanner, Docker integration, and process controls
- `src/App.tsx`: app behavior and interface
- `src/services.ts`: list sections, filtering, and hidden services
- `src/i18n.ts` and `src/locales/`: translations
- `src/App.css`: styling

## Translations

The app picks the first supported language from your system settings and falls back to English. To add a language, copy `src/locales/pt-BR.ts`, translate every string (keep the `{placeholders}`), and register it in `src/i18n.ts`. TypeScript reports any missing string.

## Downloads

Grab the latest Windows, macOS, or Linux build from [Releases](https://github.com/timdreesen/simple-dev-server-viewer/releases).

On Windows, choose the file ending in `windows-x64-PORTABLE.exe` to run the app without installing it. The `.exe` ending in `nsis.exe` and the `.msi` file are installers.

The builds are currently unsigned, so Windows SmartScreen or macOS Gatekeeper may show a warning.

## License

[MIT](LICENSE)
