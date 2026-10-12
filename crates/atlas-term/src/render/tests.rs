//! GPU-side checks (skipped when no adapter is available).

use super::gpu::{Uniforms, bind_layout, glyph_vertex_layout, gpu, pipeline};

/// The shader parses and validates, and the Rust uniform block matches the WGSL
/// struct (`U`: 2×vec2 + vec2 + vec2 + u32, 40 bytes), checked on the real device.
#[test]
fn shader_and_pipelines_validate() {
    let g = match gpu() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("no GPU adapter, skipping: {e}");
            return;
        }
    };
    eprintln!("validated on {:?}", g.adapter.get_info().name);
    assert_eq!(size_of::<Uniforms>(), 40);
    let d = &g.device;
    let scope = d.push_error_scope(wgpu::ErrorFilter::Validation);
    let shader = d.create_shader_module(wgpu::include_wgsl!("../term.wgsl"));
    let layout = bind_layout(d, wgpu::BufferSize::new(size_of::<Uniforms>() as u64));
    let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    for shaders in [
        ("glyph_vs", "glyph_fs"),
        ("color_glyph_vs", "color_glyph_fs"),
    ] {
        let _pipeline = pipeline(
            d,
            &shader,
            &pl,
            wgpu::TextureFormat::Bgra8Unorm,
            shaders.1,
            shaders,
            glyph_vertex_layout(),
        );
    }
    let err = pollster::block_on(scope.pop());
    assert!(err.is_none(), "{err:?}");
}
