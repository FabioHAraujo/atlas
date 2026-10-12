//! What a service is, judged from its config alone, and what "open" does for it.

use atlas_tui::config;
use serde_json::{Value, json};

/// What a service is, from its config alone: drives the card icon and what "open" does.
/// `web` / `api` open in the browser; `database` / `cache` copy a connection URL;
/// `worker` / `task` have nothing to open.
pub(super) fn service_kind(name: &str, s: &config::ServiceDef) -> &'static str {
    let n = name.to_ascii_lowercase();
    let cmd = s
        .command
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w) || cmd.contains(w));
    let port = s.port.unwrap_or(0);
    if has(&["redis", "valkey", "memcache", "dragonfly"])
        || (6379..=6399).contains(&port)
        || port == 63790
    {
        return "cache";
    }
    if has(&[
        "postgres", "database", "mysql", "mariadb", "mongo", "supabase",
    ]) || n == "db"
        || matches!(port, 5432 | 3306 | 27017)
        || (54320..=54329).contains(&port)
    {
        return "database";
    }
    if s.port.is_none() && s.open_url.is_none() {
        return if s.oneshot { "task" } else { "worker" };
    }
    let url = s.open_url.as_deref().unwrap_or_default();
    if has(&["api", "server", "backend", "graphql", "grpc"])
        || url.contains("api")
        || url.contains("docs")
    {
        "api"
    } else {
        "web"
    }
}

/// `{ how: "browser" | "copy", url }`, or null when there is nothing to open.
pub(super) fn open_target(kind: &str, s: &config::ServiceDef) -> Value {
    if let Some(url) = s.open_url.as_deref().filter(|u| !u.is_empty()) {
        return json!({ "how": "browser", "url": url });
    }
    let Some(port) = s.port else {
        return Value::Null;
    };
    match kind {
        "web" | "api" => json!({ "how": "browser", "url": format!("http://localhost:{port}") }),
        "cache" => json!({ "how": "copy", "url": format!("redis://localhost:{port}") }),
        "database" => {
            let scheme = match port {
                3306 => "mysql",
                27017 => "mongodb",
                _ => "postgresql",
            };
            json!({ "how": "copy", "url": format!("{scheme}://localhost:{port}") })
        }
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc(yaml: &str) -> config::ServiceDef {
        serde_yaml::from_str(yaml).unwrap()
    }

    #[test]
    fn kinds_and_targets_follow_config() {
        let cases = [
            (
                "database",
                "port: 54321",
                "database",
                "postgresql://localhost:54321",
            ),
            ("redis", "port: 63790", "cache", "redis://localhost:63790"),
            (
                "server",
                "{ command: x, port: 3070, open_url: 'http://localhost:3070/api-reference' }",
                "api",
                "http://localhost:3070/api-reference",
            ),
            (
                "web",
                "{ command: x, port: 3071 }",
                "web",
                "http://localhost:3071",
            ),
        ];
        for (name, yaml, kind, url) in cases {
            let s = svc(yaml);
            let k = service_kind(name, &s);
            assert_eq!(k, kind, "{name}");
            assert_eq!(open_target(k, &s)["url"], url, "{name}");
        }
        let w = svc("{ command: x }");
        assert_eq!(service_kind("worker", &w), "worker");
        assert!(open_target("worker", &w).is_null());
        assert_eq!(
            service_kind("migrate", &svc("{ command: x, oneshot: true }")),
            "task"
        );
    }
}
