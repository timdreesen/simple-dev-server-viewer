# Simple Dev Server Viewer

A small, cross-platform task manager for local development servers.

AI coding agents and development tools frequently leave test servers running. Simple Dev Server Viewer makes every likely development listener visible in one place, correlates ports with their processes, and lets you open, reveal, or gracefully stop them.

## Features

- Finds active TCP listeners and correlates them with processes, commands, directories, resource usage, and uptime.
- Recognizes common frameworks, runtimes, databases, and Docker-exposed services.
- Shows likely development services by default, with an option to reveal every listener.
- Opens local HTTP endpoints, reveals project directories, and stops native process trees.
- Runs on Windows 10/11, macOS, and Linux without bundling a browser engine.
- No accounts, telemetry, cloud services, or background process.

## Quick Start

Install the platform prerequisites from [the building manual](docs/BUILDING.md), then:

```bash
git clone https://github.com/timdreesen/simple-dev-server-viewer.git
cd simple-dev-server-viewer
npm install
npm run tauri dev
```

For a production installer:

```bash
npm run tauri build
```

Build outputs are written beneath `src-tauri/target/release/bundle/`.

## Supported Services

The built-in classifier recognizes Next.js, Astro, Vite, Nuxt, SvelteKit, Remix, Angular, webpack, Parcel, Rails, Node.js, Bun, Deno, Python, PHP, .NET, PostgreSQL, MySQL, MariaDB, Redis, MongoDB, Elasticsearch, Supabase, and common development ports. Docker containers are detected and labeled, but intentionally cannot be stopped in version 1.

## Architecture

The Tauri/Rust backend scans TCP listeners with `netstat2`, correlates PIDs and metrics through `sysinfo`, and exposes a small command API to the React interface. The frontend performs filtering, sorting, presentation, and confirmation flows. Classification remains separate from OS-specific process discovery so contributors can extend it without touching the UI.

- `src-tauri/src/lib.rs`: scanner, classifier, Docker metadata, and process controls
- `src/App.tsx`: application state, filters, actions, and interface
- `src/App.css`: visual system and responsive behavior

See [CONTRIBUTING.md](CONTRIBUTING.md) for classifier extension and testing guidance.

## Downloads

Tagged releases produce unsigned Windows, macOS, and Linux artifacts through GitHub Actions. Windows SmartScreen and macOS Gatekeeper may warn about unsigned community builds.

## License

[MIT](LICENSE)
