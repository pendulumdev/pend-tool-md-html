//! Typed `md-html.toml` load and validation.

use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{MdHtmlError, Result};

pub const CONFIG_FILE_NAME: &str = "md-html.toml";

pub const DEFAULT_EXCLUDE: &[&str] = &["**/target/**", "**/.git/**", "**/node_modules/**"];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigFile {
    pub title: String,
    pub description: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_bind")]
    pub bind: String,
    #[serde(default)]
    pub writable: bool,
    #[serde(default = "default_true")]
    pub open_browser: bool,
    pub roots: Vec<RootConfig>,
    #[serde(default = "default_exclude")]
    pub exclude: Vec<String>,
    #[serde(default = "default_true")]
    pub include_html_sites: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootConfig {
    /// Path relative to the project root (directory containing `md-html.toml`).
    pub path: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub recursive: bool,
}

fn default_port() -> u16 {
    4173
}
fn default_bind() -> String {
    "127.0.0.1".into()
}
fn default_true() -> bool {
    true
}
pub fn default_exclude() -> Vec<String> {
    DEFAULT_EXCLUDE.iter().map(|s| (*s).to_string()).collect()
}

/// Validated config plus absolute project root.
#[derive(Debug, Clone)]
pub struct Config {
    pub project_root: PathBuf,
    pub title: String,
    pub description: String,
    pub port: u16,
    pub bind: String,
    pub writable: bool,
    pub open_browser: bool,
    pub roots: Vec<ResolvedRoot>,
    pub exclude: Vec<String>,
    pub include_html_sites: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedRoot {
    pub label: String,
    /// Absolute canonical path to the root directory (or file parent for `.`).
    pub abs_path: PathBuf,
    /// Path as declared in config (relative, normalized with `/`).
    pub rel_path: String,
    pub recursive: bool,
}

impl Config {
    pub fn load(config_path: &Path) -> Result<Self> {
        if !config_path.is_file() {
            return Err(MdHtmlError::ConfigNotFound(config_path.to_path_buf()));
        }
        let text = fs::read_to_string(config_path).map_err(|source| MdHtmlError::Io {
            path: config_path.to_path_buf(),
            source,
        })?;
        let file: ConfigFile =
            toml::from_str(&text).map_err(|e| MdHtmlError::Config(e.to_string()))?;
        let project_root = config_path
            .parent()
            .ok_or_else(|| MdHtmlError::Config("config has no parent directory".into()))?
            .to_path_buf();
        Self::from_file(file, &project_root)
    }

    pub fn from_file(file: ConfigFile, project_root: &Path) -> Result<Self> {
        if file.roots.is_empty() {
            return Err(MdHtmlError::Config(
                "at least one [[roots]] entry is required".into(),
            ));
        }
        if file.port == 0 {
            return Err(MdHtmlError::Config("port must be non-zero".into()));
        }
        if file.title.trim().is_empty() {
            return Err(MdHtmlError::Config("title must not be empty".into()));
        }

        let bind_ip: IpAddr = file
            .bind
            .parse()
            .map_err(|_| MdHtmlError::Config(format!("invalid bind address: {}", file.bind)))?;
        if !bind_ip.is_loopback() {
            return Err(MdHtmlError::NonLoopbackBind(file.bind));
        }

        let project_root = fs::canonicalize(project_root).map_err(|source| MdHtmlError::Io {
            path: project_root.to_path_buf(),
            source,
        })?;

        let mut seen_labels = std::collections::HashSet::new();
        let mut roots = Vec::with_capacity(file.roots.len());

        for root in file.roots {
            let label = root.label.trim().to_string();
            if label.is_empty() {
                return Err(MdHtmlError::Config("root label must not be empty".into()));
            }
            if !seen_labels.insert(label.clone()) {
                return Err(MdHtmlError::DuplicateLabel(label));
            }

            let rel = normalize_rel(&root.path)?;
            let candidate = if rel.is_empty() || rel == "." {
                project_root.clone()
            } else {
                project_root.join(&rel)
            };

            let abs = fs::canonicalize(&candidate).map_err(|_| MdHtmlError::RootMissing {
                label: label.clone(),
                path: candidate.clone(),
            })?;

            if !abs.starts_with(&project_root) {
                return Err(MdHtmlError::RootEscape {
                    label: label.clone(),
                    path: abs,
                });
            }
            if !abs.is_dir() {
                return Err(MdHtmlError::RootMissing {
                    label: label.clone(),
                    path: abs,
                });
            }

            roots.push(ResolvedRoot {
                label,
                abs_path: abs,
                rel_path: if rel.is_empty() { ".".into() } else { rel },
                recursive: root.recursive,
            });
        }

        Ok(Config {
            project_root,
            title: file.title,
            description: file.description,
            port: file.port,
            bind: file.bind,
            writable: file.writable,
            open_browser: file.open_browser,
            roots,
            exclude: file.exclude,
            include_html_sites: file.include_html_sites,
        })
    }
}

/// Normalize a relative path: reject absolute and `..` segments.
pub fn normalize_rel(raw: &str) -> Result<String> {
    let raw = raw.replace('\\', "/");
    if raw.starts_with('/') || raw.contains(':') {
        return Err(MdHtmlError::Config(format!(
            "root path must be relative: {raw}"
        )));
    }
    let mut parts = Vec::new();
    for p in raw.split('/') {
        if p.is_empty() || p == "." {
            continue;
        }
        if p == ".." {
            return Err(MdHtmlError::Config(format!(
                "root path must not contain '..': {raw}"
            )));
        }
        parts.push(p);
    }
    Ok(parts.join("/"))
}

/// Resolve a root-relative file path under a resolved root. Fail closed on escape.
pub fn resolve_under_root(root: &ResolvedRoot, rel_file: &str) -> Result<PathBuf> {
    let rel = normalize_file_rel(rel_file)?;
    let candidate = if rel.is_empty() {
        root.abs_path.clone()
    } else {
        root.abs_path.join(&rel)
    };
    let abs = fs::canonicalize(&candidate).map_err(|_| MdHtmlError::NotFound(rel_file.into()))?;
    if !abs.starts_with(&root.abs_path) {
        return Err(MdHtmlError::PathEscape(rel_file.into()));
    }
    if !abs.is_file() {
        return Err(MdHtmlError::NotFound(rel_file.into()));
    }
    Ok(abs)
}

fn normalize_file_rel(raw: &str) -> Result<String> {
    let raw = raw.replace('\\', "/");
    if raw.starts_with('/') {
        return Err(MdHtmlError::PathEscape(raw));
    }
    let mut parts = Vec::new();
    for p in raw.split('/') {
        if p.is_empty() || p == "." {
            continue;
        }
        if p == ".." {
            return Err(MdHtmlError::PathEscape(raw.to_string()));
        }
        if p.starts_with('.') {
            return Err(MdHtmlError::PathEscape(raw.to_string()));
        }
        parts.push(p);
    }
    Ok(parts.join("/"))
}

pub fn default_init_toml() -> &'static str {
    r#"# md-html — local markdown browser
# https://github.com/pendulumdev/md-html

title = "Documents"
description = "Browsable index of project Markdown."
port = 4173
bind = "127.0.0.1"
writable = false
open_browser = true
include_html_sites = true

exclude = ["**/target/**", "**/.git/**", "**/node_modules/**"]

[[roots]]
path = "docs"
label = "Docs"

# [[roots]]
# path = "."
# label = "Root"
# recursive = false
"#
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_non_loopback_bind() {
        let dir = tempdir().unwrap();
        let file = ConfigFile {
            title: "T".into(),
            description: "D".into(),
            port: 4173,
            bind: "0.0.0.0".into(),
            writable: false,
            open_browser: false,
            roots: vec![RootConfig {
                path: ".".into(),
                label: "Root".into(),
                recursive: false,
            }],
            exclude: default_exclude(),
            include_html_sites: false,
        };
        let err = Config::from_file(file, dir.path()).unwrap_err();
        assert!(matches!(err, MdHtmlError::NonLoopbackBind(_)));
    }

    #[test]
    fn rejects_dotdot_root() {
        let err = normalize_rel("../secret").unwrap_err();
        assert!(matches!(err, MdHtmlError::Config(_)));
    }

    #[test]
    fn resolves_nested_file_under_root() {
        let dir = tempdir().unwrap();
        let docs = dir.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let md = docs.join("a.md");
        fs::write(&md, "# hi\n").unwrap();

        let cfg = Config::from_file(
            ConfigFile {
                title: "T".into(),
                description: "D".into(),
                port: 4173,
                bind: "127.0.0.1".into(),
                writable: false,
                open_browser: false,
                roots: vec![RootConfig {
                    path: "docs".into(),
                    label: "Docs".into(),
                    recursive: true,
                }],
                exclude: default_exclude(),
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap();

        let path = resolve_under_root(&cfg.roots[0], "a.md").unwrap();
        assert_eq!(path, fs::canonicalize(&md).unwrap());
    }

    #[test]
    fn rejects_escape_via_dotdot_in_file_path() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("secret.md"), "x").unwrap();
        let cfg = Config::from_file(
            ConfigFile {
                title: "T".into(),
                description: "D".into(),
                port: 4173,
                bind: "127.0.0.1".into(),
                writable: false,
                open_browser: false,
                roots: vec![RootConfig {
                    path: "docs".into(),
                    label: "Docs".into(),
                    recursive: true,
                }],
                exclude: default_exclude(),
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap();
        let err = resolve_under_root(&cfg.roots[0], "../secret.md").unwrap_err();
        assert!(matches!(err, MdHtmlError::PathEscape(_)));
    }

    #[test]
    fn duplicate_labels_fail() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a")).unwrap();
        fs::create_dir_all(dir.path().join("b")).unwrap();
        let err = Config::from_file(
            ConfigFile {
                title: "T".into(),
                description: "D".into(),
                port: 4173,
                bind: "127.0.0.1".into(),
                writable: false,
                open_browser: false,
                roots: vec![
                    RootConfig {
                        path: "a".into(),
                        label: "Same".into(),
                        recursive: true,
                    },
                    RootConfig {
                        path: "b".into(),
                        label: "Same".into(),
                        recursive: true,
                    },
                ],
                exclude: default_exclude(),
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap_err();
        assert!(matches!(err, MdHtmlError::DuplicateLabel(_)));
    }
}
