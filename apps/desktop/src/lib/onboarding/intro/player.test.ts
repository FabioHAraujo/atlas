// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { SIGNATURE_PREROLL, backing, loopMode, needsResize, pageIsFocused, plan, tick } from "./player.ts";
import { BEATS, DURATION } from "./timeline.ts";

describe("plan: whether and how the intro plays", () => {
	test("plays once on a true first run", () => {
		expect(plan({ seen: false, reducedMotion: false, webgl: true })).toEqual({ mode: "play", sound: true });
	});
	test("never replays once seen (the flag is persisted by the caller)", () => {
		expect(plan({ seen: true, reducedMotion: false, webgl: true }).mode).toBe("settled");
	});
	test("reduced motion shows the settled welcome at once and stays silent", () => {
		expect(plan({ seen: false, reducedMotion: true, webgl: true })).toEqual({
			mode: "settled",
			sound: false,
		});
	});
	test("without a canvas 2D context there is nothing to paint: settled (the HTML welcome stands alone)", () => {
		expect(plan({ seen: false, reducedMotion: false, webgl: false }).mode).toBe("settled");
	});
});

describe("tick: the clock of the intro (frame-rate independent, skippable)", () => {
	const start = { t: 0, state: "running" as const, soundFired: false };
	test("advances by the frame's dt, clamped so a stall cannot jump the hit", () => {
		expect(tick(start, 0.016, false).t).toBeCloseTo(0.016, 5);
		expect(tick(start, 5, false).t).toBeLessThan(0.1);
	});
	test("fires the signature once, SIGNATURE_PREROLL seconds before the hit, never again", () => {
		let s = { ...start, t: BEATS.hit - SIGNATURE_PREROLL - 0.02 };
		s = tick(s, 0.016, false);
		expect(s.soundFired).toBe(false);
		s = tick(s, 0.016, false);
		expect(s.soundFired).toBe(true);
		expect(tick(s, 0.016, false).fireSound).toBeUndefined();
		const fired = tick({ ...start, t: BEATS.hit - SIGNATURE_PREROLL - 0.001 }, 0.016, false);
		expect(fired.fireSound).toBe(true);
	});
	test("ends at the duration and holds the last frame (state done)", () => {
		const s = tick({ ...start, t: DURATION - 0.005 }, 0.1, false);
		expect(s.t).toBe(DURATION);
		expect(s.state).toBe("done");
		expect(tick(s, 0.1, false)).toEqual(s);
	});
	test("skip jumps to the end at once; a skip before the hit never plays the sound (it would land on a black screen)", () => {
		const s = tick({ ...start, t: 0.5 }, 0.016, true);
		expect(s.state).toBe("done");
		expect(s.t).toBe(DURATION);
		expect(s.fireSound).toBeUndefined();
	});
	test("a skip after the signature fired lets it ring (cutting a bell off is worse than letting it finish)", () => {
		const s = tick({ ...start, t: BEATS.hit + 0.3, soundFired: true }, 0.016, true);
		expect(s.state).toBe("done");
		expect(s.stopSound).toBeUndefined();
	});
});

describe("loopMode: when the paint loop may run (carried over from the deleted constellation)", () => {
	test("animates only when visible, focused and motion is allowed", () => {
		expect(loopMode({ visible: true, focused: true, reducedMotion: false })).toBe("animate");
	});
	test("hidden or unfocused pauses (no GPU/CPU burn behind another window)", () => {
		expect(loopMode({ visible: false, focused: true, reducedMotion: false })).toBe("pause");
		expect(loopMode({ visible: true, focused: false, reducedMotion: false })).toBe("pause");
	});
	test("reduced motion draws one still frame, but a hidden canvas still pauses", () => {
		expect(loopMode({ visible: true, focused: true, reducedMotion: true })).toBe("static");
		expect(loopMode({ visible: false, focused: true, reducedMotion: true })).toBe("pause");
	});
});

describe("pageIsFocused: an agent instance has no focus and must still play", () => {
	// Incident (first agent-mode welcome recording): the intro stayed black and `[data-intro=done]` never came,
	// because loopMode() pauses an unfocused window and an agent instance is never focused by design.
	test("a normal window is as focused as the document says", () => {
		expect(pageIsFocused(true, false)).toBe(true);
		expect(pageIsFocused(false, false)).toBe(false);
	});
	test("an agent instance counts as focused, so its intro plays and records", () => {
		expect(pageIsFocused(false, true)).toBe(true);
		expect(loopMode({ visible: true, focused: pageIsFocused(false, true), reducedMotion: false })).toBe(
			"animate",
		);
	});
	test("it is still paused when hidden: only the focus requirement is waived", () => {
		expect(loopMode({ visible: false, focused: pageIsFocused(false, true), reducedMotion: false })).toBe(
			"pause",
		);
	});
});

describe("backing: the canvas buffer must always match its CSS box", () => {
	// Incident (live app, first run): the intro painted into a 640x420 corner of the window. The buffer was sized once at
	// mount, while the canvas still had its 300x150 default box, and never re-sized when layout settled.
	test("scales the CSS box by the device pixel ratio, capped at 2, to whole pixels", () => {
		expect(backing(1280, 820, 2)).toEqual({ w: 2560, h: 1640, dpr: 2 });
		expect(backing(1280, 820, 3)).toEqual({ w: 2560, h: 1640, dpr: 2 });
		expect(backing(333.4, 100.6, 1)).toEqual({ w: 333, h: 101, dpr: 1 });
	});
	test("a zero or missing box has no backing (nothing to paint yet)", () => {
		expect(backing(0, 820, 2)).toBeNull();
		expect(backing(1280, 0, 2)).toBeNull();
		expect(backing(Number.NaN, 820, 2)).toBeNull();
	});
	test("a bad pixel ratio falls back to 1", () => {
		expect(backing(100, 100, 0)?.dpr).toBe(1);
		expect(backing(100, 100, Number.NaN)?.dpr).toBe(1);
	});
	test("needsResize is true exactly when the buffer differs from what the box needs", () => {
		const b = backing(1280, 820, 2);
		expect(needsResize({ width: 2560, height: 1640 }, b)).toBe(false);
		expect(needsResize({ width: 300, height: 150 }, b)).toBe(true);
		expect(needsResize({ width: 2560, height: 1640 }, null)).toBe(false);
	});
});
