//! The background actor around `Tunnel`: all slow work (ssh spawn, readiness
//! wait, reconnect backoff) happens on its task.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::mpsc;

use super::{Tunnel, TunnelStatus};
use crate::config::TunnelConfig;
use crate::runtime::manager::ManagerEvent;

enum Cmd {
    /// Ensure the tunnel is up; answer with the failure reason on error.
    EnsureUp(tokio::sync::oneshot::Sender<Result<(), String>>),
    /// Stop supervising. `kill`: SIGTERM our ssh; else leave it + `.tunnel.pid`.
    Shutdown {
        kill: bool,
        done: tokio::sync::oneshot::Sender<()>,
    },
}

/// Handle to the tunnel task. All slow work (ssh spawn, readiness wait,
/// reconnect backoff) happens on that task, so neither the TUI loop nor the
/// manager's health tick ever waits on it.
#[derive(Clone)]
pub struct TunnelHandle {
    tx: mpsc::UnboundedSender<Cmd>,
    status: tokio::sync::watch::Receiver<TunnelStatus>,
    cfg: TunnelConfig,
}

impl TunnelHandle {
    /// Spawn the supervisor. `autostart`: bring the tunnel up immediately
    /// (`tunnel.enabled: true`); otherwise it idles until `ensure_up`.
    pub fn spawn(
        cfg: TunnelConfig,
        log_dir: PathBuf,
        events: mpsc::UnboundedSender<ManagerEvent>,
        autostart: bool,
    ) -> Self {
        let mut tunnel = Tunnel::new(cfg.clone(), log_dir, events);
        let (status_tx, status_rx) = tokio::sync::watch::channel(tunnel.status());
        let (tx, mut rx) = mpsc::unbounded_channel::<Cmd>();
        tokio::spawn(async move {
            if autostart {
                let _ = tunnel.ensure_up().await;
                let _ = status_tx.send(tunnel.status());
            }
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    cmd = rx.recv() => match cmd {
                        Some(Cmd::EnsureUp(reply)) => {
                            let r = tunnel.ensure_up().await;
                            let _ = status_tx.send(tunnel.status());
                            let _ = reply.send(r);
                        }
                        Some(Cmd::Shutdown { kill, done }) => {
                            tunnel.shutdown(kill).await;
                            let _ = status_tx.send(tunnel.status());
                            let _ = done.send(());
                            break;
                        }
                        None => {
                            // Handle dropped without shutdown: leave ssh alone.
                            tunnel.shutdown(false).await;
                            break;
                        }
                    },
                    _ = tick.tick() => {
                        tunnel.tick().await;
                        let _ = status_tx.send(tunnel.status());
                    }
                }
            }
        });
        Self {
            tx,
            status: status_rx,
            cfg,
        }
    }

    pub fn config(&self) -> &TunnelConfig {
        &self.cfg
    }

    /// True once the supervisor task has exited (after `shutdown`).
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }

    pub fn status(&self) -> TunnelStatus {
        self.status.borrow().clone()
    }

    /// Ask the task to bring the tunnel up and wait for the verdict.
    pub async fn ensure_up(&self) -> Result<(), String> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(Cmd::EnsureUp(reply))
            .map_err(|_| "tunnel supervisor is not running".to_string())?;
        rx.await
            .unwrap_or_else(|_| Err("tunnel supervisor stopped".to_string()))
    }

    /// Stop supervising and apply the exit policy; returns once done.
    pub async fn shutdown(&self, kill: bool) {
        let (done, rx) = tokio::sync::oneshot::channel();
        if self.tx.send(Cmd::Shutdown { kill, done }).is_ok() {
            let _ = rx.await;
        }
    }
}
