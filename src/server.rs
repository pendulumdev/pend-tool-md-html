//! Localhost HTTP server: embedded viewer + JSON/file API.

use std::fs;
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;

use serde::Serialize;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::config::{resolve_under_root, Config};
use crate::error::{MdHtmlError, Result};
use crate::scan::{revision, scan};

const INDEX_HTML: &str = include_str!("../viewer/index.html");
const STYLES_CSS: &str = include_str!("../viewer/styles.css");
const APP_JS: &str = include_str!("../viewer/app.js");
const MAP_JS: &str = include_str!("../viewer/map.js");
const MD_JS: &str = include_str!("../viewer/md.js");

#[derive(Serialize)]
struct MetaResponse<'a> {
    title: &'a str,
    description: &'a str,
    writable: bool,
    roots: Vec<MetaRoot<'a>>,
}

#[derive(Serialize)]
struct MetaRoot<'a> {
    label: &'a str,
    path: &'a str,
}

struct AppState {
    config: Config,
}

pub fn serve(config: Config) -> Result<()> {
    let addr: SocketAddr = format!("{}:{}", config.bind, config.port)
        .parse()
        .map_err(|e| MdHtmlError::Server(format!("bad listen address: {e}")))?;

    let server = Server::http(addr).map_err(|e| MdHtmlError::Server(e.to_string()))?;
    let url = format!("http://{}:{}/", config.bind, config.port);
    eprintln!("md-html serving {url}");
    eprintln!("  project: {}", config.project_root.display());
    for r in &config.roots {
        eprintln!("  root [{}]: {}", r.label, r.abs_path.display());
    }

    if config.open_browser {
        let _ = open_browser(&url);
    }

    let state = Arc::new(AppState { config });

    for request in server.incoming_requests() {
        handle_request(request, &state);
    }
    Ok(())
}

fn handle_request(request: Request, state: &AppState) {
    let url = request.url().to_string();
    let (path, query) = split_url(&url);
    let method = request.method().clone();

    let outcome = dispatch(request, state, method, path, query);
    if let Err(msg) = outcome {
        eprintln!("request error: {msg}");
    }
}

fn dispatch(
    mut request: Request,
    state: &AppState,
    method: Method,
    path: &str,
    query: &str,
) -> std::result::Result<(), String> {
    match (method, path) {
        (Method::Get, "/") | (Method::Get, "/index.html") => {
            respond_html(request, INDEX_HTML).map_err(|e| e.to_string())
        }
        (Method::Get, "/styles.css") => {
            respond(request, "text/css; charset=utf-8", STYLES_CSS.as_bytes())
                .map_err(|e| e.to_string())
        }
        (Method::Get, "/app.js") => respond(
            request,
            "application/javascript; charset=utf-8",
            APP_JS.as_bytes(),
        )
        .map_err(|e| e.to_string()),
        (Method::Get, "/map.js") => respond(
            request,
            "application/javascript; charset=utf-8",
            MAP_JS.as_bytes(),
        )
        .map_err(|e| e.to_string()),
        (Method::Get, "/md.js") => respond(
            request,
            "application/javascript; charset=utf-8",
            MD_JS.as_bytes(),
        )
        .map_err(|e| e.to_string()),
        (Method::Get, "/api/meta") => {
            let meta = MetaResponse {
                title: &state.config.title,
                description: &state.config.description,
                writable: state.config.writable,
                roots: state
                    .config
                    .roots
                    .iter()
                    .map(|r| MetaRoot {
                        label: &r.label,
                        path: &r.rel_path,
                    })
                    .collect(),
            };
            respond_json(request, &meta).map_err(|e| e.to_string())
        }
        (Method::Get, "/api/tree") => match scan(&state.config) {
            Ok(tree) => respond_json(request, &tree).map_err(|e| e.to_string()),
            Err(e) => respond_error(request, StatusCode(500), &e.to_string()),
        },
        (Method::Get, "/api/revision") => match revision(&state.config) {
            Ok(rev) => respond_json(request, &rev).map_err(|e| e.to_string()),
            Err(e) => respond_error(request, StatusCode(500), &e.to_string()),
        },
        (Method::Get, "/api/file") => match read_file_api(state, query) {
            Ok(text) => respond(request, "text/plain; charset=utf-8", text.as_bytes())
                .map_err(|e| e.to_string()),
            Err(e) => respond_status_err(request, e),
        },
        (Method::Put, "/api/file") => {
            if !state.config.writable {
                return respond_status_err(request, MdHtmlError::WritesDisabled);
            }
            let body = match std::io::read_to_string(request.as_reader()) {
                Ok(b) => b,
                Err(e) => {
                    return respond_error(request, StatusCode(400), &format!("read body: {e}"));
                }
            };
            match write_file_api(state, &body) {
                Ok(()) => respond_json(request, &serde_json::json!({ "ok": true }))
                    .map_err(|e| e.to_string()),
                Err(e) => respond_status_err(request, e),
            }
        }
        (Method::Get, p) if p.starts_with("/files/") => {
            match read_files_route(state, &p["/files/".len()..]) {
                Ok((ctype, bytes)) => respond(request, ctype, &bytes).map_err(|e| e.to_string()),
                Err(e) => respond_status_err(request, e),
            }
        }
        _ => respond_error(request, StatusCode(404), "not found"),
    }
}

