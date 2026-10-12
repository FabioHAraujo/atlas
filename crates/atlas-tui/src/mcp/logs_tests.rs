//! Disk-log reader behavior: tail, merge, filters, search.

use super::*;

fn fixture() -> tempfile::TempDir {
    let d = tempfile::TempDir::new().unwrap();
    std::fs::write(
        d.path().join("api.log"),
        "10:00:01 [stdout] boot\n10:00:05 [stderr] ERROR db down\n10:00:09 [stdout] ready\n",
    )
    .unwrap();
    std::fs::write(
        d.path().join("web.log"),
        "10:00:03 [stdout] vite up\n10:00:07 [stdout] warn: slow\n",
    )
    .unwrap();
    std::fs::write(
        d.path().join("api.prev.log"),
        "09:00:00 [stdout] old ERROR boom\n",
    )
    .unwrap();
    d
}

fn opts(service: Option<&str>, lines: usize) -> TailOpts<'_> {
    TailOpts {
        service,
        lines,
        since_minutes: None,
        level: None,
        now_secs: 10 * 3600 + 60,
    }
}

#[test]
fn action_output_is_readable_by_label_or_stem() {
    let d = fixture();
    std::fs::write(
        d.path().join("action-run-checks.log"),
        "10:00:10 [stdout] checking\n10:00:11 [stderr] ERROR lint failed\n",
    )
    .unwrap();
    for name in ["action:Run checks", "action-run-checks"] {
        let v = tail(d.path(), &opts(Some(name), 10)).unwrap();
        assert_eq!(v.len(), 2, "{name}");
        assert_eq!(v[0].service, "action-run-checks");
    }
    let hits = search(
        d.path(),
        &Matcher::parse("lint").unwrap(),
        Some("action:Run checks"),
        10,
        false,
    )
    .unwrap();
    assert_eq!(hits.len(), 1);
    // An action label can never reach outside `.logs/`.
    assert!(resolve_service("action:../../etc/passwd").is_some_and(|s| !s.contains('/')));
    assert!(
        log_services(d.path()).contains(&"action-run-checks".to_string()),
        "merged tail includes action logs"
    );
}

#[test]
fn services_exclude_prev_files() {
    assert_eq!(log_services(fixture().path()), vec!["api", "web"]);
}

#[test]
fn tail_single_service_returns_last_n_in_order() {
    let d = fixture();
    let t = tail(d.path(), &opts(Some("api"), 2)).unwrap();
    let text: Vec<_> = t.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(
        text,
        vec!["10:00:05 [stderr] ERROR db down", "10:00:09 [stdout] ready"]
    );
    assert_eq!(t[0].line_no, 2);
}

#[test]
fn tail_merges_services_by_timestamp() {
    let d = fixture();
    let t = tail(d.path(), &opts(None, 100)).unwrap();
    let order: Vec<_> = t.iter().map(|l| &l.text[..8]).collect();
    assert_eq!(
        order,
        vec!["10:00:01", "10:00:03", "10:00:05", "10:00:07", "10:00:09"]
    );
    assert_eq!(t[1].service, "web");
}

#[test]
fn tail_level_filters() {
    let d = fixture();
    let mut o = opts(None, 100);
    o.level = Some(MinLevel::Error);
    let t = tail(d.path(), &o).unwrap();
    assert_eq!(t.len(), 1);
    assert!(t[0].text.contains("db down"));
    o.level = Some(MinLevel::Warn);
    assert_eq!(tail(d.path(), &o).unwrap().len(), 2);
}

#[test]
fn tail_since_minutes_uses_time_of_day() {
    let d = fixture();
    let mut o = opts(Some("api"), 100);
    o.now_secs = 10 * 3600 + 10; // 10:00:10
    o.since_minutes = Some(0);
    // 0 minutes: only lines at/after now; none qualify.
    assert!(tail(d.path(), &o).unwrap().is_empty());
    o.since_minutes = Some(1);
    assert_eq!(tail(d.path(), &o).unwrap().len(), 3);
}

#[test]
fn since_handles_midnight_wrap() {
    let l = LogLine {
        service: "a".into(),
        line_no: 1,
        previous: false,
        text: "23:59:30 [stdout] x".into(),
    };
    assert!(within(&l, 30, 120)); // now 00:00:30, 2 min window
    assert!(!within(&l, 30, 30));
}

#[test]
fn tail_unknown_service_lists_available() {
    let d = fixture();
    let e = tail(d.path(), &opts(Some("nope"), 10)).unwrap_err();
    assert!(e.contains("api, web"), "{e}");
}

