//! Interactive `md-html init` prompts. Stdin only; no prompt crates.

use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use crate::error::{MdHtmlError, Result};

pub const DEFAULT_TITLE: &str = "Project";
pub const DEFAULT_DESCRIPTION: &str = "Project research...";
pub const DEFAULT_PORT: u16 = 4173;

const SKIP_DIR_NAMES: &[&str] = &["target", "node_modules"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitRoot {
    pub path: String,
    pub label: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitAnswers {
    pub title: String,
    pub description: String,
    pub port: u16,
    pub writable: bool,
    pub roots: Vec<InitRoot>,
}

pub fn is_interactive() -> bool {
    io::stdin().is_terminal()
}

/// Immediate child directories of `cwd`, sorted, skipping hidden names and
/// well-known exclude dirs (`target`, `node_modules`).
pub fn list_candidate_dirs(cwd: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let entries = fs::read_dir(cwd).map_err(|source| MdHtmlError::Io {
        path: cwd.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| MdHtmlError::Io {
            path: cwd.to_path_buf(),
            source,
        })?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if name.starts_with('.') || SKIP_DIR_NAMES.contains(&name.as_str()) {
            continue;
        }
        let file_type = entry.file_type().map_err(|source| MdHtmlError::Io {
            path: entry.path(),
            source,
        })?;
        if file_type.is_dir() {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

/// Parse space- or comma-separated numbers. `0` is `.` (non-recursive).
/// `1..n` map onto `dirs` (1-based). At least one selection required.
pub fn parse_selection(input: &str, dirs: &[String]) -> Result<Vec<InitRoot>> {
    let normalized = input.replace(',', " ");
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    if tokens.is_empty() {
        return Err(MdHtmlError::Config(
            "select at least one root (enter numbers from the list)".into(),
        ));
    }
    let mut roots = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for token in tokens {
        let n: usize = token
            .parse()
            .map_err(|_| MdHtmlError::Config(format!("not a number: {token}")))?;
        let root = root_for_index(n, dirs)?;
        if seen.insert(root.path.clone()) {
            roots.push(root);
        }
    }
    Ok(roots)
}

pub fn format_init_toml(
    title: &str,
    description: &str,
    port: u16,
    writable: bool,
    roots: &[InitRoot],
) -> String {
    let mut out = String::from(
        "# md-html - local markdown browser\n\
         # https://github.com/pendulumdev/pend-tool-md-html\n\
         \n",
    );
    out.push_str(&format!("title = {}\n", toml_string(title)));
    out.push_str(&format!("description = {}\n", toml_string(description)));
    out.push_str(&format!("port = {port}\n"));
    out.push_str(&format!(
        "bind = \"127.0.0.1\"\n\
         writable = {writable}\n\
         open_browser = true\n\
         include_html_sites = true\n\
         \n\
         exclude = [\"**/target/**\", \"**/.git/**\", \"**/node_modules/**\"]\n\
         \n\
         # Optional scan caps (defaults shown). Raise only if you accept the memory cost.\n\
         # max_indexed_files = 4000\n\
         # max_walk_entries = 100000\n\
         # max_file_bytes = 2097152\n"
    ));
    for root in roots {
        out.push_str("\n[[roots]]\n");
        out.push_str(&format!("path = {}\n", toml_string(&root.path)));
        out.push_str(&format!("label = {}\n", toml_string(&root.label)));
        if !root.recursive {
            out.push_str("recursive = false\n");
        }
    }
    out
}

pub fn prompt_init() -> Result<InitAnswers> {
    let cwd = std::env::current_dir().map_err(|source| MdHtmlError::Io {
        path: PathBuf::from("."),
        source,
    })?;
    let style = Style::new();
    print_banner(&style);

    let title = prompt_value(&style, "Title", DEFAULT_TITLE)?;
    let description = prompt_value(&style, "Description", DEFAULT_DESCRIPTION)?;
    let port = prompt_port(&style)?;
    let writable = prompt_yes(&style, "Writable (Edit/Save)", false)?;

    let dirs = list_candidate_dirs(&cwd)?;
    eprintln!("{}", style.rule());
    eprintln!(
        "{} {}",
        style.question("Roots"),
        style.hint("(space-separated numbers)")
    );
    eprintln!(
        "{}",
        style.hint("  0. .  (this directory, top-level md only)")
    );
    for (i, name) in dirs.iter().enumerate() {
        eprintln!("{}", style.hint(&format!("  {}. {name}", i + 1)));
    }
    let roots = loop {
        eprint!("{} ", style.hint(">"));
        let _ = io::stderr().flush();
        let input = read_raw()?;
        match parse_selection(&input, &dirs) {
            Ok(roots) => {
                let summary = roots
                    .iter()
                    .map(|r| r.path.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                eprintln!("{}", style.answer(&format!("  {summary}")));
                break roots;
            }
            Err(e) => eprintln!("{}", style.warn(&e.to_string())),
        }
    };
    Ok(InitAnswers {
        title,
        description,
        port,
        writable,
        roots,
    })
}

pub fn prompt_serve() -> Result<bool> {
    prompt_yes(&Style::new(), "Serve now?", true)
}

pub fn print_wrote(name: &str) {
    let style = Style::new();
    eprintln!("{}", style.rule());
    eprintln!("{}", style.answer(&format!("wrote {name}")));
}

fn root_for_index(n: usize, dirs: &[String]) -> Result<InitRoot> {
    if n == 0 {
        return Ok(InitRoot {
            path: ".".into(),
            label: "Root".into(),
            recursive: false,
        });
    }
    let dir = dirs
        .get(n - 1)
        .ok_or_else(|| MdHtmlError::Config(format!("no directory numbered {n}")))?;
    Ok(InitRoot {
        path: dir.clone(),
        label: label_for(dir),
        recursive: true,
    })
}

fn label_for(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) => {
            let mut s: String = c.to_uppercase().collect();
            s.extend(chars);
            s
        }
        None => name.to_string(),
    }
}

fn toml_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

struct Style {
    on: bool,
}

impl Style {
    fn new() -> Self {
        Self {
            on: io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none(),
        }
    }

    fn paint(&self, code: &str, s: &str) -> String {
        if self.on {
            format!("\x1b[{code}m{s}\x1b[0m")
        } else {
            s.to_string()
        }
    }

    fn question(&self, s: &str) -> String {
        self.paint("1;36", s)
    }
    fn hint(&self, s: &str) -> String {
        self.paint("2", s)
    }
    fn answer(&self, s: &str) -> String {
        self.paint("32", s)
    }
    fn warn(&self, s: &str) -> String {
        self.paint("33", s)
    }
    fn rule(&self) -> String {
        self.paint("2", "+-------------------------------+")
    }
}

fn print_banner(style: &Style) {
    const INNER: usize = 31;
    let rule = format!("+{}+", "-".repeat(INNER));
    eprintln!();
    eprintln!("{}", style.paint("2", &rule));
    banner_row(style, INNER, "Pendulum Markdown Browser", "1;36");
    banner_row(style, INNER, "", "0");
    banner_row(style, INNER, "|", "2");
    banner_row(style, INNER, "(o)", "1;33");
    banner_row(style, INNER, "", "0");
    banner_row(style, INNER, "md-html", "2");
    eprintln!("{}", style.paint("2", &rule));
    eprintln!();
}

fn banner_row(style: &Style, width: usize, text: &str, code: &str) {
    let n = text.chars().count();
    let pad = width.saturating_sub(n);
    let left = pad / 2;
    let right = pad - left;
    let mid = if text.is_empty() {
        String::new()
    } else {
        style.paint(code, text)
    };
    eprintln!(
        "{}{}{}{}{}",
        style.paint("2", "|"),
        " ".repeat(left),
        mid,
        " ".repeat(right),
        style.paint("2", "|")
    );
}

fn prompt_value(style: &Style, label: &str, default: &str) -> Result<String> {
    eprintln!("{}", style.rule());
    eprintln!(
        "{} {}",
        style.question(label),
        style.hint(&format!("[{default}]"))
    );
    eprint!("{} ", style.hint(">"));
    let _ = io::stderr().flush();
    let input = read_raw()?;
    let value = if input.is_empty() {
        default.to_string()
    } else {
        input
    };
    eprintln!("{}", style.answer(&format!("  {value}")));
    Ok(value)
}

fn prompt_port(style: &Style) -> Result<u16> {
    loop {
        eprintln!("{}", style.rule());
        eprintln!(
            "{} {}",
            style.question("Port"),
            style.hint(&format!("[{DEFAULT_PORT}]"))
        );
        eprint!("{} ", style.hint(">"));
        let _ = io::stderr().flush();
        let input = read_raw()?;
        let raw = if input.is_empty() {
            DEFAULT_PORT.to_string()
        } else {
            input
        };
        match raw.parse::<u16>() {
            Ok(port) if port != 0 => {
                eprintln!("{}", style.answer(&format!("  {port}")));
                return Ok(port);
            }
            _ => eprintln!("{}", style.warn("port must be 1-65535")),
        }
    }
}

fn prompt_yes(style: &Style, label: &str, default_yes: bool) -> Result<bool> {
    let hint = if default_yes { "[Y/n]" } else { "[y/N]" };
    eprintln!("{}", style.rule());
    eprintln!("{} {}", style.question(label), style.hint(hint));
    eprint!("{} ", style.hint(">"));
    let _ = io::stderr().flush();
    let input = read_raw()?;
    let yes = if input.is_empty() {
        default_yes
    } else if input.eq_ignore_ascii_case("n") || input.eq_ignore_ascii_case("no") {
        false
    } else if input.eq_ignore_ascii_case("y") || input.eq_ignore_ascii_case("yes") {
        true
    } else {
        default_yes
    };
    eprintln!(
        "{}",
        style.answer(&format!("  {}", if yes { "yes" } else { "no" }))
    );
    Ok(yes)
}

fn read_raw() -> Result<String> {
    let mut buf = String::new();
    io::stdin()
        .read_line(&mut buf)
        .map_err(|source| MdHtmlError::Io {
            path: PathBuf::from("<stdin>"),
            source,
        })?;
    Ok(buf.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, CONFIG_FILE_NAME};
    use std::fs;
    use tempfile::tempdir;

    fn sample_dirs() -> Vec<String> {
        vec!["docs".into(), "spec".into(), "src".into()]
    }

    #[test]
    fn lists_child_dirs_and_skips_exclude_and_hidden() {
        let dir = tempdir().unwrap();
        for name in ["docs", "spec", "target", "node_modules"] {
            fs::create_dir(dir.path().join(name)).unwrap();
        }
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join("README.md"), "x").unwrap();

        let names = list_candidate_dirs(dir.path()).unwrap();
        assert_eq!(names, vec!["docs", "spec"]);
    }

    #[test]
    fn parse_space_and_comma_selection() {
        let dirs = sample_dirs();
        let a = parse_selection("1 3", &dirs).unwrap();
        let b = parse_selection("1,3", &dirs).unwrap();
        assert_eq!(a, b);
        assert_eq!(
            a,
            vec![
                InitRoot {
                    path: "docs".into(),
                    label: "Docs".into(),
                    recursive: true,
                },
                InitRoot {
                    path: "src".into(),
                    label: "Src".into(),
                    recursive: true,
                },
            ]
        );
    }

    #[test]
    fn parse_zero_is_project_root() {
        let roots = parse_selection("0", &sample_dirs()).unwrap();
        assert_eq!(
            roots,
            vec![InitRoot {
                path: ".".into(),
                label: "Root".into(),
                recursive: false,
            }]
        );
    }

    #[test]
    fn parse_empty_and_out_of_range_fail() {
        let dirs = sample_dirs();
        assert!(parse_selection("", &dirs).is_err());
        assert!(parse_selection("9", &dirs).is_err());
        assert!(parse_selection("foo", &dirs).is_err());
    }

    #[test]
    fn format_init_toml_loads() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        let body = format_init_toml(
            "My \"docs\"",
            "A description",
            8080,
            true,
            &[
                InitRoot {
                    path: "docs".into(),
                    label: "Docs".into(),
                    recursive: true,
                },
                InitRoot {
                    path: ".".into(),
                    label: "Root".into(),
                    recursive: false,
                },
            ],
        );
        let path = dir.path().join(CONFIG_FILE_NAME);
        fs::write(&path, &body).unwrap();
        let cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.title, "My \"docs\"");
        assert_eq!(cfg.description, "A description");
        assert_eq!(cfg.port, 8080);
        assert!(cfg.writable);
        assert_eq!(cfg.roots.len(), 2);
        assert_eq!(cfg.roots[0].rel_path, "docs");
        assert!(cfg.roots[0].recursive);
        assert_eq!(cfg.roots[1].rel_path, ".");
        assert!(!cfg.roots[1].recursive);
        assert_eq!(
            cfg.max_indexed_files,
            crate::config::DEFAULT_MAX_INDEXED_FILES
        );
        assert_eq!(
            cfg.max_walk_entries,
            crate::config::DEFAULT_MAX_WALK_ENTRIES
        );
        assert_eq!(cfg.max_file_bytes, crate::config::DEFAULT_MAX_FILE_BYTES);
    }
}
