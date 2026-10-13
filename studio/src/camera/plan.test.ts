import { describe, expect, test } from "bun:test";
import { ease, neededZoom, planCamera, poseAt, shownTextPx, spring } from "./plan.ts";
import { DEFAULT_LIMITS, type Frame, type Legibility, type ResolvedFocus } from "./types.ts";

// The real geometry of the 9:16 cut: the app window is 2560x1576 source px (retina, 2 px per CSS px), shown in a
// 1080 px wide viewport; the platform asks for a 28 px glyph band at 844 px display height (profiles.ts social-vertical).
const frame: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 380, w: 1080, h: 1100 }, frame: { w: 1080, h: 1920 }, scale: 2 };
const legible: Legibility = { minTextPx: 28, displayHeight: 844 };

const focus = (id: string, at: number, rect: { x: number; y: number; w: number; h: number }, over: Partial<ResolvedFocus> = {}): ResolvedFocus => ({ id, at, rect, via: "timeline", ...over });

describe("legibility rule: zoom until the text reaches the target's glyph band", () => {
	test("needed zoom makes the shown glyph band equal the minimum, at the display height", () => {
		const z = neededZoom(frame, legible, 12);
		expect(shownTextPx(frame, legible, 12, z)).toBeCloseTo(28, 1);
	});

	test("12 CSS px text on a phone needs ~3x the 'whole window fits' zoom: the rule is real, not decorative", () => {
		// fit = 1080/2560 = 0.42; band = 12*2*0.8 = 19.2 src px; minOut = 28*1920/844 = 63.7 px -> z = 63.7 / (19.2*0.42) = 7.9
		expect(neededZoom(frame, legible, 12)).toBeGreaterThan(7);
	});

	test("bigger source text needs less zoom, proportionally", () => {
		expect(neededZoom(frame, legible, 24)).toBeCloseTo(neededZoom(frame, legible, 12) / 2, 5);
	});

	test("a shorter display (the square feed) asks for a different size than the phone: the rule is per target", () => {
		const square: Frame = { ...frame, viewport: { x: 0, y: 120, w: 1080, h: 760 }, frame: { w: 1080, h: 1080 } };
		const a = neededZoom(square, { minTextPx: 24, displayHeight: 540 }, 12);
		const b = neededZoom(frame, legible, 12);
		expect(a).not.toBeCloseTo(b, 1);
	});
});

describe("zoom is capped by the source's resolution: never upscale past the recording's pixels", () => {
	test("a focus whose text would need more than the cap is planned at the cap and flagged short", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("f", 1, { x: 500, y: 500, w: 400, h: 60 })], 5);
		const f = cam.report[0]!;
		expect(f.zoom).toBeLessThanOrEqual(f.maxZoom + 1e-9);
		// 12 CSS px at 2x on a 1080 viewport: fit*zoom <= 1.25 -> zoom <= 2.96, far under the 7.9 the rule asks for
		expect(f.neededZoom).toBeGreaterThan(f.maxZoom);
		expect(f.legible).toBe(false);
	});

	test("text that is big enough in the source is legible at an in-range zoom", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("f", 1, { x: 500, y: 500, w: 400, h: 60 }, { textPx: 34 })], 5);
		expect(cam.report[0]!.legible).toBe(true);
	});
});

describe("the camera never shows outside the source", () => {
	test("a focus in the corner is framed with the viewport clamped inside the source", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("f", 1, { x: 0, y: 0, w: 200, h: 40 }, { textPx: 34 })], 5);
		const k = cam.keys.find((x) => x.focus === "f")!;
		const halfW = frame.source.w / k.zoom / 2;
		const halfH = frame.viewport.h / (frame.viewport.w / frame.source.w) / k.zoom / 2;
		expect(k.x - halfW).toBeGreaterThanOrEqual(-1e-6);
		expect(k.y - halfH).toBeGreaterThanOrEqual(-1e-6);
	});

	test("the focus rect stays inside the viewport at its zoom whenever it fits", () => {
		const r = { x: 1200, y: 700, w: 500, h: 80 };
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("f", 1, r, { textPx: 34 })], 5);
		const out = cam.report[0]!.outRect;
		expect(out.x).toBeGreaterThanOrEqual(frame.viewport.x - 1e-6);
		expect(out.x + out.w).toBeLessThanOrEqual(frame.viewport.x + frame.viewport.w + 1e-6);
		expect(out.y).toBeGreaterThanOrEqual(frame.viewport.y - 1e-6);
		expect(out.y + out.h).toBeLessThanOrEqual(frame.viewport.y + frame.viewport.h + 1e-6);
	});
});