fn read_file_api(state: &AppState, query: &str) -> Result<String> {
    let root_label = query_param(query, "root")
        .ok_or_else(|| MdHtmlError::Config("missing root query parameter".into()))?;
    let file_path = query_param(query, "path")
        .ok_or_else(|| MdHtmlError::Config("missing path query parameter".into()))?;
    let root = state
        .config
        .roots
        .iter()
        .find(|r| r.label == root_label)
        .ok_or(MdHtmlError::NotFound(root_label))?;
    let abs = resolve_under_root(root, &file_path)?;
    fs::read_to_string(&abs).map_err(|source| MdHtmlError::Io { path: abs, source })
}

fn write_file_api(state: &AppState, body: &str) -> Result<()> {
    let payload: PutFile = serde_json::from_str(body)
        .map_err(|e| MdHtmlError::Config(format!("invalid JSON body: {e}")))?;
    let root = state
        .config
        .roots
        .iter()
        .find(|r| r.label == payload.root)
        .ok_or_else(|| MdHtmlError::NotFound(payload.root.clone()))?;
    let abs = resolve_under_root(root, &payload.path)?;
    fs::write(&abs, payload.content.as_bytes())
        .map_err(|source| MdHtmlError::Io { path: abs, source })
}

fn read_files_route(state: &AppState, rest: &str) -> Result<(&'static str, Vec<u8>)> {
    let rest = percent_decode(rest);
    let mut parts = rest.splitn(2, '/');
    let root_label = parts.next().unwrap_or("");
    let rel = parts.next().unwrap_or("");
    if root_label.is_empty() || rel.is_empty() {
        return Err(MdHtmlError::NotFound(rest));
    }
    let root = state
        .config
        .roots
        .iter()
        .find(|r| r.label == root_label)
        .ok_or_else(|| MdHtmlError::NotFound(root_label.into()))?;
    let abs = resolve_under_root(root, rel)?;
    let bytes = fs::read(&abs).map_err(|source| MdHtmlError::Io {
        path: abs.clone(),
        source,
    })?;
    Ok((content_type_for(&abs), bytes))
}

fn respond_status_err(request: Request, err: MdHtmlError) -> std::result::Result<(), String> {
    let status = match &err {
        MdHtmlError::NotFound(_) | MdHtmlError::PathEscape(_) => StatusCode(404),
        MdHtmlError::WritesDisabled => StatusCode(403),
        _ => StatusCode(400),
    };
    respond_error(request, status, &err.to_string())
}

#[derive(serde::Deserialize)]
struct PutFile {
    root: String,
    path: String,
    content: String,
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn()?;
    }
    Ok(())
}

