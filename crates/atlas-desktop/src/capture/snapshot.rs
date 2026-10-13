//! Deterministic page stills without ScreenCaptureKit: `WKWebView.takeSnapshot` renders the web
//! content itself, so it needs no Screen Recording permission and works while the window is
//! occluded. It captures the page only (no native title bar, vibrancy or shadow).

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2_app_kit::NSImage;
use objc2_foundation::NSError;
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
use tauri::{Runtime, Webview};

const WAIT: Duration = Duration::from_secs(15);

/// The part of the page to capture, in CSS px (view coordinates), and the device scale it is rendered at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}

/// `WKSnapshotConfiguration.snapshotWidth` is in POINTS: WebKit renders that width at the display scale, so the
/// image has `snapshotWidth * scale` pixels. Measured on a retina agent display: a 240x80 CSS rect with
/// `snapshotWidth = 480` gave 960x320 px, twice the picture asked for. To get the region at the display's native
/// pixel density the width is the region's CSS width, untouched by the scale.
pub fn snapshot_width(region: &Region) -> f64 {
    region.w.round().max(1.0)
}

/// Snapshot of `webview` (full page area, `after_screen_updates` = wait for pending layout) to a PNG.
pub fn page_png<R: Runtime>(webview: &Webview<R>, out: &Path) -> Result<(), String> {
    region_png(webview, None, out)
}

/// Snapshot of `region` of `webview` (the whole view when `None`), rendered at the region's device scale.
pub fn region_png<R: Runtime>(
    webview: &Webview<R>,
    region: Option<Region>,
    out: &Path,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let out = out.to_path_buf();
    webview
        .with_webview(move |pw| {
            let wk = pw.inner().cast::<WKWebView>();
            let block = RcBlock::new(move |img: *mut NSImage, e: *mut NSError| {
                // SAFETY: WebKit passes a valid image or a valid error for the callback's duration.
                let r = match unsafe { img.as_ref() } {
                    Some(i) => super::png::write_nsimage(i, &out),
                    None => Err(unsafe { e.as_ref() }
                        .map(|e| e.localizedDescription().to_string())
                        .unwrap_or_else(|| "WebKit returned no snapshot".into())),
                };
                let _ = tx.send(r);
            });
            // SAFETY: `inner()` is the live WKWebView*, and with_webview runs on the main thread.
            unsafe {
                let cfg = WKSnapshotConfiguration::new(
                    objc2::MainThreadMarker::new().expect("with_webview runs on the main thread"),
                );
                cfg.setAfterScreenUpdates(true);
                if let Some(r) = region {
                    cfg.setRect(objc2_foundation::NSRect::new(
                        objc2_foundation::NSPoint::new(r.x, r.y),
                        objc2_foundation::NSSize::new(r.w, r.h),
                    ));
                    cfg.setSnapshotWidth(Some(&objc2_foundation::NSNumber::new_f64(
                        snapshot_width(&r),
                    )));
                }
                (&*wk).takeSnapshotWithConfiguration_completionHandler(Some(&cfg), &block);
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(WAIT)
        .map_err(|_| "the webview did not produce a snapshot in time".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Incident (first agent run): rect and --full shots came out at twice the size (960x320 for a 240x80 rect on a
    /// 2x display) because the width was passed in pixels to an API that takes points.
    #[test]
    fn the_snapshot_width_is_the_regions_css_width_at_any_scale() {
        for scale in [1.0, 2.0, 3.0] {
            let r = Region {
                x: 0.0,
                y: 0.0,
                w: 240.0,
                h: 80.0,
                scale,
            };
            assert_eq!(snapshot_width(&r), 240.0, "scale {scale}");
        }
        // a fractional element width rounds, and a sliver never asks for a zero-width image
        assert_eq!(
            snapshot_width(&Region {
                x: 0.0,
                y: 0.0,
                w: 100.4,
                h: 5.0,
                scale: 2.0
            }),
            100.0
        );
        assert_eq!(
            snapshot_width(&Region {
                x: 0.0,
                y: 0.0,
                w: 0.2,
                h: 5.0,
                scale: 2.0
            }),
            1.0
        );
    }
}
