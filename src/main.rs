//! `md-html` — browse project markdown via a local HTML viewer.
//!
//! See the repository README and `examples/md-html.toml`.

mod config;
mod error;
mod scan;
mod server;

use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use crate::config::{default_init_toml, Config, CONFIG_FILE_NAME};
use crate::error::MdHtmlError;

#[derive(Parser, Debug)]
#[command(
    name = "md-html",
    version,
    about = "Browse project markdown as local HTML"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Write a starter `md-html.toml` in the current directory
    Init {
        /// Fail if the config already exists (default: refuse to overwrite)
        #[arg(long)]
        force: bool,
    },
    /// Scan configured roots and serve the viewer on localhost
    Serve {
        /// Path to config (default: ./md-html.toml)
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
        /// Override listen port
        #[arg(long, short = 'p')]
        port: Option<u16>,
        /// Do not open a browser
        #[arg(long)]
        no_open: bool,
        /// Override bind address (must be loopback)
        #[arg(long)]
        bind: Option<String>,
    },
    /// Write a static snapshot under `md-html-out/` (or `--out`)
    Build {
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
        #[arg(long, short = 'o', default_value = "md-html-out")]
        out: PathBuf,
    },
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), MdHtmlError> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Init { force } => cmd_init(force),
        Commands::Serve {
            config,
            port,
            no_open,
            bind,
        } => cmd_serve(config, port, no_open, bind),
        Commands::Build { config, out } => cmd_build(config, out),
    }
}

fn cmd_init(force: bool) -> Result<(), MdHtmlError> {
    let path = PathBuf::from(CONFIG_FILE_NAME);
    if path.exists() && !force {
        return Err(MdHtmlError::ConfigExists(path));
    }
    fs::write(&path, default_init_toml()).map_err(|source| MdHtmlError::Io {
        path: path.clone(),
        source,
    })?;
    eprintln!("wrote {CONFIG_FILE_NAME}");
    Ok(())
}

fn find_config(explicit: Option<PathBuf>) -> Result<PathBuf, MdHtmlError> {
    if let Some(p) = explicit {
        return Ok(p);
    }
    let cwd = std::env::current_dir().map_err(|source| MdHtmlError::Io {
        path: PathBuf::from("."),
        source,
    })?;
    let path = cwd.join(CONFIG_FILE_NAME);
    if path.is_file() {
        return Ok(path);
    }
    Err(MdHtmlError::ConfigNotFound(path))
}

fn cmd_serve(
    config: Option<PathBuf>,
    port: Option<u16>,
    no_open: bool,
    bind: Option<String>,
) -> Result<(), MdHtmlError> {
    let path = find_config(config)?;
    let mut cfg = Config::load(&path)?;
    if let Some(p) = port {
        cfg.port = p;
    }
    if let Some(b) = bind {
        cfg.bind = b;
        // re-validate loopback
        let ip: std::net::IpAddr = cfg
            .bind
            .parse()
            .map_err(|_| MdHtmlError::Config(format!("invalid bind address: {}", cfg.bind)))?;
        if !ip.is_loopback() {
            return Err(MdHtmlError::NonLoopbackBind(cfg.bind));
        }
    }
    if no_open {
        cfg.open_browser = false;
    }
    server::serve(cfg)
}

fn cmd_build(config: Option<PathBuf>, out: PathBuf) -> Result<(), MdHtmlError> {
    let path = find_config(config)?;
    let cfg = Config::load(&path)?;
    server::build(&cfg, &out)
}
