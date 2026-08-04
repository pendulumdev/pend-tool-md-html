//! Walk configured roots and collect markdown / nested HTML site entries.

use std::fs;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Serialize;
use walkdir::WalkDir;

use crate::config::{Config, ResolvedRoot};
use crate::error::{MdHtmlError, Result};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Md,
    Html,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub root: String,
    /// Path relative to the configured root.
    pub path: String,
    /// Path relative to the project root (for cross-root link resolution).
    pub project_path: String,
    pub name: String,
    pub dir: String,
    pub kind: FileKind,
    pub summary: String,
    /// Project-relative `.md` targets linked from this file (map edges).
    #[serde(default)]
    pub links: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeResponse {
    pub files: Vec<FileEntry>,
}

pub fn scan(config: &Config) -> Result<TreeResponse> {
    let exclude = build_exclude_set(&config.exclude)?;
    let mut files = Vec::new();

    for root in &config.roots {
        scan_root(root, config.include_html_sites, &exclude, &mut files)?;
    }

    // Preserve [[roots]] declaration order; sort within each root by dir/name.
    let root_order: std::collections::HashMap<&str, usize> = config
        .roots
        .iter()
        .enumerate()
        .map(|(i, r)| (r.label.as_str(), i))
        .collect();
    files.sort_by(|a, b| {
        let ai = root_order.get(a.root.as_str()).copied().unwrap_or(usize::MAX);
        let bi = root_order.get(b.root.as_str()).copied().unwrap_or(usize::MAX);
        ai.cmp(&bi)
            .then(a.dir.cmp(&b.dir))
            .then(a.name.cmp(&b.name))
    });

    Ok(TreeResponse { files })
}

fn build_exclude_set(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        let glob =
            Glob::new(p).map_err(|e| MdHtmlError::Config(format!("bad exclude `{p}`: {e}")))?;
        builder.add(glob);
    }
    builder
        .build()
        .map_err(|e| MdHtmlError::Config(format!("exclude set: {e}")))
}

