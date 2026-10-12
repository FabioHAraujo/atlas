//! Wall-clock helpers shared across the crate: epoch counters and the cached
//! local `HH:MM:SS` stamp used on every log line.

use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Timelike;

/// Milliseconds since the Unix epoch (0 if the clock is before it).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Seconds since the Unix epoch (0 if the clock is before it).
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Seconds since local midnight, right now.
pub fn secs_of_day_now() -> u32 {
    chrono::Local::now().num_seconds_from_midnight()
}

/// Local-time `HH:MM:SS` of an epoch-millis instant.
pub fn hms(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}

/// Caches the last formatted `HH:MM:SS`: chrono's local-time formatting is far
/// too slow to run per line at 100k lines/s, and it only changes once a second.
#[derive(Default)]
pub struct HmsCache {
    sec: Option<u64>,
    text: String,
}

impl HmsCache {
    /// `HH:MM:SS` of `ts_ms`, reformatted only when the second changed.
    pub fn format(&mut self, ts_ms: u64) -> &str {
        let sec = ts_ms / 1000;
        if self.sec != Some(sec) {
            self.text = hms(ts_ms as i64);
            self.sec = Some(sec);
        }
        &self.text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_reuses_the_text_within_a_second_and_refreshes_across_seconds() {
        let mut c = HmsCache::default();
        let a = c.format(1_700_000_000_100).to_string();
        assert_eq!(a.len(), 8);
        assert_eq!(c.format(1_700_000_000_900), a);
        assert_ne!(c.format(1_700_000_061_000), a);
    }

    #[test]
    fn hms_formats_local_clock_time() {
        assert_eq!(hms(0).len(), 8);
        assert!(now_ms() / 1000 >= now_secs() - 1);
    }
}
