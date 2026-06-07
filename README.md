# Simple Dev Server Viewer

A small task manager for local dev servers.

AI coding agents are pretty good at starting test servers. They are not always as good at turning them off. This app gives you one place to see what is running, which ports it is using, and how to stop it.

## What It Does

- Finds active local servers and shows their ports, commands, folders, memory use, and uptime.
- Recognizes common frameworks, runtimes, databases, and Docker services.
- Lets you open a server in your browser, reveal its project folder, or stop its process tree.
- Shows likely dev services by default, with a toggle for everything else.
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

There is built-in support for Next.js, Astro, Vite, Nuxt, SvelteKit, Remix, Angular, webpack, Parcel, Rails, Node.js, Bun, Deno, Python, PHP, .NET, PostgreSQL, MySQL, MariaDB, Redis, MongoDB, Elasticsearch, Supabase, and common dev ports.

Docker containers are detected and labeled, but the app will not stop them.

## How It Works

The Rust backend scans listening ports, matches them to running processes, and sends the results to the React interface.

- `src-tauri/src/lib.rs`: scanner, service detection, Docker info, and process controls
- `src/App.tsx`: app behavior and interface
- `src/App.css`: styling

## Downloads

Grab the latest Windows, macOS, or Linux build from [Releases](https://github.com/timdreesen/simple-dev-server-viewer/releases).

On Windows, choose the file ending in `windows-x64-PORTABLE.exe` to run the app without installing it. The `.exe` ending in `nsis.exe` and the `.msi` file are installers.

The builds are currently unsigned, so Windows SmartScreen or macOS Gatekeeper may show a warning.

## License

[MIT](LICENSE)