fn scan_root(
    root: &ResolvedRoot,
    include_html: bool,
    exclude: &GlobSet,
    out: &mut Vec<FileEntry>,
) -> Result<()> {
    if !root.recursive {
        scan_flat(root, include_html, exclude, out)?;
        return Ok(());
    }

    let walker = WalkDir::new(&root.abs_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') {
                return false;
            }
            true
        });

    for entry in walker {
        let entry = entry.map_err(|e| MdHtmlError::Server(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let rel = match abs.strip_prefix(&root.abs_path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = path_to_slash(rel);
        if rel_str.is_empty() {
            continue;
        }
        if is_excluded(exclude, &root.rel_path, &rel_str) {
            continue;
        }
        if let Some(fe) = classify(root, &rel_str, include_html) {
            out.push(fe);
        }
    }
    Ok(())
}

fn scan_flat(
    root: &ResolvedRoot,
    include_html: bool,
    exclude: &GlobSet,
    out: &mut Vec<FileEntry>,
) -> Result<()> {
    let rd = fs::read_dir(&root.abs_path).map_err(|source| MdHtmlError::Io {
        path: root.abs_path.clone(),
        source,
    })?;
    for ent in rd {
        let ent = ent.map_err(|source| MdHtmlError::Io {
            path: root.abs_path.clone(),
            source,
        })?;
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        let rel_str = name.to_string();
        if is_excluded(exclude, &root.rel_path, &rel_str) {
            continue;
        }
        if let Some(fe) = classify(root, &rel_str, include_html) {
            // For flat root ".", skip listing a nested index.html at top (none expected).
            out.push(fe);
        }
    }
    Ok(())
}

fn is_excluded(exclude: &GlobSet, root_rel: &str, file_rel: &str) -> bool {
    // Match against project-relative path and root-relative path.
    let project_rel = if root_rel == "." {
        file_rel.to_string()
    } else {
        format!("{root_rel}/{file_rel}")
    };
    exclude.is_match(&project_rel) || exclude.is_match(file_rel)
}

fn classify(root: &ResolvedRoot, rel_str: &str, include_html: bool) -> Option<FileEntry> {
    let path = Path::new(rel_str);
    let name = path.file_name()?.to_string_lossy().to_string();
    let dir = path
        .parent()
        .map(path_to_slash)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "(root)".into());

    let kind = if name.eq_ignore_ascii_case("index.html") {
        if !include_html || dir == "(root)" {
            return None;
        }
        FileKind::Html
    } else if name.to_ascii_lowercase().ends_with(".md") {
        FileKind::Md
    } else {
        return None;
    };

    let path = rel_str.replace('\\', "/");
    let project_path = if root.rel_path == "." {
        path.clone()
    } else {
        format!("{}/{}", root.rel_path, path)
    };

    let abs = root.abs_path.join(rel_str);
    let (summary, links) = read_meta(&abs, &kind, &project_path);

    Some(FileEntry {
        root: root.label.clone(),
        path,
        project_path,
        name,
        dir,
        kind,
        summary,
        links,
    })
}

fn path_to_slash(p: &Path) -> String {
    p.iter()
        .map(|c| c.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn read_meta(path: &PathBuf, kind: &FileKind, project_path: &str) -> (String, Vec<String>) {
    let Ok(file) = fs::File::open(path) else {
        return (String::new(), Vec::new());
    };
    use std::io::Read;
    let mut buf = vec![0u8; 12288];
    let mut handle = file;
    let n = handle.read(&mut buf).unwrap_or(0);
    let text = String::from_utf8_lossy(&buf[..n]);
    match kind {
        FileKind::Html => (extract_html_summary(&text), Vec::new()),
        FileKind::Md => (
            extract_md_summary(&text),
            extract_md_links(&text, project_path),
        ),
    }
}

/// Resolve markdown link targets under `from_project_path` to project-relative paths.
/// Skips external URLs, anchors-only, and non-`.md` targets. Cap keeps the map light.
pub fn extract_md_links(text: &str, from_project_path: &str) -> Vec<String> {
    const MAX_LINKS: usize = 40;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && out.len() < MAX_LINKS {
        if bytes[i] != b'[' {
            i += 1;
            continue;
        }
        // Find matching ](
        let Some(close) = text[i + 1..].find(']') else {
            i += 1;
            continue;
        };
        let after = i + 1 + close + 1;
        if after >= bytes.len() || bytes[after] != b'(' {
            i += 1;
            continue;
        }
        let rest = &text[after + 1..];
        let end = rest
            .find([')', '"', '\'', ' ', '\n'])
            .unwrap_or(rest.len());
        let raw = rest[..end].trim();
        i = after + 1 + end;
        if let Some(resolved) = resolve_md_href(from_project_path, raw) {
            if seen.insert(resolved.clone()) {
                out.push(resolved);
            }
        }
    }
    out
}

fn resolve_md_href(from_project_path: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    if href.starts_with('#') {
        return None;
    }
    let lower = href.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with("ftp:")
        || lower.starts_with("data:")
        || lower.starts_with("javascript:")
    {
        return None;
    }
    let hash_at = href.find('#').unwrap_or(href.len());
    let mut target = href[..hash_at].trim().to_string();
    if target.is_empty() {
        return None;
    }
    if !target.to_ascii_lowercase().ends_with(".md") {
        return None;
    }
    if let Some(rest) = target.strip_prefix('/') {
        target = rest.to_string();
    } else {
        let from_dir = match from_project_path.rfind('/') {
            Some(i) => &from_project_path[..i],
            None => "",
        };
        target = if from_dir.is_empty() {
            target
        } else {
            format!("{from_dir}/{target}")
        };
    }
    let mut parts = Vec::new();
    for p in target.split('/') {
        if p.is_empty() || p == "." {
            continue;
        }
        if p == ".." {
            parts.pop();
            continue;
        }
        parts.push(p);
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// First useful paragraph / blockquote / metadata row.
pub fn extract_md_summary(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut i = 0usize;

    let skip_blank = |i: &mut usize, lines: &[&str]| {
        while *i < lines.len() && lines[*i].trim().is_empty() {
            *i += 1;
        }
    };

    skip_blank(&mut i, &lines);
    if lines.get(i).map(|l| l.trim() == "---").unwrap_or(false) {
        i += 1;
        while i < lines.len() && lines[i].trim() != "---" {
            i += 1;
        }
        if i < lines.len() {
            i += 1;
        }
    }
    skip_blank(&mut i, &lines);
    if lines.get(i).map(|l| l.starts_with("# ")).unwrap_or(false) {
        i += 1;
    }
    skip_blank(&mut i, &lines);

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if is_hr(trimmed) {
            i += 1;
            continue;
        }
        if trimmed.starts_with('#') {
            i += 1;
            continue;
        }

        if trimmed.contains('|')
            && (trimmed.starts_with('|')
                || lines
                    .get(i + 1)
                    .map(|n| looks_like_table_sep(n))
                    .unwrap_or(false))
        {
            let mut candidate = String::new();
            while i < lines.len() && !lines[i].trim().is_empty() && lines[i].contains('|') {
                let cells = split_row(lines[i]);
                if cells.len() >= 2
                    && matches!(
                        cells[0].to_ascii_lowercase().as_str(),
                        "kind"
                            | "description"
                            | "summary"
                            | "purpose"
                            | "scope"
                            | "about"
                            | "intent"
                    )
                {
                    candidate = cells[1..].join(" — ");
                }
                i += 1;
            }
            let cleaned = clean_inline(&candidate);
            if cleaned.len() >= 12 {
                return cleaned;
            }
            continue;
        }

        if is_list_item(line) {
            while i < lines.len() && !lines[i].trim().is_empty() {
                i += 1;
            }
            continue;
        }

        if trimmed.starts_with('>') {
            let mut body = String::new();
            while i < lines.len() && lines[i].trim().starts_with('>') {
                let part = lines[i].trim().trim_start_matches('>').trim_start();
                if !body.is_empty() {
                    body.push(' ');
                }
                body.push_str(part);
                i += 1;
            }
            let cleaned = clean_inline(&body);
            if cleaned.len() >= 12 {
                return cleaned;
            }
            continue;
        }

        if trimmed.starts_with("**") && trimmed.ends_with("**") {
            i += 1;
            continue;
        }

        let mut para = line.to_string();
        i += 1;
        while i < lines.len()
            && !lines[i].trim().is_empty()
            && !lines[i].starts_with('#')
            && !lines[i].trim().starts_with('>')
            && !is_hr(lines[i].trim())
            && !lines[i].contains('|')
        {
            para.push(' ');
            para.push_str(lines[i]);
            i += 1;
        }
        let cleaned = clean_inline(&para);
        if cleaned.len() >= 12 {
            return cleaned;
        }
    }
    String::new()
}

fn extract_html_summary(text: &str) -> String {
    if let Some(start) = text.to_ascii_lowercase().find("<title") {
        if let Some(gt) = text[start..].find('>') {
            let after = start + gt + 1;
            if let Some(end) = text[after..].to_ascii_lowercase().find("</title>") {
                return text[after..after + end]
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
            }
        }
    }
    // meta description — simple scan
    for part in text.split('<') {
        let lower = part.to_ascii_lowercase();
        if lower.starts_with("meta") && lower.contains("name=\"description\"")
            || lower.starts_with("meta") && lower.contains("name='description'")
        {
            if let Some(c) = part.split("content=\"").nth(1) {
                return c.split('"').next().unwrap_or("").trim().to_string();
            }
            if let Some(c) = part.split("content='").nth(1) {
                return c.split('\'').next().unwrap_or("").trim().to_string();
            }
        }
    }
    String::new()
}

fn clean_inline(s: &str) -> String {
    let mut out = s.to_string();
    // strip images, links, code, emphasis (approximate)
    while let Some(i) = out.find("![") {
        if let Some(j) = out[i..].find(')') {
            out.replace_range(i..i + j + 1, "");
        } else {
            break;
        }
    }
    // [text](url) -> text
    let mut result = String::new();
    let bytes = out.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(close) = out[i + 1..].find(']') {
                let text = &out[i + 1..i + 1 + close];
                let after = i + 1 + close + 1;
                if out.as_bytes().get(after) == Some(&b'(') {
                    if let Some(end) = out[after + 1..].find(')') {
                        result.push_str(text);
                        i = after + 1 + end + 1;
                        continue;
                    }
                }
            }
        }
        result.push(out.as_bytes()[i] as char);
        i += 1;
    }
    result = result.replace('`', "");
    result = result.replace("**", "");
    result = result.replace("~~", "");
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_row(r: &str) -> Vec<String> {
    let s = r.trim().trim_start_matches('|').trim_end_matches('|');
    s.split('|').map(|c| c.trim().to_string()).collect()
}

fn looks_like_table_sep(line: &str) -> bool {
    let t = line.trim();
    t.contains('-') && t.contains('|') || t.starts_with('|') && t.contains('-')
}

fn is_hr(trimmed: &str) -> bool {
    let chars: Vec<char> = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    chars.len() >= 3 && chars.iter().all(|c| matches!(c, '-' | '*' | '_'))
}

fn is_list_item(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("- ")
        || t.starts_with("* ")
        || t.starts_with("+ ")
        || t.chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && t.contains(". ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{default_exclude, Config, ConfigFile, RootConfig};
    use tempfile::tempdir;

    #[test]
    fn summary_skips_h1_and_takes_paragraph() {
        let s = extract_md_summary("# Title\n\nThis is a useful summary paragraph here.\n");
        assert!(s.contains("useful summary"));
    }

    #[test]
    fn extract_md_links_resolves_relative_and_skips_external() {
        let text = r#"
See [sibling](./other.md), [up](../spec/01.md#sec), [abs](/docs/a.md),
[site](https://example.com/x.md), [img](pic.png), and [self](#anchor).
"#;
        let links = extract_md_links(text, "docs/guide/intro.md");
        assert!(links.contains(&"docs/guide/other.md".into()));
        assert!(links.contains(&"docs/spec/01.md".into()));
        assert!(links.contains(&"docs/a.md".into()));
        assert!(!links.iter().any(|l| l.contains("example.com")));
        assert!(!links.iter().any(|l| l.ends_with("pic.png")));
        assert_eq!(links.len(), 3);
    }

    #[test]
    fn scan_preserves_root_declaration_order() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("zebra")).unwrap();
        fs::create_dir_all(dir.path().join("alpha")).unwrap();
        fs::write(
            dir.path().join("zebra/z.md"),
            "# Z\n\nZebra summary text ok.\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("alpha/a.md"),
            "# A\n\nAlpha summary text ok.\n",
        )
        .unwrap();

        let cfg = Config::from_file(
            ConfigFile {
                title: "T".into(),
                description: "D".into(),
                port: 4173,
                bind: "127.0.0.1".into(),
                writable: false,
                open_browser: false,
                roots: vec![
                    RootConfig {
                        path: "zebra".into(),
                        label: "Zebra".into(),
                        recursive: true,
                    },
                    RootConfig {
                        path: "alpha".into(),
                        label: "Alpha".into(),
                        recursive: true,
                    },
                ],
                exclude: default_exclude(),
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap();

        let tree = scan(&cfg).unwrap();
        assert_eq!(tree.files.len(), 2);
        assert_eq!(tree.files[0].root, "Zebra");
        assert_eq!(tree.files[1].root, "Alpha");
    }

    #[test]
    fn scan_respects_non_recursive() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("README.md"),
            "# Root\n\nRoot summary text ok.\n",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("docs")).unwrap();
        fs::write(
            dir.path().join("docs/a.md"),
            "# A\n\nNested should not appear.\n",
        )
        .unwrap();

        let cfg = Config::from_file(
            ConfigFile {
                title: "T".into(),
                description: "D".into(),
                port: 4173,
                bind: "127.0.0.1".into(),
                writable: false,
                open_browser: false,
                roots: vec![RootConfig {
                    path: ".".into(),
                    label: "Root".into(),
                    recursive: false,
                }],
                exclude: default_exclude(),
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap();

        let tree = scan(&cfg).unwrap();
        assert_eq!(tree.files.len(), 1);
        assert_eq!(tree.files[0].name, "README.md");
    }

    #[test]
    fn scan_skips_dot_dirs_and_excluded() {
        let dir = tempdir().unwrap();
        let docs = dir.path().join("docs");
        fs::create_dir_all(docs.join(".hidden")).unwrap();
        fs::write(docs.join("ok.md"), "# Ok\n\nVisible document summary.\n").unwrap();
        fs::write(docs.join(".hidden/no.md"), "# No\n").unwrap();
        fs::create_dir_all(docs.join("target")).unwrap();
        fs::write(docs.join("target/x.md"), "# X\n").unwrap();

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
                exclude: vec!["**/target/**".into()],
                include_html_sites: false,
            },
            dir.path(),
        )
        .unwrap();

        let tree = scan(&cfg).unwrap();
        assert_eq!(tree.files.len(), 1);
        assert_eq!(tree.files[0].path, "ok.md");
    }
}
