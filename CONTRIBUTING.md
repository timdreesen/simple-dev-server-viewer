# Contributing

Thanks for helping make local development processes easier to understand.

## Development

Follow [docs/BUILDING.md](docs/BUILDING.md) to configure your platform. Before opening a pull request, run:

```bash
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## Adding Classifiers

Classifier rules live in `src-tauri/src/lib.rs` inside `classify`. Add the narrowest reliable command or executable signature, assign a category and confidence score, and add a Rust unit test. Avoid classifying a generic runtime as a specific framework without evidence.

Confidence guidance:

- 90–100: explicit framework or database command
- 70–89: recognizable runtime
- 50–69: conventional port only
- Below 50: unknown listener

## Pull Requests

- Keep changes focused.
- Include tests for behavior changes.
- Update the building manual when prerequisites or commands change.
- Never add telemetry or network reporting without a public design discussion.
- Do not make Docker containers stoppable without a separate safety-focused proposal.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
