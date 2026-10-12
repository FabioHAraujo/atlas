//! SSH port-forward lifecycle.
//!
//! One `ssh -N -L local:remote_host:remote_port ssh_host` child owned by the
//! `ServiceManager`. The manager drives it from its 1s health tick (`tick`) and
//! on demand (`ensure_up`, used by `open_tunnel: true` actions). Nothing here
//! ever kills by port or by `pkill` pattern: only the pid we spawned, or a
//! pid recorded in `.logs/.tunnel.pid` that is verified to still be an `ssh`
//! forwarding the same port.

mod handle;
mod plan;
mod supervisor;

pub use handle::TunnelHandle;
pub use plan::{
    PidRecord, is_ssh_name, next_backoff, read_pid_record, should_reconnect_on_net_change,
    should_reuse, ssh_args, ssh_bin,
};
pub use supervisor::Tunnel;

use crate::runtime::service::ServiceState;

/// Name of the tunnel's log stream / tab / disk log (`.logs/tunnel.log`).
pub const LOG_NAME: &str = "tunnel";
/// Alert + event source name for tunnel failures.
pub const ALERT_NAME: &str = "tunnel";
/// Pid record of a tunnel intentionally left running on exit.
pub const PID_FILE: &str = ".tunnel.pid";
/// Env var overriding the ssh binary (tests only — see docs/runtime.md).
pub const SSH_BIN_ENV: &str = "ATLAS_SSH_BIN";

/// Snapshot published to the status file / MCP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelStatus {
    pub state: ServiceState,
    pub local_port: u16,
    pub remote: String,
    pub ssh_host: String,
}
