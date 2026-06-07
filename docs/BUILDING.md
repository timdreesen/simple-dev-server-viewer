# Building Simple Dev Server Viewer

This project uses Tauri 2, Rust, React, TypeScript, Vite, and npm. Build the application on the operating system you intend to target. Tauri does not generally support producing Windows, macOS, and Linux desktop bundles from a single host.

## Required Tools

Install:

- Git
- Node.js 22 or newer, including npm
- Rust stable through [rustup](https://rustup.rs/)
- The Tauri 2 prerequisites for your operating system

Confirm the tools are available:

```bash
git --version
node --version
npm --version
rustc --version
cargo --version
```

## Platform Prerequisites

### Windows 10/11

1. Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload.
2. Install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) if it is not already present.
3. Install Rust using the default MSVC toolchain.

Run commands from PowerShell. If PowerShell execution policy interferes with `npm`, use `npm.cmd`.

### macOS

Install Xcode command-line tools:

```bash
xcode-select --install
```

Building a `.dmg` requires macOS. Unsigned builds can be opened locally through Finder's **Open** context action.

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

For Fedora, Arch, and other distributions, install the equivalent WebKitGTK 4.1, GTK, OpenSSL, app indicator, and build-tool packages listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Clone and Run

```bash
git clone https://github.com/timdreesen/simple-dev-server-viewer.git
cd simple-dev-server-viewer
npm install
npm run tauri dev
```

The development command starts Vite and opens the native application window.

## Test and Validate

```bash
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

`npm run check` runs the frontend tests and production frontend build.

## Production Builds

```bash
npm install
npm run tauri build
```

Expected bundle locations:

- Windows: `src-tauri/target/release/bundle/msi/` and `src-tauri/target/release/bundle/nsis/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/appimage/` and `src-tauri/target/release/bundle/deb/`

The executable itself is in `src-tauri/target/release/`.

## GitHub Actions Builds

The validation workflow checks each pull request. The release workflow runs on tags matching `v*` and builds natively on Windows, macOS, and Ubuntu. Create a release build with:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The resulting installers are unsigned. Signing and notarization require project-owned certificates and secrets and are intentionally outside the version 1 build.

## Troubleshooting

- **`cargo` or `rustc` is not recognized:** restart your terminal after installing rustup and ensure Cargo's bin directory is on `PATH`.
- **Windows linker errors:** install or repair the Visual Studio C++ build tools and Windows SDK.
- **Linux WebKit/GTK errors:** install the exact distribution packages from Tauri's prerequisites.
- **Processes or ports are missing:** run with elevated permissions only when needed. The app reports listeners whose owning process cannot be inspected.
- **Docker labels are missing:** ensure `docker ps` works for the current user.
- **A stopped process remains visible briefly:** the scanner refreshes every two seconds; use manual refresh for immediate confirmation.