describe("motion-design limits (an agent that edits the film cannot make a whip pan)", () => {
	const near = [focus("a", 0.6, { x: 800, y: 600, w: 300, h: 50 }, { textPx: 34 }), focus("b", 3.5, { x: 1200, y: 760, w: 300, h: 50 }, { textPx: 34 })];

	test("pan speed between two nearby focuses stays under maxPanPxPerSec at every instant", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, near, 6);
		const fit = frame.viewport.w / frame.source.w;
		let worst = 0;
		for (let t = 0; t < 6; t += 1 / 60) {
			const a = poseAt(cam.keys, t);
			const b = poseAt(cam.keys, t + 1 / 60);
			worst = Math.max(worst, (Math.hypot(b.x - a.x, b.y - a.y) * fit * ((a.zoom + b.zoom) / 2) * 60));
		}
		expect(worst).toBeLessThanOrEqual(DEFAULT_LIMITS.maxPanPxPerSec * 1.02);
	});

	test("zoom rate stays under maxZoomPerSec at every instant", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, near, 6);
		let worst = 0;
		for (let t = 0; t < 6; t += 1 / 60) {
			const a = poseAt(cam.keys, t);
			const b = poseAt(cam.keys, t + 1 / 60);
			worst = Math.max(worst, Math.abs(Math.log(b.zoom / a.zoom)) * 60);
		}
		expect(worst).toBeLessThanOrEqual(DEFAULT_LIMITS.maxZoomPerSec * 1.02);
	});

	test("far focuses are CUT, not whip-panned: the arrival is instant", () => {
		const far = [focus("a", 0.6, { x: 100, y: 100, w: 300, h: 50 }, { textPx: 34 }), focus("b", 3.5, { x: 2300, y: 1450, w: 200, h: 50 }, { textPx: 34 })];
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, far, 6);
		const arrive = cam.keys.find((k) => k.focus === "b")!;
		expect(arrive.ease).toBe("cut");
		expect(arrive.move).toBe(0);
	});

	test("the camera settles: it is still for `settle` seconds before the focus' text must be read", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, near, 6);
		const arrive = cam.keys.find((k) => k.focus === "b")!;
		const readable = cam.report[1]!.from;
		expect(arrive.t + arrive.move).toBeLessThanOrEqual(readable - DEFAULT_LIMITS.settle + 1e-6);
	});

	test("a focus asked too soon for the camera to get there and settle is delayed, not rushed past the limit", () => {
		const rushed = [focus("a", 0.3, { x: 800, y: 600, w: 300, h: 50 }, { textPx: 34 }), focus("b", 0.8, { x: 1500, y: 900, w: 300, h: 50 }, { textPx: 34 })];
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, rushed, 6);
		expect(cam.report[1]!.from).toBeGreaterThan(0.8);
		expect(cam.report[1]!.delayed).toBe(true);
	});
});

describe("easing curves are closed-form and seekable", () => {
	test("every ease starts at 0, ends at 1 and is monotone", () => {
		for (const kind of ["ease", "spring"] as const) {
			expect(ease(kind, 0)).toBeCloseTo(0, 6);
			expect(ease(kind, 1)).toBeCloseTo(1, 3);
		}
		let prev = -1;
		for (let i = 0; i <= 100; i++) {
			const v = ease("ease", i / 100);
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
	});

	test("a critically damped spring never overshoots; a bouncy one does", () => {
		const max = (bounce: number) => Math.max(...Array.from({ length: 200 }, (_, i) => spring(i / 199, bounce)));
		expect(max(0)).toBeLessThanOrEqual(1 + 1e-9);
		expect(max(0.4)).toBeGreaterThan(1.001);
	});

	test("poseAt is a pure function of time: same keys, same pose, any order of calls", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("a", 1, { x: 800, y: 600, w: 300, h: 50 }, { textPx: 34 })], 5);
		const a = poseAt(cam.keys, 2.2);
		poseAt(cam.keys, 0.1);
		expect(poseAt(cam.keys, 2.2)).toEqual(a);
	});
});