fn content_type_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn split_url(url: &str) -> (&str, &str) {
    match url.split_once('?') {
        Some((p, q)) => (p, q),
        None => (url, ""),
    }
}

fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if percent_decode(k) == key {
            return Some(percent_decode(v));
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(request: Request, content_type: &str, body: &[u8]) -> Result<()> {
    let header = Header::from_bytes("Content-Type", content_type)
        .map_err(|_| MdHtmlError::Server("bad content-type header".into()))?;
    let response = Response::from_data(body.to_vec()).with_header(header);
    request
        .respond(response)
        .map_err(|e| MdHtmlError::Server(e.to_string()))
}

fn respond_html(request: Request, body: &str) -> Result<()> {
    respond(request, "text/html; charset=utf-8", body.as_bytes())
}

fn respond_json<T: Serialize>(request: Request, value: &T) -> Result<()> {
    let body = serde_json::to_vec(value).map_err(|e| MdHtmlError::Server(e.to_string()))?;
    respond(request, "application/json; charset=utf-8", &body)
}

fn respond_error(
    request: Request,
    status: StatusCode,
    msg: &str,
) -> std::result::Result<(), String> {
    let body = serde_json::json!({ "error": msg }).to_string();
    let header = Header::from_bytes("Content-Type", "application/json; charset=utf-8")
        .map_err(|_| "bad header".to_string())?;
    let response = Response::new(
        status,
        vec![header],
        Cursor::new(body.into_bytes()),
        None,
        None,
    );
    request.respond(response).map_err(|e| e.to_string())
}

/// Static build: emit viewer + `data.js` with embedded tree and file bodies.
pub fn build(config: &Config, out_dir: &std::path::Path) -> Result<()> {
    fs::create_dir_all(out_dir).map_err(|source| MdHtmlError::Io {
        path: out_dir.to_path_buf(),
        source,
    })?;

    let tree = scan(config)?;
    let mut files_payload = Vec::new();
    for f in &tree.files {
        if f.kind != crate::scan::FileKind::Md {
            continue;
        }
        let root = config
            .roots
            .iter()
            .find(|r| r.label == f.root)
            .ok_or_else(|| MdHtmlError::NotFound(f.root.clone()))?;
        let abs = resolve_under_root(root, &f.path)?;
        let content =
            fs::read_to_string(&abs).map_err(|source| MdHtmlError::Io { path: abs, source })?;
        files_payload.push(serde_json::json!({
            "root": f.root,
            "path": f.path,
            "content": content,
        }));
    }

    let data = serde_json::json!({
        "meta": {
            "title": config.title,
            "description": config.description,
            "writable": false,
            "roots": config.roots.iter().map(|r| {
                serde_json::json!({ "label": r.label, "path": r.rel_path })
            }).collect::<Vec<_>>(),
            "static": true,
        },
        "tree": tree,
        "files": files_payload,
    });

    let data_js = format!("window.__MD_HTML_DATA__ = {};\n", data);
    write_out(out_dir, "data.js", data_js.as_bytes())?;
    write_out(out_dir, "styles.css", STYLES_CSS.as_bytes())?;
    write_out(out_dir, "md.js", MD_JS.as_bytes())?;
    write_out(out_dir, "map.js", MAP_JS.as_bytes())?;
    write_out(out_dir, "app.js", APP_JS.as_bytes())?;

    let index = INDEX_HTML
        .replace(
            r#"<script src="/md.js"></script>"#,
            r#"<script src="data.js"></script>
  <script src="md.js"></script>"#,
        )
        .replace(r#"src="/map.js""#, r#"src="map.js""#)
        .replace(
            r#"<script src="/app.js"></script>"#,
            r#"<script src="app.js"></script>"#,
        )
        .replace(r#"href="/styles.css""#, r#"href="styles.css""#);
    write_out(out_dir, "index.html", index.as_bytes())?;
    eprintln!("wrote static site to {}", out_dir.display());
    Ok(())
}

fn write_out(dir: &std::path::Path, name: &str, bytes: &[u8]) -> Result<()> {
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|source| MdHtmlError::Io { path, source })
}
