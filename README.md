# Markdown HTML

A **local markdown browser** for any project: declare one or more directories in
`md-html.toml`, then open a noon-themed HTML index in the browser — file tiles,
summaries, modal reader, in-doc history, and Mermaid when the CDN is reachable.

[![Status][Status-shield]][Status-url]
[![Docs][Docs-shield]][Docs-url]
[![License][License-shield]][License-url]

**Status: stable for local use**
> `md-html` is a small host tool (single Rust binary). Point it at your docs; it
> does not depend on your project's runtime. Interfaces are intentionally small
> and may still tighten.

[![Pendulum][Pendulum-shield]][Pendulum-url]
[![Rust][Rust-shield]][Rust-url]

---

## What md-html is

- **Project-local config** — one `md-html.toml` lists roots (e.g. `spec/`, `docs/`),
  title, port, and excludes. No folder-picker ritual; any project can opt in.
- **Single binary** — `cargo install` once; consumers add config + optional Make
  target. No Node, no submodule, no generated assets in git.
- **Browseable index** — noon UI (IBM Plex + parchment), tile summaries,
  filter search, list or mind-map layout (hamburger → View), full-screen
  modal, browser back stack. Serve mode live-reloads when docs change
  (polls a cheap revision stamp; also checks when the tab regains focus).
- **Honest links** — relative `.md` links resolve across roots via
  project-relative paths; nested `index.html` sites open in a new tab.
- **Safe by default** — loopback bind only; edit/save is opt-in (`writable`).
- **Mermaid when available** — fenced diagrams lazy-load from CDN; offline
  falls back to source.

## Documentation

| I am a… | Start at |
|---------|----------|
| Curious reader | this file |
| **Project consumer** | [Getting started](#getting-started) + [`examples/md-html.toml`](examples/md-html.toml) |
| **Tool maintainer** | [Repository layout](#repository-layout) + [Develop](#develop) |

Mantra: **"keep it simple, keep it safe"**.

## Repository layout

```
src/        # Rust CLI: config, scan, localhost server
viewer/     # Embedded HTML / CSS / JS (noon theme + MD renderer)
examples/   # Annotated md-html.toml
```

## Getting started

Install once (Rust toolchain required):

```bash
cargo install --git https://github.com/pendulumdev/md-html --locked
```

The binary is named `md-html`.

**Supported environments:** macOS 13+ (Apple Silicon & Intel) is the primary
target. Linux is best-effort. On Windows, use WSL2.

### Use in a project

From the project root:

```bash
md-html init          # writes md-html.toml (refuses to overwrite)
# edit roots / title / description
md-html serve         # http://127.0.0.1:4173/  (opens browser by default)
```

Or add a Make target:

```makefile
docs-view: ## Browse markdown docs in the browser (requires md-html)
	md-html serve
```

Nothing is committed except `md-html.toml`. No submodule, no generated assets.

### Config sketch

```toml
title = "Documents"
description = "Browsable index of project Markdown."
port = 4173
bind = "127.0.0.1"       # loopback only (enforced)
writable = false         # set true to enable Edit/Save in the UI
open_browser = true

[[roots]]
path = "docs"
label = "Docs"

[[roots]]
path = "spec"
label = "Spec"

[[roots]]
path = "."
label = "Root"
recursive = false

exclude = ["**/target/**", "**/.git/**", "**/node_modules/**"]
include_html_sites = true
```

See [`examples/md-html.toml`](examples/md-html.toml).

### Commands

| Command | Purpose |
|---------|---------|
| `md-html init` | Write starter `md-html.toml` |
| `md-html serve` | Scan roots and serve the viewer |
| `md-html build` | Static snapshot under `md-html-out/` (embedded `data.js`) |

Flags: `--config PATH`, `--port N`, `--bind ADDR`, `--no-open`, `build --out DIR`.

## Smoke checklist

After `md-html serve` in a configured repo:

1. Home lists every expected root section with tile summaries.
2. Opening a file shows rendered markdown; Esc closes; ← walks history.
3. An in-doc link to another `.md` opens in the modal (including across roots).
4. A ` ```mermaid ` fence renders a diagram when online.
5. With `writable = false`, Edit is hidden; with `true`, Save persists to disk.

## Develop

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
cargo run -- serve --config path/to/md-html.toml --no-open
```

## Versioning and tags

- Version source of truth: `Cargo.toml` (`md-html --version` via clap)
- Release = annotated git tag `vX.Y.Z` on `main` (no GitHub Release required)

```bash
# After bumping Cargo.toml version:
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --tags
```

## Contributing

Open issues and pull requests against
[`pendulumdev/md-html`](https://github.com/pendulumdev/md-html). Prefer small,
single-purpose changes; keep the dependency surface tiny.

## Contributors

md-html is designed and built with contributions from:

- **[Pendulum](https://pendulumdev.co.uk)** — lead development and maintenance.
- **[Devhalls](https://github.com/devhalls)** — primary author.

## License

**MIT** — full text in [`LICENSE`](LICENSE).

---

<!-- Badge definitions (reference-style; for-the-badge, black) -->
[Pendulum-shield]: https://img.shields.io/badge/pendulum-000000?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmlld0JveD0iMCAwIDE2NSAxNjUiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50IiB4MT0iMCIgeTE9IjgzLjUiIHgyPSIxNjEuMzkiIHkyPSI4My41IiBncmFkaWVudFRyYW5zZm9ybT0idHJhbnNsYXRlKDAgMTY2KSBzY2FsZSgxIC0xKSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzMyYjdkNiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2Y0OTYzYyIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxNjUiIGhlaWdodD0iMTY1IiBzdHlsZT0iZmlsbDp1cmwoI2xpbmVhci1ncmFkaWVudCk7Ii8+PHBhdGggZD0iTTU0LjA4LDEzM2gtMjUuOThWMzMuMDNoNDEuMzZjMTEuMjIsMCwxOS44MiwyLjkyLDI1Ljc4LDguNzVzOC45NSwxNC4wNSw4Ljk1LDI0LjY2LTIuOTgsMTguODMtOC45NSwyNC42NmMtNS45Niw1LjgzLTE0LjU2LDguNzUtMjUuNzgsOC43NWgtMTUuMzhzMCwzMy4xNSwwLDMzLjE1Wk01NC4wOCw3OC45aDguNjJjOS41NCwwLDE0LjMyLTQuMTUsMTQuMzItMTIuNDZzLTQuNzctMTIuNDYtMTQuMzItMTIuNDZoLTguNjJ2MjQuOTNoMFpNMTQzLjEsMzNsLTI2LjExLDEwMGgtMjVsMjYuMTEtMTAwaDI1WiIgc3R5bGU9ImZpbGw6I2ZmZjsiLz48L3N2Zz4=
[Pendulum-url]: https://pendulumdev.co.uk/
[Status-shield]: https://img.shields.io/badge/status-stable--local-000000?style=for-the-badge
[Status-url]: README.md
[Rust-shield]: https://img.shields.io/badge/rust-000000?style=for-the-badge&logo=rust
[Rust-url]: https://www.rust-lang.org/
[Docs-shield]: https://img.shields.io/badge/docs-000000?style=for-the-badge&logo=readthedocs
[Docs-url]: README.md
[License-shield]: https://img.shields.io/badge/license-MIT-000000?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xNiAybDEyIDQuNXY5YzAgOC4yLTUuMSAxNC4xLTEyIDE2LjhDOS4xIDI5LjYgNCAyMy43IDQgMTUuNXYtOUwxNiAyeiIvPjwvc3ZnPg==
[License-url]: LICENSE
