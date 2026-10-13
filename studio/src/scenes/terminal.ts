import type { Rect, TerminalScene } from "../lib/types.ts";
import { placeBox } from "./app.ts";
import { type BuildCtx, type SceneOutput, titleCss, titleHtml } from "./base.ts";

/** The take fitted inside a viewport (contain), centered: even sizes, so the proxy encodes as H.264. */
export function fitInViewport(v: Rect, aspect: number): { x: number; y: number; w: number; h: number } {
	const w = Math.min(v.w, 2 * Math.floor((v.h * aspect) / 2));
	const h = 2 * Math.floor(w / aspect / 2);
	return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
}

/**
 * TerminalTake: a vhs take, cut to the dense segments by `prepare` (trim + concat + speed baked into the proxy), placed
 * centered on the field at the film's frame geometry.
 */
export function buildTerminal(s: TerminalScene, ctx: BuildCtx, proxy: { file: string; aspect: number }): SceneOutput {
	const b = s.viewport ? fitInViewport(s.viewport, proxy.aspect) : placeBox({ x: "center", y: s.y ?? "center", w: s.width }, ctx.aspect, proxy.aspect);
	const src = ctx.asset(proxy.file);
	const overlay = s.overlay ? titleHtml("overlay", s.overlay, ctx, 48) : "";
	return {
		html: `<div id="clip" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><video id="vid" class="clip" src="${src}" muted playsinline data-start="0" data-duration="${s.duration}" data-track-index="1" style="width:${b.w}px;height:${b.h}px"></video></div>${overlay}`,
		css: `${titleCss}
#clip{position:absolute;overflow:hidden}
#clip video{position:absolute;left:0;top:0;display:block;object-fit:fill}`,
		js: "",
	};
}
