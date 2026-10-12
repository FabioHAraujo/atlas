//! The runner: `atlas dev --headless` / `atlas dev --detach` engine, plus the
//! server side of the attach protocol.
//!
//! One loop owns the [`ServiceManager`]. A [`Hub`] sits next to it: it keeps the
//! recent log tail and side events in memory, and fans every manager event out to
//! subscribed clients as one JSON line each. A client's `subscribe` is answered
//! with a snapshot built **in the same loop turn** that registers its stream, so
//! the snapshot and the events that follow are gap-free and duplicate-free.
//!
//! Wire events (`"t"` discriminates), all produced by [`Hub::on_event`]:
//!
//! | `t` | payload |
//! |---|---|
//! | `log` | `name`, `line`, `stream` (`stdout`/`stderr`) |
//! | `state` | `name`, `state` + the service facts (`exit_code`, `restarts`, `note`, `completed_ok`, `paused_by`, `deselected`) |
//! | `rows` | every service row + `tunnel`, sent at most once a second when changed |
//! | `note` | `name`, `message` (scheduler narration) |
//! | `alert` | `service`, `message` |
//! | `tunnel` | `state` + `tunnel` object |
//! | `action_progress` | `label`, `line` |
//! | `action_done` | `label`, `ok` |
//! | `started` | all app services were queued |
//! | `bye` | the runner is shutting down |
//!
//! The snapshot also carries `action_runs` (oldest first): per recent action run
//! `label`, `start`/`end` (epoch ms, `end` null while running), `status`
//! (`running`/`ok`/`failed`), the last [`ACTION_TAIL_LINES`] output `lines` and how many
//! earlier lines were `skipped`. Older runners omit it; clients treat it as optional.

mod detach;
mod hub;
mod lifecycle;
#[cfg(test)]
mod tests;
mod wire;

pub use detach::{Detached, DownOutcome, detach, down, wait_gone};
pub use hub::Hub;
pub use lifecycle::run;
pub(crate) use lifecycle::{lock_or_err, term_signals};
pub(crate) use wire::parse_state;

/// How the headless engine was started: attached to a terminal, or `--detach`ed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunKind {
    /// `atlas dev --headless`: streams service output to stdout.
    Foreground,
    /// `atlas dev --detach`: stdout/stderr go to `.logs/runner.log`; service output
    /// is only in the per-service disk logs and the attach stream.
    Background,
}

pub const RUNNER_LOG: &str = "runner.log";
