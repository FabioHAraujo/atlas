//! Status reporting to Atlas Desktop's hook server: map a harness event to the
//! desktop's vocabulary and POST it over loopback.

use std::io::Read;

use serde_json::Value;

use super::{Event, Harness};

/// Status event for Atlas Desktop's hook server, in the vocabulary its
/// `normalize` understands. `None` = not a status change worth sending.
pub fn status_payload(event: Event, input: &Value) -> Option<Value> {
    let s = |k: &str| input.get(k).and_then(Value::as_str);
    let name = match event {
        Event::SessionStart => "session_start",
        Event::UserPromptSubmit => "user_prompt_submit",
        Event::PreToolUse => "pre_tool_use",
        Event::PostToolUse => "post_tool_use",
        Event::Stop | Event::StopFailure => "stop",
        Event::SessionEnd => "session_end",
        Event::PermissionRequest => "permission_request",
        // Claude sends Notification for permission prompts *and* idle reminders;
        // only the former means "blocked".
        Event::Notification => {
            let m = s("message").unwrap_or("").to_ascii_lowercase();
            if !m.contains("permission") && !m.contains("approv") {
                return None;
            }
            "permission_request"
        }
    };
    let mut p = serde_json::json!({ "event": name });
    if let Some(v) = s("session_id") {
        p["session_id"] = v.into();
    }
    if let Some(v) = s("transcript_path") {
        p["session_file"] = v.into();
    }
    if let Some(v) = s("prompt") {
        p["prompt"] = v.into();
    }
    if let Some(v) = s("tool_name") {
        p["tool_name"] = v.into();
    }
    if let Some(v) = s("last_assistant_message")
        .or(s("error_details"))
        .or(s("error"))
    {
        p["text"] = v.into();
    }
    Some(p)
}

/// POST the event to Atlas Desktop when the agent runs in one of its terminals
/// (`ATLAS_HOOK_ENDPOINT` set). Loopback only, 1 s timeout, never fails the hook.
pub(super) fn report_status(harness: Harness, event: Event, stdin: &str) {
    let Ok(endpoint) = std::env::var("ATLAS_HOOK_ENDPOINT") else {
        return;
    };
    let Ok(input) = serde_json::from_str::<Value>(stdin) else {
        return;
    };
    let Some(payload) = status_payload(event, &input) else {
        return;
    };
    let Ok(file) = std::fs::read_to_string(endpoint) else {
        return;
    };
    let get = |k: &str| {
        file.lines()
            .find_map(|l| l.strip_prefix(k)?.strip_prefix('='))
            .map(str::trim)
            .map(str::to_string)
    };
    let (Some(port), Some(token)) = (get("ATLAS_HOOK_PORT"), get("ATLAS_HOOK_TOKEN")) else {
        return;
    };
    let env = |k: &str| std::env::var(k).ok();
    let body = serde_json::json!({
        "pane_key": env("ATLAS_PANE_KEY"),
        "launch_token": env("ATLAS_LAUNCH_TOKEN"),
        "tab_id": env("ATLAS_TAB_ID"),
        "worktree_id": env("ATLAS_WORKTREE_ID"),
        "agent": harness.agent_id(),
        "payload": payload,
    })
    .to_string();
    let req = format!(
        "POST /hook/{} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nX-Atlas-Hook-Token: {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        harness.agent_id(),
        body.len()
    );
    let Ok(addr) = format!("127.0.0.1:{port}").parse() else {
        return;
    };
    let timeout = std::time::Duration::from_secs(1);
    if let Ok(mut s) = std::net::TcpStream::connect_timeout(&addr, timeout) {
        use std::io::Write;
        let _ = s.set_read_timeout(Some(timeout));
        let _ = s.write_all(req.as_bytes());
        let _ = s.read(&mut [0u8; 64]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::hook::respond;
    use serde_json::json;

    #[test]
    fn status_payloads_map_events_and_skip_idle_notifications() {
        let p = status_payload(
            Event::UserPromptSubmit,
            &json!({"session_id": "s", "transcript_path": "/t.jsonl", "prompt": "hi"}),
        )
        .unwrap();
        assert_eq!(p["event"], "user_prompt_submit");
        assert_eq!(
            (p["session_file"].as_str(), p["prompt"].as_str()),
            (Some("/t.jsonl"), Some("hi"))
        );
        assert_eq!(
            status_payload(Event::Stop, &json!({})).unwrap()["event"],
            "stop"
        );
        let ask = json!({"message": "Claude needs your permission to use Bash"});
        assert_eq!(
            status_payload(Event::Notification, &ask).unwrap()["event"],
            "permission_request"
        );
        let idle = json!({"message": "Claude is waiting for your input"});
        assert!(status_payload(Event::Notification, &idle).is_none());
        // A failed turn still ends the turn, with the error as the last message.
        let fail = status_payload(
            Event::StopFailure,
            &json!({"error": "authentication_failed"}),
        )
        .unwrap();
        assert_eq!(
            (fail["event"].as_str(), fail["text"].as_str()),
            (Some("stop"), Some("authentication_failed"))
        );
        // Status-only events never answer the harness.
        assert!(respond(Harness::ClaudeCode, Event::Stop, r#"{"cwd":"/"}"#).is_none());
    }
}
