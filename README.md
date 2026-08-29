# Markdown HTML browser

A **local markdown browser** for any project: we all have too many markdown files!
This tool makes it easy to read your docs, specs and research in a simple local 
browser. AI loves md, its great at summarising too, but some people still HAVE to read 
it all, this is for them.

This tool adds a `md-html.toml` config file to any directory, then opens a noon or
midnight HTML index in a local browser - file tiles, summaries, modal reader, in-doc
history, and Mermaid when the CDN is reachable.

[![Status][Status-shield]][Status-url]
[![Docs][Docs-shield]][Docs-url]
[![License][License-shield]][License-url]

> `md-html` is a small host tool (single Rust binary). Point it at your docs; it
> does not depend on your project's runtime. Interfaces are intentionally small
> and may still tighten.

[![Pendulum][Pendulum-shield]][Pendulum-url]
[![Rust][Rust-shield]][Rust-url]
[![md][Md-shield]][Md-url]
[![html][Html-shield]][Html-url]

Mantra: **"keep it simple, keep it safe"**.

---

## What md-html is

- **Project-local config** - add a `md-html.toml` to any project or folder and 
define markdown file roots (e.g. `spec/`, `docs/`), title, port, and excludes.
- **Single binary** - download a release or `cargo install` once; add a single
config to any folder and run. No Node, no submodule, no generated assets.
- **Browseable index** - noon or midnight UI (IBM Plex + parchment), tile
summaries, filter search, list or swimlane map in the header, full-screen
modal, browser history stack. Viewed/read marks persist in cookies; Reset
clears them. Serve mode live-reloads when docs change (polls a cheap
revision stamp; and checks when the tab regains focus).
- **Honest links** - relative `.md` links resolve across roots via
project-relative paths; nested `index.html` sites open in a new tab.
- **Safe by default** - loopback bind only; edit/save is opt-in (`writable`).
- **Mermaid when available** - fenced diagrams lazy-load from CDN; offline
falls back to source.

---

## Documentation

