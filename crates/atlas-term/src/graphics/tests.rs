//! Kitty and sixel decoding / store behavior.

use super::sixel::*;
use super::*;
use base64::Engine;

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

#[test]
fn kitty_rgb_chunked_transmit_and_display() {
    let mut s = Store::default();
    let px = b64(&[255, 0, 0, 0, 255, 0]);
    let (a, b) = px.split_at(4);
    let o = s.kitty(format!("a=T,f=24,s=2,v=1,i=7,m=1;{a}").as_bytes());
    assert!(o.reply.is_none() && o.place.is_none());
    let o = s.kitty(format!("m=0;{b}").as_bytes());
    assert_eq!(o.reply.as_deref(), Some("\x1b_Gi=7;OK\x1b\\"));
    let (p, _) = o.place.unwrap();
    assert_eq!((p.image, p.src), (7, [0, 0, 2, 1]));
    assert_eq!(*s.images[&7].rgba, [255, 0, 0, 255, 0, 255, 0, 255]);
}

#[test]
fn kitty_errors_and_quiet() {
    let mut s = Store::default();
    let o = s.kitty(b"a=p,i=3");
    assert_eq!(
        o.reply.as_deref(),
        Some("\x1b_Gi=3;ENOENT:no such image\x1b\\")
    );
    assert!(s.kitty(b"a=p,i=3,q=2").reply.is_none());
    // Short data, query action: error reply, nothing stored.
    let o = s.kitty(format!("a=q,f=32,s=2,v=2,i=1;{}", b64(&[0; 4])).as_bytes());
    assert!(o.reply.unwrap().contains("ENODATA"));
    assert!(s.images.is_empty());
    // No id: no reply at all.
    assert!(s.kitty(b"a=p").reply.is_none());
}

#[test]
fn kitty_png_and_delete() {
    let mut png_bytes = Vec::new();
    {
        let mut e = png::Encoder::new(&mut png_bytes, 1, 1);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[1, 2, 3])
            .unwrap();
    }
    let mut s = Store::default();
    let o = s.kitty(format!("a=T,f=100,i=9,q=1;{}", b64(&png_bytes)).as_bytes());
    assert!(o.reply.is_none());
    let (p, _) = o.place.unwrap();
    s.placements.push(p);
    assert_eq!(*s.images[&9].rgba, [1, 2, 3, 255]);
    s.kitty(b"a=d,d=I,i=9");
    assert!(s.placements.is_empty() && s.images.is_empty());
}

#[test]
fn sixel_colors_repeat_and_bands() {
    // Color 1 = pure red (RGB %), 3 columns of the top pixel, next band one full column.
    let (w, h, px) = decode_sixel(b"0;1;0q#1;2;100;0;0#1!3@-~").unwrap();
    assert_eq!((w, h), (3, 12));
    assert_eq!(&px[..4], &[255, 0, 0, 255]);
    assert_eq!(&px[8..12], &[255, 0, 0, 255]);
    // Row 1 (bit 1) is unset: transparent.
    assert_eq!(&px[12..16], &[0, 0, 0, 0]);
    // Second band: rows 6..12 of column 0 are set.
    assert_eq!(px[(6 * 3) * 4 + 3], 255);
    assert_eq!(px[(11 * 3) * 4 + 3], 255);
    assert!(decode_sixel(b"q").is_none());
}
