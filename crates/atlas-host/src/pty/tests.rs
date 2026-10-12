use std::time::Duration;

use tokio::sync::mpsc;

use super::title::TitleParser;
use super::{RAW_QUEUE, Session};
use crate::protocol::PtyCreate;

#[test]
fn title_split_across_chunks() {
    let mut p = TitleParser::default();
    assert_eq!(p.feed("x\x1b]0;π ".as_bytes()), None);
    assert_eq!(p.feed(b": work\x07y").as_deref(), Some("π : work"));
    assert_eq!(p.feed(b"\x1b]2;two\x1b\\").as_deref(), Some("two"));
    assert_eq!(p.feed(b"\x1b]1;icon\x07"), None);
}

/// A raw reader that never reads must not freeze the program: it is dropped
/// after `RAW_STALL` and the output (far more than the queues hold) completes.
#[tokio::test(flavor = "multi_thread")]
async fn stuck_raw_reader_does_not_block_the_program() {
    let dir = std::env::temp_dir().join(format!("atlas-host-raw-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let req = PtyCreate {
        cwd: "/".into(),
        argv: vec![
            "/bin/sh".into(),
            "-c".into(),
            "head -c 20000000 /dev/zero".into(),
        ],
        env: Default::default(),
        cols: 80,
        rows: 24,
        scope: Default::default(),
        title: None,
        mode: Default::default(),
    };
    let s = Session::spawn(req, &dir).unwrap();
    let (tx, _rx_never_read) = mpsc::channel(RAW_QUEUE);
    s.attach_raw(1, tx, false);
    let t0 = std::time::Instant::now();
    while s.exited().is_none() {
        assert!(
            t0.elapsed() < Duration::from_secs(20),
            "program froze behind the reader"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(s.buf.lock().raw.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}
