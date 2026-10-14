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
    // Far more output than the queues hold (ConPTY renders it, so Windows prints lines).
    let script = if cfg!(windows) {
        "for /L %i in (1,1,20000) do @echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    } else {
        "head -c 20000000 /dev/zero"
    };
    let s = Session::spawn(shell_req(script), &dir).unwrap();
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

/// A pty running `script` through the platform shell, in the temp dir.
fn shell_req(script: &str) -> PtyCreate {
    let argv = if cfg!(windows) {
        vec!["cmd.exe".into(), "/d".into(), "/c".into(), script.into()]
    } else {
        vec!["/bin/sh".into(), "-c".into(), script.into()]
    };
    PtyCreate {
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        argv,
        env: Default::default(),
        cols: 80,
        rows: 24,
        scope: Default::default(),
        title: None,
        mode: Default::default(),
    }
}

async fn until_exited(s: &Session) -> Option<i32> {
    let t0 = std::time::Instant::now();
    loop {
        if let Some(code) = s.exited() {
            return code;
        }
        assert!(
            t0.elapsed() < Duration::from_secs(15),
            "the session never ended after its program exited"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// A finished program ends its session with its exit code and its last output kept. On Windows
/// this guards the ConPTY rule that the output pipe only ends once the pseudo console is closed:
/// without closing it on exit the session would stay "running" forever.
#[tokio::test(flavor = "multi_thread")]
async fn a_program_that_exits_ends_its_session_with_its_code_and_output() {
    let dir = tempfile::tempdir().unwrap();
    let s = Session::spawn(shell_req("echo atlas-pty-ok&& exit 3"), dir.path()).unwrap();
    assert_eq!(until_exited(&s).await, Some(3));
    let text = s.read_text(50);
    assert!(text.contains("atlas-pty-ok"), "{text:?}");
    // Exited: input is refused, and signalling is a no-op rather than an error.
    assert!(s.write(b"x").is_err());
    assert!(s.signal("TERM").is_ok());
}

/// `KILL` ends a running program (and on Windows everything it started).
#[tokio::test(flavor = "multi_thread")]
async fn kill_ends_a_running_program() {
    let dir = tempfile::tempdir().unwrap();
    let script = if cfg!(windows) {
        "ping -n 60 127.0.0.1 >NUL"
    } else {
        "sleep 60"
    };
    let s = Session::spawn(shell_req(script), dir.path()).unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(s.exited().is_none());
    s.signal("KILL").unwrap();
    until_exited(&s).await;
    assert!(s.signal("bogus").is_err());
}
