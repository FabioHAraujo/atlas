//! Helpers shared by the end-to-end test binaries (`mod common;`). Each test binary uses
//! a subset, so unused items are expected.
#![allow(dead_code)]

use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn python_available() -> bool {
    Command::new("python3")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Skip (loudly) when python3 is missing: the fixture services need it.
#[macro_export]
macro_rules! require_python {
    () => {
        if !$crate::common::python_available() {
            eprintln!("SKIP {}: python3 not available", module_path!());
            return;
        }
    };
}

/// Bind :0, read the port, release it.
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Poll `f` until it returns Some, or panic with `what` after `timeout`.
pub fn wait_for<T>(what: &str, timeout: Duration, f: impl FnMut() -> Option<T>) -> T {
    wait_for_with(what, timeout, f, String::new)
}

/// Like [`wait_for`], but the timeout panic also carries `diagnose()`: why the condition never
/// held (instance stdout, status, service logs). A CI timeout is otherwise a one-line mystery.
pub fn wait_for_with<T>(
    what: &str,
    timeout: Duration,
    mut f: impl FnMut() -> Option<T>,
    diagnose: impl FnOnce() -> String,
) -> T {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(v) = f() {
            return v;
        }
        if Instant::now() >= deadline {
            panic!("timed out waiting for {what}\n{}", diagnose());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

unsafe extern "C" {
    #[link_name = "kill"]
    pub fn libc_kill(pid: i32, sig: i32) -> i32;
}
