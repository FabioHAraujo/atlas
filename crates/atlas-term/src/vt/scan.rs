//! Streaming finder for the string sequences alacritty ignores: OSC 133/7 (prompt marks,
//! cwd), APC `G` (Kitty graphics) and DCS sixel. Split-safe across `feed` chunks.

/// A string sequence alacritty ignores, picked out of the stream.
#[derive(Debug, PartialEq)]
pub(super) enum Seq {
    /// OSC 133 / 7 payload.
    Osc(Vec<u8>),
    /// APC `G…` (Kitty graphics), without the `G`.
    Kitty(Vec<u8>),
    /// DCS sixel (`P1;P2;P3 q …`).
    Sixel(Vec<u8>),
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Kind {
    #[default]
    Osc,
    Apc,
    Dcs,
}

/// Streaming finder for OSC (BEL/ST), APC and DCS (ST) strings, split-safe.
/// Whole APC/DCS bodies are consumed here, so an `ESC ]` inside one is not an OSC.
#[derive(Default)]
pub(super) struct SeqScan {
    /// 0 text, 1 after ESC, 2 in a string, 3 ESC inside a string.
    st: u8,
    kind: Kind,
    buf: Vec<u8>,
    /// The string is not one we want (or overflowed): skip to its end.
    skip: bool,
}

impl SeqScan {
    const MAX_OSC: usize = 4096;
    const MAX_BODY: usize = 64 << 20;

    fn start(&mut self, kind: Kind) -> u8 {
        self.kind = kind;
        self.buf.clear();
        self.skip = false;
        2
    }

    /// `(offset just past the terminator, sequence)` for each wanted string in `bytes`.
    pub(super) fn scan(&mut self, bytes: &[u8]) -> Vec<(usize, Seq)> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            // Plain text: jump to the next ESC.
            if self.st == 0 {
                match bytes[i..].iter().position(|&b| b == 0x1b) {
                    Some(k) => i += k,
                    None => break,
                }
            }
            let b = bytes[i];
            self.st = match (self.st, b) {
                (0 | 1, 0x1b) => 1,
                (1, b']') => self.start(Kind::Osc),
                (1, b'_') => self.start(Kind::Apc),
                (1, b'P') => self.start(Kind::Dcs),
                (2, 0x07) | (3, b'\\') if self.st == 3 || self.kind == Kind::Osc => {
                    if !self.skip
                        && let Some(seq) = self.finish()
                    {
                        out.push((i + 1, seq));
                    }
                    0
                }
                (2 | 3, 0x1b) => 3,
                (2, _) => {
                    let max = match self.kind {
                        Kind::Osc => Self::MAX_OSC,
                        _ => Self::MAX_BODY,
                    };
                    if self.skip {
                    } else if self.buf.len() < max {
                        self.buf.push(b);
                    } else {
                        self.skip = true;
                        self.buf = Vec::new();
                    }
                    2
                }
                // CAN/SUB or an unrelated escape abort the string.
                _ => 0,
            };
            i += 1;
        }
        out
    }

    fn finish(&mut self) -> Option<Seq> {
        let buf = std::mem::take(&mut self.buf);
        match self.kind {
            Kind::Osc => {
                (buf.starts_with(b"133;") || buf.starts_with(b"7;")).then_some(Seq::Osc(buf))
            }
            Kind::Apc => buf.strip_prefix(b"G").map(|b| Seq::Kitty(b.to_vec())),
            // Sixel: numeric params, then `q` (no intermediates: `$q` is DECRQSS).
            Kind::Dcs => {
                let q = buf
                    .iter()
                    .position(|&c| !(c.is_ascii_digit() || c == b';'))?;
                (buf[q] == b'q').then_some(Seq::Sixel(buf))
            }
        }
    }
}
