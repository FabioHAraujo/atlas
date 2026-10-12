//! Connection subscriptions: JSON attach (with replay), listener-only attach, raw
//! byte attach, detach.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde_json::{Value, json};

use super::{Out, RawOut, Session};

impl Session {
    fn info(&self) -> Value {
        let (cols, rows) = *self.size.lock();
        json!({
            "cols": cols,
            "rows": rows,
            "title": *self.title.lock(),
            "exited": self.exited().map(|c| json!({"code": c})),
        })
    }

    pub fn attach(&self, conn: u64, out: Out, replay: bool, output: bool) -> Value {
        let mut b = self.buf.lock();
        if !output {
            b.listeners.insert(conn, out);
            drop(b);
            return self.info();
        }
        if replay {
            let all = b.ring_bytes();
            let _ = out.send(
                json!({"ev": "pty_replay", "pty": self.id, "data": B64.encode(&all)}).to_string(),
            );
        }
        b.attachers.insert(conn, out);
        drop(b);
        self.info()
    }

    /// Raw byte subscription. An exited pty gets its replay and then a closed stream.
    pub fn attach_raw(&self, conn: u64, out: RawOut, replay: bool) -> Value {
        let mut b = self.buf.lock();
        if replay {
            let _ = out.try_send(b.ring_bytes());
        }
        // Under the buf lock: `finish` clears `raw` under the same lock, so no sender outlives the pty.
        if self.exited().is_none() {
            b.raw.insert(conn, out);
        }
        drop(b);
        self.info()
    }

    pub fn detach(&self, conn: u64) {
        let mut b = self.buf.lock();
        b.attachers.remove(&conn);
        b.listeners.remove(&conn);
        b.raw.remove(&conn);
    }
}