| I am a...                  | Start at                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- |
| **Hyper md file consumer** | [Getting started](#getting-started) + `[examples/md-html.toml](examples/md-html.toml)` |
| **Tool maintainer**        | [Repository layout](#repository-layout) + [Develop](#develop)                          |
| **Contributor**            | [CONTRIBUTING.md](CONTRIBUTING.md)                                                     |
| **Security report**        | [SECURITY.md](SECURITY.md)                                                             |

### Repository layout

```
src/        # Rust CLI: config, scan, localhost server
viewer/     # Embedded HTML / CSS / JS (noon theme + MD renderer)
examples/   # Annotated md-html.toml
```

---

## Getting started

**Supported environments:** macOS 13+ (Apple Silicon and Intel) is the primary
target. Linux is best-effort. On Windows, use WSL2.

### Install

Download the archive for your OS and CPU from the
[latest GitHub Release](https://github.com/pendulumdev/pend-tool-md-html/releases/latest):


| Platform            | Archive                                             |
| ------------------- | --------------------------------------------------- |
| macOS Apple Silicon | `md-html-<version>-aarch64-apple-darwin.tar.gz`     |
| macOS Intel         | `md-html-<version>-x86_64-apple-darwin.tar.gz`      |
| Linux x86_64        | `md-html-<version>-x86_64-unknown-linux-gnu.tar.gz` |


```bash
tar -xzf md-html-*-<target>.tar.gz
chmod +x md-html
# move onto your PATH, e.g. ~/bin or /usr/local/bin
mv md-html ~/bin/
```

The binary is named `md-html`. macOS may quarantine an unsigned download:
right-click Open, or allow via terminal `xattr -d com.apple.quarantine md-html`.

### Install (via Rust toolchain)

```bash
cargo install --git https://github.com/pendulumdev/pend-tool-md-html --locked
```

---

## Use in a project

From your projects root directory:

```bash
md-html init          # prompts for title, description, port, writable, roots; then offers serve
md-html serve         # http://127.0.0.1:4173/  (if you skipped serve at init)
```

Add to a projects Makefile target:

```makefile
docs-view: ## reads md-html.toml and serves local browser
	md-html serve
```

### Config sketch

You can create your `md-html.toml` file yourself using the template:
See `[examples/md-html.toml](examples/md-html.toml)`.

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

# Optional. Defaults shown. Raise only if you accept the memory cost.
# max_indexed_files = 4000
# max_walk_entries = 100000
# max_file_bytes = 2097152   # 2 MiB
```

### Commands

| Command         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `md-html init`  | Write `md-html.toml` (prompts on a TTY)                   |
| `md-html serve` | Scan roots and serve the viewer                           |
| `md-html build` | Static snapshot under `md-html-out/` (embedded `data.js`) |


Flags: `--config PATH`, `--port N`, `--bind ADDR`, `--no-open`, `build --out DIR`.

### What to expect

After `md-html serve` in a configured repo:

1. Home lists every expected root section with tile summaries.
2. Opening a file shows rendered markdown; Esc closes; ← walks history.
3. An in-doc link to another `.md` opens in the modal (including across roots).
4. A ````mermaid` fence renders a diagram when online.
5. With `writable = false`, Edit is hidden; with `true`, **Save persists to disk**.
6. Opening a file marks it viewed. The circle on a tile (or Mark read in the
   modal) toggles read/unread. Reset in the header clears those marks.
7. Map view: hover a card to highlight related files; the pin on hover (or
   Tab to a card) holds that highlight until you pin another card or clear it.
   Scroll pans; ⌃-wheel or the − control zooms out from the current 100% view.

### Large trees

The index opens every matching `.md` (first 12 KB of each for summaries). A few
hundred files is fine; thousands take longer to scan and to render in the
browser.

Caps stop a recursive root over a huge folder from exhausting memory. These
are the defaults; set the same keys in `md-html.toml` to raise or lower them.

| Cap | Key | Default | When it applies |
| --- | --- | ------- | --------------- |
| Indexed files | `max_indexed_files` | 4000 | `serve` / `build` tree |
| Walk entries | `max_walk_entries` | 100000 | directory walk (all files, not only `.md`) |
| Open / embed size | `max_file_bytes` | 2097152 (2 MiB) | one file in the reader or `build` |

If you hit a cap, narrow `[[roots]]`, keep vendor trees in `exclude`, set
`recursive = false` on a project-root listing, or raise the matching key.
A recursive root on `.` in a large repo is the usual way to trip this.

---

## Develop

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo run -- serve --config path/to/md-html.toml --no-open
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Versioning and tags

- Version source of truth: `Cargo.toml` (`md-html --version` via clap)
- Release = annotated git tag `vX.Y.Z` on `main`. CI builds the binaries and
creates the GitHub Release.

```bash
# After bumping Cargo.toml version and merging to main:
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --tags
```

Do not move or reuse a tag. If `vX.Y.Z` is already on the remote, bump
`Cargo.toml` and tag the next version.

---

## Contributing

Open issues and pull requests against
`[pendulumdev/pend-tool-md-html](https://github.com/pendulumdev/pend-tool-md-html)`.
Prefer small, single-purpose changes; keep the dependency surface tiny. See
[CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately via
[SECURITY.md](SECURITY.md).

## Contributors

md-html is designed and built with contributions from:

- **[Pendulum](https://pendulumdev.co.uk)** - lead development and maintenance.
- **[Devhalls](https://github.com/devhalls)** - primary author.

---

## License

**MIT** - full text in `[LICENSE](LICENSE)`.

---

<!-- Badge definitions (reference-style; for-the-badge, black) -->
[Pendulum-shield]: https://img.shields.io/badge/pendulum-000000?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmlld0JveD0iMCAwIDE2NSAxNjUiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50IiB4MT0iMCIgeTE9IjgzLjUiIHgyPSIxNjEuMzkiIHkyPSI4My41IiBncmFkaWVudFRyYW5zZm9ybT0idHJhbnNsYXRlKDAgMTY2KSBzY2FsZSgxIC0xKSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzMyYjdkNiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2Y0OTYzYyIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxNjUiIGhlaWdodD0iMTY1IiBzdHlsZT0iZmlsbDp1cmwoI2xpbmVhci1ncmFkaWVudCk7Ii8+PHBhdGggZD0iTTU0LjA4LDEzM2gtMjUuOThWMzMuMDNoNDEuMzZjMTEuMjIsMCwxOS44MiwyLjkyLDI1Ljc4LDguNzVzOC45NSwxNC4wNSw4Ljk1LDI0LjY2LTIuOTgsMTguODMtOC45NSwyNC42NmMtNS45Niw1LjgzLTE0LjU2LDguNzUtMjUuNzgsOC43NWgtMTUuMzhzMCwzMy4xNSwwLDMzLjE1Wk01NC4wOCw3OC45aDguNjJjOS41NCwwLDE0LjMyLTQuMTUsMTQuMzItMTIuNDZzLTQuNzctMTIuNDYtMTQuMzItMTIuNDZoLTguNjJ2MjQuOTNoMFpNMTQzLjEsMzNsLTI2LjExLDEwMGgtMjVsMjYuMTEtMTAwaDI1WiIgc3R5bGU9ImZpbGw6I2ZmZjsiLz48L3N2Zz4=
[Pendulum-url]: https://pendulumdev.co.uk/
[Status-shield]: https://img.shields.io/badge/status-stable--local-000000?style=for-the-badge
[Status-url]: README.md
[Rust-shield]: https://img.shields.io/badge/rust-000000?style=for-the-badge&logo=rust
[Rust-url]: https://www.rust-lang.org/
[Md-shield]: https://img.shields.io/badge/md-000000?style=for-the-badge&logo=markdown
[Md-url]: https://daringfireball.net/projects/markdown/
[Html-shield]: https://img.shields.io/badge/html-000000?style=for-the-badge&logo=html5
[Html-url]: https://html.spec.whatwg.org/
[Docs-shield]: https://img.shields.io/badge/docs-000000?style=for-the-badge&logo=readthedocs
[Docs-url]: README.md
[License-shield]: https://img.shields.io/badge/license-MIT-000000?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xNiAybDEyIDQuNXY5YzAgOC4yLTUuMSAxNC4xLTEyIDE2LjhDOS4xIDI5LjYgNCAyMy43IDQgMTUuNXYtOUwxNiAyeiIvPjwvc3ZnPg==
[License-url]: LICENSE
