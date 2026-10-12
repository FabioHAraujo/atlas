//! Inline images: the Kitty graphics protocol (APC `G`) and sixel (DCS `q`).
//! This module holds the decoded-image/placement store; `kitty` and `sixel` decode their
//! protocols into it. `vt` anchors placements to absolute grid lines and the renderer
//! draws them as textured quads.

mod kitty;
mod sixel;
#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use kitty::Cmd;

/// Decoded RGBA8 pixels. `gen` changes when the pixels under an id are replaced.
pub struct Image {
    pub w: u32,
    pub h: u32,
    pub rgba: Arc<Vec<u8>>,
    pub generation: u64,
}

/// An image shown on the grid. `line` counts from the top of the scrollback.
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub image: u32,
    pub id: u32,
    pub line: i64,
    pub col: u16,
    /// Cells covered (cursor movement, scroll-off).
    pub cols: u16,
    pub rows: u16,
    /// Drawn size in cells (fractional: natural-size images keep their pixel size).
    pub size: (f32, f32),
    /// Source rectangle in image pixels.
    pub src: [u32; 4],
    pub z: i32,
    /// Placed on the alternate screen (dropped when it exits).
    pub alt: bool,
}

/// Total decoded bytes kept (Kitty's default quota).
const QUOTA: usize = 320 << 20;
/// Largest image side accepted (Kitty and sixel).
const MAX_SIDE: u32 = 10_000;

#[derive(Default)]
pub struct Store {
    pub images: HashMap<u32, Image>,
    pub placements: Vec<Placement>,
    /// Insertion order for eviction.
    order: Vec<u32>,
    bytes: usize,
    next_generation: u64,
    /// Ids handed out to images transmitted without one (sixel, `I=`).
    next_auto: u32,
    /// Chunked Kitty transmission in progress (`m=1`).
    pending: Option<(Cmd, Vec<u8>)>,
    /// `I=` image number → newest id transmitted with it.
    numbers: HashMap<u32, u32>,
    /// Sixel images: no client id, freed once no placement shows them.
    transient: HashSet<u32>,
}

/// Where and how big the cursor-relative placement is, so `vt` can move the cursor.
pub struct Placed {
    pub cols: u16,
    pub rows: u16,
    /// Kitty `C=1`: leave the cursor alone.
    pub keep_cursor: bool,
}

pub struct Outcome {
    /// Reply for the pty (`ESC _ G … ESC \`).
    pub reply: Option<String>,
    /// A new placement at the cursor; `vt` fills in line/col and moves the cursor.
    pub place: Option<(Placement, Placed)>,
}

impl Store {
    fn auto_id(&mut self) -> u32 {
        // High ids, away from the small ones programs pick.
        self.next_auto = self.next_auto.wrapping_add(1).max(1);
        u32::MAX - self.next_auto
    }

    pub fn insert(&mut self, id: u32, w: u32, h: u32, rgba: Vec<u8>) {
        self.remove_image(id);
        self.next_generation += 1;
        self.bytes += rgba.len();
        self.order.push(id);
        self.images.insert(
            id,
            Image {
                w,
                h,
                rgba: Arc::new(rgba),
                generation: self.next_generation,
            },
        );
        // Evict the oldest images (and their placements) over the quota.
        while self.bytes > QUOTA && self.order.len() > 1 {
            let old = self.order[0];
            self.remove_image(old);
            self.placements.retain(|p| p.image != old);
        }
    }

    fn remove_image(&mut self, id: u32) {
        if let Some(img) = self.images.remove(&id) {
            self.bytes -= img.rgba.len();
            self.order.retain(|&i| i != id);
            self.transient.remove(&id);
        }
    }

    /// Drop placements made on the alternate screen (it was exited).
    pub fn clear_alt(&mut self) {
        self.placements.retain(|p| !p.alt);
        self.gc();
    }

    /// Images without placements and without an explicit client id are unreachable.
    fn gc(&mut self) {
        let used: HashSet<u32> = self.placements.iter().map(|p| p.image).collect();
        let dead: Vec<u32> = self
            .images
            .keys()
            .copied()
            .filter(|id| self.transient.contains(id) && !used.contains(id))
            .collect();
        for id in dead {
            self.remove_image(id);
        }
    }
}
