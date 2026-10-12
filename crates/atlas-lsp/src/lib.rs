//! Language-server layer behind `atlas hostd`.
//!
//! - [`registry`]: server table (id, install method, root markers) and root detection.
//! - [`install`]: PATH lookup, verified downloads into `~/.atlas/lsp/<server>/<version>/`.
//! - [`framing`] / [`rpc`]: LSP base protocol and a JSON-RPC peer (correlation, cancel,
//!   server→client requests).
//! - [`server`]: one server process (setsid, stderr log, `initialize`) and its handler.
//! - [`manager`]: sharing per (server, root), refcount, idle shutdown, crash restart.
//!
//! LSP processes are not handed over on a hostd `upgrade`: they are killed with the old
//! daemon and clients re-send `lsp_open` for every open document after reconnecting.

pub mod caps;
pub mod framing;
pub mod install;
pub mod manager;
pub mod registry;
pub mod rpc;
pub mod server;
pub mod text;

pub use manager::{Config, Manager, OpenReply, Push, ServerStatus, State};
