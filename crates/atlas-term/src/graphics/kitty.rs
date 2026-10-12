//! Kitty graphics protocol: parse an APC `G` command, assemble chunked transmissions,
//! decode the payload (raw RGB/RGBA, PNG, file/temp-file mediums) and apply
//! put/delete actions to the `Store`.

use std::io::Read;

use base64::Engine;

use super::{MAX_SIDE, Outcome, Placed, Placement, Store};

/// Largest single payload accepted.
const MAX_BYTES: usize = 100 << 20;

#[derive(Clone, Debug, Default)]
pub(super) struct Cmd {
    action: u8,
    format: u32,
    medium: u8,
    width: u32,
    height: u32,
    id: u32,
    number: u32,
    placement: u32,
    more: bool,
    compressed: bool,
    quiet: u8,
    src: [u32; 4],
    cols: u16,
    rows: u16,
    keep_cursor: bool,
    z: i32,
    delete: u8,
}

impl Cmd {
    fn parse(keys: &str) -> Self {
        let mut c = Cmd {
            action: b't',
            format: 32,
            medium: b'd',
            delete: b'a',
            ..Cmd::default()
        };
        for kv in keys.split(',') {
            let Some((k, v)) = kv.split_once('=') else {
                continue;
            };
            let n = || v.parse::<u32>().unwrap_or(0);
            let ch = v.bytes().next().unwrap_or(0);
            match k {
                "a" => c.action = ch,
                "f" => c.format = n(),
                "t" => c.medium = ch,
                "s" => c.width = n(),
                "v" => c.height = n(),
                "i" => c.id = n(),
                "I" => c.number = n(),
                "p" => c.placement = n(),
                "m" => c.more = v == "1",
                "o" => c.compressed = v == "z",
                "q" => c.quiet = n() as u8,
                "x" => c.src[0] = n(),
                "y" => c.src[1] = n(),
                "w" => c.src[2] = n(),
                "h" => c.src[3] = n(),
                "c" => c.cols = n().min(u16::MAX as u32) as u16,
                "r" => c.rows = n().min(u16::MAX as u32) as u16,
                "C" => c.keep_cursor = v == "1",
                "z" => c.z = v.parse().unwrap_or(0),
                "d" => c.delete = ch,
                _ => {}
            }
        }
        c
    }

    fn reply(&self, msg: &str) -> Option<String> {
        let ok = msg == "OK";
        if (self.id == 0 && self.number == 0) || self.quiet >= 2 || (ok && self.quiet == 1) {
            return None;
        }
        let mut s = String::from("\x1b_G");
        if self.id != 0 {
            s.push_str(&format!("i={}", self.id));
        }
        if self.number != 0 {
            s.push_str(&format!(
                "{}I={}",
                if self.id != 0 { "," } else { "" },
                self.number
            ));
        }
        if self.placement != 0 {
            s.push_str(&format!(",p={}", self.placement));
        }
        s.push_str(&format!(";{msg}\x1b\\"));
        Some(s)
    }
}

impl Store {
    /// One APC `G` payload (`keys;base64data`).
    pub fn kitty(&mut self, payload: &[u8]) -> Outcome {
        let none = Outcome {
            reply: None,
            place: None,
        };
        let s = String::from_utf8_lossy(payload);
        let (keys, data) = s.split_once(';').unwrap_or((&s, ""));
        let mut cmd = Cmd::parse(keys);
        // Continuation chunk: keys come from the first chunk.
        if let Some((first, mut buf)) = self.pending.take() {
            buf.extend_from_slice(data.as_bytes());
            if cmd.more {
                if buf.len() > MAX_BYTES * 2 {
                    return Outcome {
                        reply: first.reply("EFBIG:too large"),
                        place: None,
                    };
                }
                self.pending = Some((first, buf));
                return none;
            }
            let quiet = cmd.quiet.max(first.quiet);
            cmd = first;
            cmd.quiet = quiet;
            return self.run(cmd, &buf);
        }
        if cmd.more {
            self.pending = Some((cmd, data.as_bytes().to_vec()));
            return none;
        }
        self.run(cmd, data.as_bytes())
    }

    fn run(&mut self, mut cmd: Cmd, data: &[u8]) -> Outcome {
        let err = |cmd: &Cmd, m: &str| Outcome {
            reply: cmd.reply(m),
            place: None,
        };
        match cmd.action {
            b'd' => {
                self.delete(&cmd);
                Outcome {
                    reply: None,
                    place: None,
                }
            }
            b'p' => {
                let id = self.resolve(&cmd);
                if !self.images.contains_key(&id) {
                    return err(&cmd, "ENOENT:no such image");
                }
                cmd.id = id;
                self.place(cmd)
            }
            b't' | b'T' | b'q' => {
                let (w, h, rgba) = match decode(&cmd, data) {
                    Ok(v) => v,
                    Err(e) => return err(&cmd, &e),
                };
                if cmd.action == b'q' {
                    return err(&cmd, "OK");
                }
                if cmd.id == 0 {
                    cmd.id = self.auto_id();
                    if cmd.number != 0 {
                        self.numbers.insert(cmd.number, cmd.id);
                    }
                }
                self.insert(cmd.id, w, h, rgba);
                if cmd.action == b'T' {
                    self.place(cmd)
                } else {
                    err(&cmd, "OK")
                }
            }
            _ => err(&cmd, "EINVAL:unknown action"),
        }
    }

