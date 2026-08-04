# pend-md-html (`md-html`)

Small, local markdown browser for any project. Point it at one or more directories via
`md-html.toml`, then open a noon-themed HTML index in the browser — file tiles,
summaries, modal reader, in-doc history, and Mermaid when the CDN is reachable.

Visual and markdown rendering are ported from the Patch documents viewer; the
deployment model is project-local config + a single Rust binary (no Node, no
folder picker).

## Install

```bash
cargo install --git https://github.com/devhalls/pend-md-html --locked
```

Requires a Rust toolchain. The binary is named `md-html`.

## Use in a project

1. From the project root:

   ```bash
   md-html init          # writes md-html.toml (refuses to overwrite)
   # edit roots / title / description
   md-html serve         # http://127.0.0.1:4173/  (opens browser by default)
   ```

2. Or add a Make target:

   ```makefile
   docs-view: ## Browse markdown docs in the browser (requires md-html)
   	md-html serve
   ```

Nothing is committed except `md-html.toml`. No submodule, no generated assets.

### Config sketch

```toml
title = "Corten"
description = "Specs, engineering handbook, research, and review pack."
port = 4173
bind = "127.0.0.1"       # loopback only (enforced)
writable = false         # set true to enable Edit/Save in the UI
open_browser = true

[[roots]]
path = "spec"
label = "Spec"

[[roots]]
path = "docs"
label = "Docs"

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

## Features

- Multi-root scan with labels, excludes, and optional non-recursive roots
- Patch-style noon UI (IBM Plex + parchment), tile summaries, filter search
- Full-screen modal, browser back stack, `#RootLabel/path.md:anchor` deep links
- Relative `.md` links resolve across roots via project-relative paths
- Nested `index.html` listed as **site ↗** (serve mode)
- Optional edit/save when `writable = true` (still localhost-only)
- Mermaid fences: lazy-load from jsDelivr; offline fallback shows source

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
cargo run -- serve --config examples/md-html.toml --no-open   # needs real roots
```

## License

MIT — see [LICENSE](LICENSE).
