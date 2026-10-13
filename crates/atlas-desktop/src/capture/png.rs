//! PNG encoding of the images AppKit and ScreenCaptureKit hand back (macOS).

use std::path::Path;

use objc2::AnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_core_graphics::CGImage;
use objc2_foundation::NSDictionary;

fn save(rep: &NSBitmapImageRep, out: &Path) -> Result<(), String> {
    // SAFETY: plain encode of a live bitmap rep; no properties.
    let data = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or("could not encode the PNG")?;
    std::fs::write(out, data.to_vec()).map_err(|e| format!("writing {}: {e}", out.display()))
}

pub fn write_cgimage(img: &CGImage, out: &Path) -> Result<(), String> {
    save(
        &NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), img),
        out,
    )
}

/// PNG of an `NSImage` at its largest bitmap representation (the pixel size, not the point size).
pub fn write_nsimage(img: &NSImage, out: &Path) -> Result<(), String> {
    // SAFETY: the image is alive for the call; null hints/context are allowed.
    let cg = unsafe { img.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) }
        .ok_or("the snapshot has no bitmap")?;
    write_cgimage(&cg, out)
}
