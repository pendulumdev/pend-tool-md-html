//! Typed errors for `md-html`. Fail closed; never panic outside tests.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MdHtmlError {
    #[error("config file not found: {0}")]
    ConfigNotFound(PathBuf),

    #[error("failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid config: {0}")]
    Config(String),

    #[error("root `{label}` path escapes project directory: {path}")]
    RootEscape { label: String, path: PathBuf },

    #[error("root `{label}` does not exist: {path}")]
    RootMissing { label: String, path: PathBuf },

    #[error("duplicate root label: {0}")]
    DuplicateLabel(String),

    #[error("bind address must be loopback (got `{0}`); refuse to expose writable/local docs")]
    NonLoopbackBind(String),

    #[error("path not found: {0}")]
    NotFound(String),

    #[error("path escapes configured root: {0}")]
    PathEscape(String),

    #[error("writes disabled (set writable = true in md-html.toml)")]
    WritesDisabled,

    #[error("server error: {0}")]
    Server(String),

    #[error("config already exists: {0}")]
    ConfigExists(PathBuf),
}

pub type Result<T> = std::result::Result<T, MdHtmlError>;
