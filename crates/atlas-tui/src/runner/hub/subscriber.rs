//! One attached client and its back-pressure policy.

use serde_json::json;
use tokio::sync::mpsc;

/// An attached client. A burst can outrun it; rather than cutting it off (it would
/// reconnect and lose the burst anyway), its log lines are skipped and counted, and a
/// `gap` event tells it how many once it reads again. Other events are never skipped.
pub(super) struct Subscriber {
    pub(super) tx: mpsc::Sender<String>,
    pub(super) skipped: u64,
}

impl Subscriber {
    /// `false` = the connection is gone.
    pub(super) fn send(&mut self, line: &str, is_log: bool) -> bool {
        use mpsc::error::TrySendError;
        if self.skipped > 0 {
            let gap = json!({"t": "gap", "skipped": self.skipped}).to_string();
            match self.tx.try_send(gap) {
                Ok(()) => self.skipped = 0,
                Err(TrySendError::Closed(_)) => return false,
                Err(TrySendError::Full(_)) => {}
            }
        }
        if self.skipped > 0 && is_log {
            self.skipped += 1;
            return true;
        }
        match self.tx.try_send(line.to_string()) {
            Ok(()) => true,
            Err(TrySendError::Closed(_)) => false,
            // A full buffer on a state event means the client is truly stuck.
            Err(TrySendError::Full(_)) if is_log => {
                self.skipped += 1;
                true
            }
            Err(TrySendError::Full(_)) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn a_slow_subscriber_skips_log_lines_and_hears_about_the_gap() {
        let (tx, mut rx) = mpsc::channel(2);
        let mut s = Subscriber { tx, skipped: 0 };
        for i in 0..5 {
            assert!(s.send(&format!("log{i}"), true));
        }
        assert_eq!(s.skipped, 3);
        assert_eq!(rx.try_recv().unwrap(), "log0");
        assert_eq!(rx.try_recv().unwrap(), "log1");
        // Room again: the gap goes first, then the new line.
        assert!(s.send("log5", true));
        let gap: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(gap, json!({"t": "gap", "skipped": 3}));
        assert_eq!(rx.try_recv().unwrap(), "log5");
        // A full buffer on a non-log event still drops the subscriber.
        assert!(s.send("a", true) && s.send("b", true));
        assert!(!s.send("state", false));
        drop(rx);
        let (tx, rx) = mpsc::channel(1);
        drop(rx);
        assert!(!Subscriber { tx, skipped: 0 }.send("x", true));
    }
}
