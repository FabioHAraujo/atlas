import { describe, expect, test } from "bun:test";
import { cameraProxySize } from "./proxy.ts";
import type { CameraKey } from "./types.ts";

const key = (zoom: number): CameraKey => ({ t: 0, x: 0, y: 0, zoom, ease: "hold", move: 0 });

// The proxy must carry the pixels the camera will show. At zoom z the viewport (w px) shows source.w/z source px, so a
// proxy narrower than w*z upscales (soft); wider than the source is waste (and slower to decode).
describe("cameraProxySize: pixels the deepest zoom needs, never more than the source, always even", () => {
	const source = { w: 2560, h: 1576 };

	test("the deepest zoom decides: 1080 wide viewport at zoom 2.4 needs ~2592 px, capped at the source's 2560", () => {
		expect(cameraProxySize(source, 1080, [key(1), key(2.4)])).toEqual({ w: 2560, h: 1576 });
	});

	test("a shallow camera gets a smaller proxy (faster render): zoom 1.2 on 1080 needs 1296 px", () => {
		const p = cameraProxySize(source, 1080, [key(1), key(1.2)]);
		expect(p.w).toBe(1296);
		expect(p.h).toBe(798);
	});

	test("both sides are even (H.264 yuv420p) and keep the source's aspect", () => {
		const p = cameraProxySize(source, 1080, [key(1.37)]);
		expect(p.w % 2).toBe(0);
		expect(p.h % 2).toBe(0);
		expect(p.w / p.h).toBeCloseTo(source.w / source.h, 2);
	});

	test("a camera that never zooms still gets at least the viewport's own width", () => {
		expect(cameraProxySize(source, 1080, [key(1)]).w).toBe(1080);
	});
});
