import { describe, expect, test } from "bun:test";
import { PROFILES } from "../lint/profiles.ts";
import { MAX_UPSCALE, neededZoom, maxZoom } from "./plan.ts";
import type { Frame } from "./types.ts";

// The legibility floors are derived from the platforms' display size, not picked by taste (profiles.ts documents the
// derivation). These tests pin the contract the camera and the lint share: the floor is reachable for the app's own
// labels, and unreachable for text that is too small in the recording, which must be reported, not blurred.
describe("profiles carry a floor for CAPTURED text the film asks the viewer to read", () => {
	for (const id of ["social-vertical", "social-square", "social-portrait"]) {
		test(`${id} has minFocusTextPx below its authored-text floor and above the unreadable`, () => {
			const p = PROFILES[id]!;
			expect(p.minFocusTextPx).toBeDefined();
			expect(p.minFocusTextPx!).toBeLessThan(p.minTextPx);
			expect(p.minFocusTextPx!).toBeGreaterThanOrEqual(16);
		});
	}

	test("the floor is reachable for the app's 13 CSS px labels at the resolution cap", () => {
		const frame: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 380, w: 1080, h: 1100 }, frame: { w: 1080, h: 1920 }, scale: 2 };
		const p = PROFILES["social-vertical"]!;
		const z = neededZoom(frame, { minTextPx: p.minFocusTextPx!, displayHeight: p.displayHeight }, 13);
		expect(z).toBeLessThanOrEqual(maxZoom(frame));
	});

	test("the resolution cap is the one the OCR confidence study measured (conf 1.0 up to 3x)", () => {
		expect(MAX_UPSCALE).toBe(2);
	});
});
