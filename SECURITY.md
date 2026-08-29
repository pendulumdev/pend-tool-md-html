# Security policy

## Reporting a vulnerability

Please do not open a public issue.

Report privately through
[GitHub Security Advisories](https://github.com/pendulumdev/pend-tool-md-html/security/advisories/new),
or email **security@pendulumdev.co.uk**.

Include what you did, what happened, and what you expected. A proof of concept
helps. We will acknowledge within 5 working days and aim to have a fix or a clear
plan within 30 days for anything we can reproduce.

Please do not test against systems you do not own.

## Supported versions

Only the latest tagged release is supported. Fixes land on `main` and go out in
the next tag.

## Known and accepted characteristics

These are documented properties of the tool, not vulnerabilities.

- **Bind is loopback only.** The server refuses a non-loopback address so local
  docs are not exposed on the LAN. That is enforced in config and on `--bind`.
- **Writes are opt-in.** Edit/Save in the UI is off unless `writable = true`.
  When it is on, Save writes the opened file on disk.
- **The config is trusted input.** Roots, excludes and `writable` are taken as
  the operator intended. Do not point `md-html` at a config you do not trust.
- **Mermaid loads from a CDN when online.** Fenced diagrams lazy-load from the
  public Mermaid CDN. Offline, the fence stays as source. No other remote code
  is fetched by the viewer.
- **Scan and file-size caps.** By default a recursive root will not index more
  than 4000 files, walk more than 100000 directory entries, or open a
  markdown file larger than 2 MiB. Operators can raise or lower these in
  `md-html.toml` (`max_indexed_files`, `max_walk_entries`, `max_file_bytes`).
  The config is trusted input.

Reports that consist only of one of the above, without a concrete escalation
beyond what is documented, will be closed with a pointer here.