describe("hold-on-subject: a focus keeps the camera still for its whole hold", () => {
	test("the pose is identical from arrival to the end of the hold", () => {
		const cam = planCamera(frame, legible, DEFAULT_LIMITS, [focus("a", 1, { x: 800, y: 600, w: 300, h: 50 }, { textPx: 34, hold: 2 })], 6);
		const r = cam.report[0]!;
		expect(poseAt(cam.keys, r.from)).toEqual(poseAt(cam.keys, r.to));
	});
});

describe("a pan that would take too long is a cut (the viewer must not wait for the camera)", () => {
	// A phone-legible 18 px floor (the focus floor) on the 790 px tall viewport: zoom ~2, so two focuses 1300 source
	// px apart are ~1100 output px away: under cutDistancePx (1400) but 3.3 s at 700 px/s.
	const tall: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 450, w: 1080, h: 790 }, frame: { w: 1080, h: 1920 }, scale: 2 };
	const floor: Legibility = { minTextPx: 18, displayHeight: 844 };

	test("a move longer than maxMoveSeconds cuts, even when it is under cutDistancePx", () => {
		const far = [focus("a", 1, { x: 100, y: 100, w: 360, h: 60 }, { textPx: 30 }), focus("b", 4, { x: 2400, y: 1500, w: 360, h: 60 }, { textPx: 30 })];
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, far, 8);
		const b = cam.keys.find((k) => k.focus === "b")!;
		expect(b.ease).toBe("cut");
		expect(b.move).toBe(0);
	});

	test("no planned move is longer than maxMoveSeconds", () => {
		const many = [focus("a", 1, { x: 800, y: 600, w: 360, h: 60 }, { textPx: 30 }), focus("b", 4, { x: 1700, y: 1100, w: 360, h: 60 }, { textPx: 30 }), focus("c", 7, { x: 300, y: 300, w: 360, h: 60 }, { textPx: 30 })];
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, many, 10);
		for (const k of cam.keys) expect(k.move).toBeLessThanOrEqual(DEFAULT_LIMITS.maxMoveSeconds + 1e-9);
	});

	test("a short pan under maxMoveSeconds still pans", () => {
		const near = [focus("a", 1, { x: 800, y: 600, w: 360, h: 60 }, { textPx: 30 }), focus("b", 4, { x: 1000, y: 700, w: 360, h: 60 }, { textPx: 30 })];
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, near, 8);
		expect(cam.keys.find((k) => k.focus === "b")!.ease).not.toBe("cut");
	});
});

describe("a focus wider than the viewport at the legible zoom: frame the rect, flag the shortfall", () => {
	// A 2000 px wide row (a whole agent line) cannot be at 4.6x in a 1080 px viewport: showing half of it is worse than
	// showing all of it smaller. The planner shrinks the zoom to FIT the rect (with 4% margin) and reports `legible:false`
	// so the lint can say the row is too long to read at this size, instead of silently cropping the text.
	test("the focus rect is fully inside the viewport and the report says it is not legible", () => {
		const wideFocus = focus("row", 1, { x: 300, y: 700, w: 1800, h: 50 }, { textPx: 30 });
		const cam = planCamera(frame, { minTextPx: 18, displayHeight: 844 }, DEFAULT_LIMITS, [wideFocus], 6);
		const r = cam.report[0]!;
		expect(r.overflows).toBe(false);
		expect(r.outRect.w).toBeLessThanOrEqual(frame.viewport.w * 0.96 + 1e-6);
		expect(r.zoom).toBeLessThan(r.neededZoom);
		expect(r.legible).toBe(false);
	});

	test("a focus that fits at its legible zoom is not shrunk", () => {
		const small = focus("s", 1, { x: 300, y: 700, w: 300, h: 50 }, { textPx: 30 });
		const cam = planCamera(frame, { minTextPx: 18, displayHeight: 844 }, DEFAULT_LIMITS, [small], 6);
		expect(cam.report[0]!.zoom).toBeCloseTo(cam.report[0]!.neededZoom, 6);
	});
});