    /// `I=` (image number) refers to the newest image transmitted with it.
    fn resolve(&self, cmd: &Cmd) -> u32 {
        match (cmd.id, cmd.number) {
            (0, n) if n != 0 => self.numbers.get(&n).copied().unwrap_or(0),
            (id, _) => id,
        }
    }

    fn place(&mut self, cmd: Cmd) -> Outcome {
        let img = &self.images[&cmd.id];
        let [x, y, w, h] = cmd.src;
        let x = x.min(img.w);
        let y = y.min(img.h);
        let w = if w == 0 { img.w - x } else { w.min(img.w - x) };
        let h = if h == 0 { img.h - y } else { h.min(img.h - y) };
        let p = Placement {
            image: cmd.id,
            id: cmd.placement,
            line: 0,
            col: 0,
            cols: cmd.cols,
            rows: cmd.rows,
            src: [x, y, w, h],
            size: (0.0, 0.0),
            z: cmd.z,
            alt: false,
        };
        Outcome {
            reply: cmd.reply("OK"),
            place: Some((
                p,
                Placed {
                    cols: cmd.cols,
                    rows: cmd.rows,
                    keep_cursor: cmd.keep_cursor,
                },
            )),
        }
    }

    fn delete(&mut self, cmd: &Cmd) {
        let free = cmd.delete.is_ascii_uppercase();
        match cmd.delete.to_ascii_lowercase() {
            b'i' => {
                self.placements
                    .retain(|p| p.image != cmd.id || (cmd.placement != 0 && p.id != cmd.placement));
                if free {
                    self.remove_image(cmd.id);
                }
            }
            // `a` (default): every placement.
            _ => {
                self.placements.clear();
                if free {
                    let ids: Vec<u32> = self.images.keys().copied().collect();
                    for id in ids {
                        self.remove_image(id);
                    }
                }
            }
        }
        self.gc();
    }
}

/// Transmission medium + format → RGBA8.
fn decode(cmd: &Cmd, data: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let raw = b64
        .decode(
            data.iter()
                .copied()
                .filter(|b| !b.is_ascii_whitespace())
                .collect::<Vec<_>>(),
        )
        .map_err(|_| "EINVAL:bad base64".to_string())?;
    let mut bytes = match cmd.medium {
        b'd' => raw,
        b'f' | b't' => {
            let path = String::from_utf8(raw).map_err(|_| "EINVAL:bad path".to_string())?;
            read_file(&path, cmd.medium == b't')?
        }
        _ => return Err("EINVAL:unsupported transmission medium".into()),
    };
    if cmd.compressed {
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(&bytes[..])
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| "EINVAL:bad zlib data".to_string())?;
        bytes = out;
    }
    let (w, h) = (cmd.width, cmd.height);
    let rgba = match cmd.format {
        100 => return decode_png(&bytes),
        32 | 24 => {
            if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
                return Err("EINVAL:bad size".into());
            }
            let bpp = (cmd.format / 8) as usize;
            let need = w as usize * h as usize * bpp;
            if bytes.len() < need {
                return Err("ENODATA:insufficient image data".into());
            }
            if bpp == 4 {
                bytes.truncate(need);
                bytes
            } else {
                rgb_to_rgba(&bytes[..need])
            }
        }
        _ => return Err("EINVAL:unsupported format".into()),
    };
    Ok((w, h, rgba))
}

/// `t=f` / `t=t`: a regular file; temp files (`t=t`) are deleted after reading.
fn read_file(path: &str, temp: bool) -> Result<Vec<u8>, String> {
    let p = std::path::Path::new(path);
    let meta = std::fs::metadata(p).map_err(|_| "ENOENT:no such file".to_string())?;
    if !meta.is_file() || meta.len() > MAX_BYTES as u64 {
        return Err("EINVAL:not a regular file".into());
    }
    let bytes = std::fs::read(p).map_err(|_| "EBADF:unreadable".to_string())?;
    // Only delete what the protocol says is a temp file.
    if temp && path.contains("tty-graphics-protocol") {
        let _ = std::fs::remove_file(p);
    }
    Ok(bytes)
}

fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let bad = |_| "EBADPNG:bad png".to_string();
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut r = dec.read_info().map_err(bad)?;
    let (w, h) = (r.info().width, r.info().height);
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return Err("EINVAL:bad size".into());
    }
    let mut buf = vec![0; r.output_buffer_size().ok_or("EINVAL:too large")?];
    let info = r.next_frame(&mut buf).map_err(bad)?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => rgb_to_rgba(&buf),
        png::ColorType::GrayscaleAlpha => buf
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|&[g, a]| [g, g, g, a])
            .collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("EBADPNG:unexpanded palette".into()),
    };
    Ok((w, h, rgba))
}

fn rgb_to_rgba(b: &[u8]) -> Vec<u8> {
    b.as_chunks::<3>()
        .0
        .iter()
        .flat_map(|&[r, g, b]| [r, g, b, 255])
        .collect()
}
