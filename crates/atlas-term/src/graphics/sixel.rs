//! Sixel (DCS `q`) decoding and placement.

use super::{MAX_SIDE, Placed, Placement, Store};

impl Store {
    /// A decoded sixel image placed at the cursor (`vt` anchors it).
    pub fn sixel(&mut self, data: &[u8]) -> Option<(Placement, Placed)> {
        let (w, h, rgba) = decode_sixel(data)?;
        let id = self.auto_id();
        self.insert(id, w, h, rgba);
        self.transient.insert(id);
        Some((
            Placement {
                image: id,
                id: 0,
                line: 0,
                col: 0,
                cols: 0,
                rows: 0,
                src: [0, 0, w, h],
                size: (0.0, 0.0),
                z: 0,
                alt: false,
            },
            Placed {
                cols: 0,
                rows: 0,
                keep_cursor: false,
            },
        ))
    }
}

/// VT340 default sixel palette (percent RGB).
const VT340: [[u8; 3]; 16] = [
    [0, 0, 0],
    [20, 20, 80],
    [80, 13, 13],
    [20, 80, 20],
    [80, 20, 80],
    [20, 80, 80],
    [80, 80, 20],
    [53, 53, 53],
    [26, 26, 26],
    [33, 33, 60],
    [60, 26, 26],
    [33, 60, 33],
    [60, 33, 60],
    [33, 60, 60],
    [60, 60, 33],
    [80, 80, 80],
];

fn pct(v: u32) -> u8 {
    (v.min(100) * 255 / 100) as u8
}

/// HLS (sixel's hue 0 = blue) → RGB, components in percent / degrees.
fn hls(h: u32, l: u32, s: u32) -> [u8; 3] {
    let (h, l, s) = (
        ((h + 240) % 360) as f32,
        l.min(100) as f32 / 100.0,
        s.min(100) as f32 / 100.0,
    );
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let f = |v: f32| ((v + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    [f(r), f(g), f(b)]
}

/// Sixel data after the DCS intro (`P1;P2;P3 q …`) → RGBA8. Unset pixels are transparent.
pub fn decode_sixel(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let q = data.iter().position(|&b| b == b'q')?;
    let body = &data[q + 1..];
    let mut pal: Vec<[u8; 3]> = VT340
        .iter()
        .map(|c| [pct(c[0] as u32), pct(c[1] as u32), pct(c[2] as u32)])
        .collect();
    pal.resize(256, [255, 255, 255]);
    // Sparse writes into a growing canvas.
    let (mut w, mut h) = (0u32, 0u32);
    let mut px: Vec<u8> = Vec::new();
    let mut stride = 0u32;
    let grow = |px: &mut Vec<u8>,
                stride: &mut u32,
                need_w: u32,
                need_h: u32,
                w: &mut u32,
                h: &mut u32|
     -> bool {
        if need_w > MAX_SIDE || need_h > MAX_SIDE {
            return false;
        }
        if need_w > *stride {
            let ns = need_w.next_power_of_two().clamp(64, MAX_SIDE);
            let rows = px.len() / (*stride as usize * 4).max(1);
            let mut n = vec![0u8; ns as usize * 4 * rows];
            for r in 0..rows {
                let src = r * *stride as usize * 4;
                n[r * ns as usize * 4..][..*stride as usize * 4]
                    .copy_from_slice(&px[src..src + *stride as usize * 4]);
            }
            *px = n;
            *stride = ns;
        }
        let rows = px.len() / (*stride as usize * 4);
        if need_h as usize > rows {
            px.resize(need_h as usize * *stride as usize * 4, 0);
        }
        *w = (*w).max(need_w);
        *h = (*h).max(need_h);
        true
    };
    let (mut x, mut y) = (0u32, 0u32);
    let mut color = 0usize;
    let mut i = 0;
    let num = |i: &mut usize| -> Vec<u32> {
        let mut out = vec![0u32];
        while *i < body.len() {
            match body[*i] {
                d @ b'0'..=b'9' => {
                    let v = out.last_mut().unwrap();
                    *v = v.saturating_mul(10).saturating_add((d - b'0') as u32);
                }
                b';' => out.push(0),
                _ => break,
            }
            *i += 1;
        }
        out
    };
    while i < body.len() {
        let b = body[i];
        i += 1;
        let mut repeat = 1;
        let sixel = match b {
            b'"' => {
                let a = num(&mut i);
                // Raster attributes: preallocate the declared size.
                if let (Some(&pw), Some(&ph)) = (a.get(2), a.get(3))
                    && pw > 0
                    && ph > 0
                    && !grow(&mut px, &mut stride, pw, ph, &mut w, &mut h)
                {
                    return None;
                }
                continue;
            }
            b'#' => {
                let a = num(&mut i);
                color = a[0] as usize % 256;
                if a.len() >= 5 {
                    pal[color] = match a[1] {
                        1 => hls(a[2], a[3], a[4]),
                        _ => [pct(a[2]), pct(a[3]), pct(a[4])],
                    };
                }
                continue;
            }
            b'!' => {
                repeat = num(&mut i)[0].clamp(1, MAX_SIDE);
                let Some(&c) = body.get(i) else { break };
                i += 1;
                c
            }
            b'$' => {
                x = 0;
                continue;
            }
            b'-' => {
                x = 0;
                y += 6;
                continue;
            }
            c => c,
        };
        if !(0x3f..=0x7e).contains(&sixel) {
            continue;
        }
        let bits = sixel - 0x3f;
        if !grow(&mut px, &mut stride, x + repeat, y + 6, &mut w, &mut h) {
            return None;
        }
        let [r, g, bl] = pal[color];
        for dy in 0..6 {
            if bits & (1 << dy) == 0 {
                continue;
            }
            let row = (y + dy) as usize * stride as usize * 4;
            for dx in 0..repeat {
                let o = row + (x + dx) as usize * 4;
                px[o..o + 4].copy_from_slice(&[r, g, bl, 255]);
            }
        }
        x += repeat;
    }
    if w == 0 || h == 0 {
        return None;
    }
    // Crop the stride padding.
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    for r in 0..h as usize {
        let s = r * stride as usize * 4;
        out.extend_from_slice(&px[s..s + w as usize * 4]);
    }
    Some((w, h, out))
}

#[cfg(test)]
mod tests {
    use super::hls;

    #[test]
    fn hls_primaries() {
        // Sixel hue 120 = red, 240 = green, 0 = blue.
        assert_eq!(hls(120, 50, 100), [255, 0, 0]);
        assert_eq!(hls(240, 50, 100), [0, 255, 0]);
        assert_eq!(hls(0, 50, 100), [0, 0, 255]);
    }
}
