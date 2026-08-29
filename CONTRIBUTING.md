# Contributing

Thanks for looking. Small, single-purpose changes get merged fastest.

## Setup

```bash
cargo fmt
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

The suite is offline. Nothing in it starts the HTTP server or opens a browser.

## Before you open a PR

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

CI runs the same set, plus a full-history secret scan and an ASCII punctuation
check.

## The rules that matter here

1. **Keep it simple, keep it safe.** Prefer the smallest change that satisfies
   the request. Do not add abstractions, dependencies, or config surface that
   are not needed now.
2. **Loopback only.** Bind stays on loopback. Edit/Save stays behind
   `writable = true`.
3. **ASCII hyphens only.** Use `-` in prose, code, UI copy and commits. No
   `U+2014` em dash, no `U+2013` en dash. CI enforces this.

## Tests

```bash
cargo test --locked
```

Test deterministic logic, config validation, scan/summary behaviour, and
fail-closed bind/write rules. Please do not add tests for trivial accessors.

`examples/md-html.toml` is the documented starter. If you add a config key,
update the example and the README sketch in the same change.

## Commits

Tag lines only. One tag per line - each `[TAG]` row starts on a new line.
Do not join multiple tags on a single line. No free-form body.

```
[ADD] Attach prebuilt binaries to the GitHub Release
[DOC] Document download-without-Rust install
```

Tags in use: `[ADD]` `[FIX]` `[CHG]` `[UPD]` `[DOC]` `[TST]` `[CFG]` `[RM]`.

## Reporting bugs

Include the `md-html.toml` (redact local paths you do not want public), the
command you ran, and what you expected instead. For security issues do not open
an issue - see [SECURITY.md](SECURITY.md).
