//! Incremental OSC 0/2 window-title parser fed with raw pty output.

/// Incremental OSC 0/2 title parser (`ESC ] 0;title BEL` or `ESC ] 2;title ESC \`).
#[derive(Default)]
pub(super) struct TitleParser {
    st: u8,
    buf: Vec<u8>,
}

impl TitleParser {
    pub(super) fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        let mut last = None;
        for &c in bytes {
            self.st = match (self.st, c) {
                (0, 0x1b) => 1,
                (0, _) => 0,
                (1, b']') => 2,
                (1, 0x1b) => 1,
                (1, _) => 0,
                (2, b'0' | b'2') => 3,
                (2, _) => 0,
                (3, b';') => {
                    self.buf.clear();
                    4
                }
                (3, _) => 0,
                (4, 0x07) => {
                    last = Some(String::from_utf8_lossy(&self.buf).into_owned());
                    0
                }
                (4, 0x1b) => 5,
                (4, _) => {
                    if self.buf.len() < 4096 {
                        self.buf.push(c);
                    }
                    4
                }
                (5, b'\\') => {
                    last = Some(String::from_utf8_lossy(&self.buf).into_owned());
                    0
                }
                (5, _) => 0,
                _ => 0,
            };
        }
        last
    }
}