#[test]
fn service_name_cannot_escape_log_dir() {
    let d = fixture();
    assert!(tail(d.path(), &opts(Some("../etc/passwd"), 10)).is_err());
    let m = Matcher::parse("x").unwrap();
    assert!(search(d.path(), &m, Some("../x"), 10, false).is_err());
}

#[test]
fn search_substring_is_case_insensitive_with_line_numbers() {
    let d = fixture();
    let m = Matcher::parse("error").unwrap();
    let hits = search(d.path(), &m, None, 50, false).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].service.as_str(), hits[0].line_no), ("api", 2));
}

#[test]
fn search_unknown_service_lists_known_ones() {
    let d = fixture();
    let m = Matcher::parse("x").unwrap();
    let e = search(d.path(), &m, Some("ghost"), 10, false).unwrap_err();
    assert!(
        e.contains("ghost") && e.contains("api") && e.contains("web"),
        "{e}"
    );
}

#[test]
fn search_regex_and_previous_and_limit() {
    let d = fixture();
    let m = Matcher::parse("/ERROR \\w+/").unwrap();
    let hits = search(d.path(), &m, None, 50, true).unwrap();
    assert_eq!(hits.len(), 2);
    assert!(hits[0].previous && !hits[1].previous);
    assert_eq!(search(d.path(), &m, None, 1, true).unwrap().len(), 1);
}

#[test]
fn matcher_rejects_empty_and_bad_regex() {
    assert!(Matcher::parse("").is_err());
    assert!(Matcher::parse("/(/").is_err());
    // A lone slash-delimited path-ish query of length 2 is a substring.
    let m = Matcher::parse("//").unwrap();
    assert!(m.is_match("a // b") && !m.is_match("a b"));
}

#[test]
fn long_lines_are_clipped() {
    let l = LogLine {
        service: "a".into(),
        line_no: 1,
        previous: false,
        text: "x".repeat(5000),
    };
    assert!(l.render().len() < 2100);
}

#[test]
fn search_ignores_case_whatever_the_query_case() {
    let d = fixture();
    for q in ["error", "Error", "ERROR"] {
        let hits = search(d.path(), &Matcher::parse(q).unwrap(), None, 50, false).unwrap();
        assert_eq!(hits.len(), 1, "{q}");
    }
}

#[test]
fn search_keeps_only_the_newest_limit_hits_in_order() {
    let d = tempfile::TempDir::new().unwrap();
    let body: String = (0..1000)
        .map(|i| format!("10:00:00 [stdout] hit {i}\n10:00:00 [stdout] miss {i}\n"))
        .collect();
    std::fs::write(d.path().join("api.log"), body).unwrap();
    let hits = search(d.path(), &Matcher::parse("hit").unwrap(), None, 3, false).unwrap();
    let nos: Vec<_> = hits.iter().map(|h| h.line_no).collect();
    assert_eq!(
        nos,
        [1995, 1997, 1999],
        "newest three, oldest first, true line numbers"
    );
    assert!(hits[2].text.ends_with("hit 999"));
}

#[test]
fn crlf_and_invalid_utf8_lines_are_searchable() {
    let d = tempfile::TempDir::new().unwrap();
    std::fs::write(
        d.path().join("api.log"),
        b"10:00:00 [stdout] ok \xff needle\r\n10:00:01 [stdout] x\n",
    )
    .unwrap();
    let hits = search(d.path(), &Matcher::parse("needle").unwrap(), None, 5, false).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].text.ends_with("needle"), "{:?}", hits[0].text);
}

#[test]
fn huge_log_tail_reads_only_the_window_but_keeps_line_numbers() {
    let d = tempfile::TempDir::new().unwrap();
    let line = format!("10:00:00 [stdout] {}\n", "x".repeat(80));
    let n = (TAIL_WINDOW_BYTES as usize / line.len()) + 50_000;
    let mut body = line.repeat(n);
    body.push_str("10:00:01 [stdout] LAST\n");
    std::fs::write(d.path().join("api.log"), &body).unwrap();
    let t = tail(d.path(), &opts(Some("api"), 2)).unwrap();
    assert!(t[1].text.ends_with("LAST"));
    assert_eq!(
        t[1].line_no,
        n + 1,
        "true file line number, not window-relative"
    );
    assert_eq!(t[0].line_no, n);
    // The read itself is bounded.
    let all = read_lines(d.path(), "api", false);
    assert!((all.len() as u64) * (line.len() as u64) <= TAIL_WINDOW_BYTES + line.len() as u64);
}
