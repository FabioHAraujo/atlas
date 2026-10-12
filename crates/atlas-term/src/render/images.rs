//! Inline images on the GPU: one texture per image (re-uploaded when its generation
//! changes, LRU-evicted), one quad per placement, drawn under or over the text.

use super::Renderer;
use super::gpu::{Gpu, ImgInst, bind_group, texture};
use crate::vt::Frame;

/// Uploaded image: re-uploaded when the image's generation changes.
pub(super) struct Tex {
    generation: u64,
    bind: wgpu::BindGroup,
    last_frame: u64,
}

/// Textures kept for images not on screen (scrolling back re-shows them).
const TEX_CACHE: usize = 32;

impl Renderer {
    /// Ensure a texture per visible image and build one quad per placement.
    pub(super) fn upload_images(&mut self, g: &Gpu, f: &Frame) {
        let [cw, ch] = self.text.font.cell;
        self.img_insts.clear();
        for im in &f.images {
            let fresh = self
                .textures
                .get(&im.image)
                .is_some_and(|t| t.generation == im.generation);
            if !fresh {
                let tex = texture(
                    &g.device,
                    "image",
                    (im.w, im.h),
                    wgpu::TextureFormat::Rgba8Unorm,
                );
                g.queue.write_texture(
                    tex.as_image_copy(),
                    &im.rgba,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(im.w * 4),
                        rows_per_image: None,
                    },
                    tex.size(),
                );
                let view = tex.create_view(&Default::default());
                let bind = bind_group(
                    &g.device,
                    Some("image"),
                    &self.layout,
                    &self.uniforms,
                    &view,
                    &self.linear,
                );
                self.textures.insert(
                    im.image,
                    Tex {
                        generation: im.generation,
                        bind,
                        last_frame: 0,
                    },
                );
            }
            if let Some(t) = self.textures.get_mut(&im.image) {
                t.last_frame = self.timing.frames + 1;
            }
            let [sx, sy, sw, sh] = im.src;
            let (iw, ih) = (im.w as f32, im.h as f32);
            self.img_insts.push(ImgInst {
                pos: [im.col * cw, im.row * ch],
                size: [im.cols * cw, im.rows * ch],
                uv0: [sx as f32 / iw, sy as f32 / ih],
                uv1: [(sx + sw) as f32 / iw, (sy + sh) as f32 / ih],
            });
        }
        // Evict the least recently shown textures beyond the cache size.
        while self.textures.len() > TEX_CACHE.max(f.images.len()) {
            let Some(&old) = self
                .textures
                .iter()
                .min_by_key(|(_, t)| t.last_frame)
                .map(|(id, _)| id)
            else {
                break;
            };
            self.textures.remove(&old);
        }
    }

    pub(super) fn draw_images(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        f: &Frame,
        range: std::ops::Range<usize>,
    ) {
        if range.is_empty() {
            return;
        }
        pass.set_pipeline(&self.img_pipe);
        let n = (self.img_insts.len() * size_of::<ImgInst>()) as u64;
        pass.set_vertex_buffer(0, self.imgs.buf.slice(..n));
        for i in range {
            if let Some(t) = self.textures.get(&f.images[i].image) {
                pass.set_bind_group(0, &t.bind, &[]);
                pass.draw(0..4, i as u32..i as u32 + 1);
            }
        }
        // Glyphs and decorations sample the atlas.
        pass.set_bind_group(0, &self.bind, &[]);
    }
}