describe("a focus must be readable INSIDE the shot (incident: the 9:16 social cut's push-in took 5.4 s of a 5 s shot)", () => {
	// Incident: v1 asked 4.67x with the zoom limit of 0.9 e-folds/s, so the move took 5.38 s and the text was "readable"
	// at 5.73 s: after the shot had ended. The lint then OCR'd the NEXT scene and called the focus empty.
	const tall: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 450, w: 1080, h: 790 }, frame: { w: 1080, h: 1920 }, scale: 2 };
	const floor: Legibility = { minTextPx: 18, displayHeight: 844 };

	test("a focus that cannot be held before the shot ends is reported as `late` (asked too near the end, or crowded out by the previous hold)", () => {
		const crowded = [focus("a", 0.9, { x: 500, y: 600, w: 250, h: 50 }, { textPx: 34, hold: 2 }), focus("b", 2.5, { x: 700, y: 650, w: 250, h: 50 }, { textPx: 34, hold: 2 })];
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, crowded, 5);
		expect(cam.report[1]!.to).toBeGreaterThan(5);
		expect(cam.report[1]!.late).toBe(true);
	});

	test("a focus that fits the shot is not late", () => {
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, [focus("a", 0.9, { x: 500, y: 600, w: 250, h: 50 }, { textPx: 34 })], 5);
		expect(cam.report[0]!.late).toBe(false);
	});

	test("the opening push-in may be a CUT to the first focus when the shot is too short to travel (a thumbnail still opens on the window)", () => {
		const cam = planCamera(tall, floor, { ...DEFAULT_LIMITS, maxMoveSeconds: 1.2 }, [focus("a", 0.9, { x: 500, y: 600, w: 250, h: 50 }, { textPx: 13 })], 5);
		const r = cam.report[0]!;
		expect(r.late).toBe(false);
		expect(cam.keys[1]!.ease).toBe("cut");
	});
});

describe("the focus is framed inside the platform's safe rect, not just the viewport (incident: 'left by 1px' on both 9:16 focuses at the source's left edge)", () => {
	const tall: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 450, w: 1080, h: 790 }, frame: { w: 1080, h: 1920 }, scale: 2 };
	const floor: Legibility = { minTextPx: 18, displayHeight: 844 };
	const safe = { x: 65, y: 269, w: 864, h: 1171 };

	test("a focus clamped at the source's left edge is nudged right by the margin the safe rect needs", () => {
		const f = focus("left", 1, { x: 40, y: 700, w: 300, h: 50 }, { textPx: 30 });
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, [f], 6, { safe });
		const r = cam.report[0]!.outRect;
		expect(r.x).toBeGreaterThanOrEqual(safe.x - 1e-6);
		expect(r.x + r.w).toBeLessThanOrEqual(safe.x + safe.w + 1e-6);
	});

	test("without a safe rect the planner behaves as before (the viewport is the limit)", () => {
		const f = focus("left", 1, { x: 40, y: 700, w: 300, h: 50 }, { textPx: 30 });
		const a = planCamera(tall, floor, DEFAULT_LIMITS, [f], 6);
		const b = planCamera(tall, floor, DEFAULT_LIMITS, [f], 6, {});
		expect(a.keys).toEqual(b.keys);
	});

	test("a focus wider than the safe rect is fitted to it (96%), like one wider than the viewport", () => {
		const f = focus("wide", 1, { x: 300, y: 700, w: 1100, h: 50 }, { textPx: 30 });
		const cam = planCamera(tall, floor, DEFAULT_LIMITS, [f], 6, { safe });
		expect(cam.report[0]!.outRect.w).toBeLessThanOrEqual(safe.w * 0.96 + 1e-6);
	});
});
