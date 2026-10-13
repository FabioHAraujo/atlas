import { describe, expect, test } from "bun:test";
import { planCamera } from "../camera/plan.ts";
import { DEFAULT_LIMITS, type ResolvedFocus } from "../camera/types.ts";
import { ASPECTS, type AppClipScene } from "../lib/types.ts";
import { buildApp } from "./app.ts";

const ctx = { aspect: ASPECTS["9:16"], fps: 30, asset: (p: string) => p, esc: (s: string) => s };
const viewport = { x: 0, y: 450, w: 1080, h: 790 };
const focus: ResolvedFocus = { id: "f", at: 1, rect: { x: 700, y: 600, w: 360, h: 60 }, via: "ocr", textPx: 30 };
const frame = { source: { w: 2560, h: 1576 }, viewport, frame: { w: 1080, h: 1920 }, scale: 2 };
const camera = { keys: planCamera(frame, { minTextPx: 18, displayHeight: 844 }, DEFAULT_LIMITS, [focus], 5).keys, focuses: [focus] };
const scene: AppClipScene = { id: "panel", type: "app", clip: "rec:x", from: 1, duration: 5, crop: { x: 0, y: 4, w: 2560, h: 1576 }, box: { x: 0, y: 450, w: 1080 }, viewport, camera };
const proxy = { file: "assets/proxy-panel.mp4", aspect: 2560 / 1576, w: 2560, h: 1576 };

describe("an app scene with a camera", () => {
	const out = buildApp(scene, ctx, proxy);

	test("the clip box is the viewport (it clips the camera), the video sits in a camera wrapper inside it", () => {
		expect(out.html).toContain('id="clip" style="left:0px;top:450px;width:1080px;height:790px');
		expect(out.html).toMatch(/<div id="cam"[^>]*>\s*<video id="vid"/);
	});

	test("the video keeps its own pixel size (the camera scales it): no object-fit stretch to the viewport", () => {
		expect(out.html).toContain('width:2560px;height:1576px');
		expect(out.css).toContain("#cam{position:absolute;left:0;top:0;transform-origin:0 0");
	});

	test("the camera track is GSAP on #cam, not on #clip, and uses no push/pan", () => {
		expect(out.js).toContain('tl.set("#cam"');
		expect(out.js).not.toContain('"#clip",{scale');
	});

	test("the viewport has no rounded window of its own: the recording's bezel is the window", () => {
		expect(out.css).toContain("border-radius:0px");
	});

	test("without a camera the scene renders exactly as before (push/pan, box, radius): existing films are unchanged", () => {
		const legacy: AppClipScene = { ...scene, camera: undefined, viewport: undefined, push: { from: 1, to: 1.1 } };
		const o = buildApp(legacy, ctx, { file: proxy.file, aspect: proxy.aspect });
		expect(o.html).toContain('<video id="vid" class="clip"');
		expect(o.js).toContain('tl.fromTo("#clip",{scale:1}');
		expect(o.html).not.toContain('id="cam"');
	});
});
