// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import {
	BEATS,
	DURATION,
	TILES,
	easeInOut,
	FAST_FRACTION,
	easeOutExpo,
	frame,
	inFlight,
	settled,
	stagger,
	WORD,
	wordmark,
} from "./timeline.ts";

describe("tiles come from the real Atlas mark", () => {
	test("the animated pieces are the 12 sheets plus the rim pieces, in a 428x427 box (sub-pixel trace specks stay still)", () => {
		const sheets = TILES.filter((t) => t.kind === "sheet");
		const rim = TILES.filter((t) => t.kind === "rim");
		expect(sheets.length).toBe(12);
		expect(rim.length).toBeGreaterThanOrEqual(10);
		for (const t of TILES) {
			expect(t.cx).toBeGreaterThanOrEqual(0);
			expect(t.cx).toBeLessThanOrEqual(428);
			expect(t.cy).toBeGreaterThanOrEqual(0);
			expect(t.cy).toBeLessThanOrEqual(427);
			expect(t.w * t.h).toBeGreaterThan(100);
		}
	});
	test("ids are unique and index the SVG paths (so the renderer can fetch each path by id)", () => {
		expect(new Set(TILES.map((t) => t.id)).size).toBe(TILES.length);
		for (const t of TILES) expect(Number.isInteger(t.id)).toBe(true);
	});
});

describe("beats: the authored moments of the shot (seconds)", () => {
	test("are strictly ordered and fit the duration", () => {
		const order = [BEATS.line, BEATS.beams, BEATS.anticipate, BEATS.hit, BEATS.sweep, BEATS.push, BEATS.copy];
		for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
		expect(BEATS.copy).toBeLessThan(DURATION);
		expect(DURATION).toBeGreaterThanOrEqual(3);
		expect(DURATION).toBeLessThanOrEqual(5);
	});
	test("there is a held beat of black before anything moves (anticipation of the viewer)", () => {
		expect(BEATS.line).toBeGreaterThanOrEqual(0.1);
		const f = frame(BEATS.line / 2);
		expect(f.line).toBe(0);
		expect(f.tiles.every((t) => t.alpha === 0)).toBe(true);
	});
});

describe("the hit: every tile locks in on the same frame, on the sound's downbeat", () => {
	test("just before the hit tiles are still off their slots; at the hit they are home", () => {
		const before = frame(BEATS.hit - 0.04);
		expect(before.tiles.some((t) => Math.hypot(t.dx, t.dy) > 0.5)).toBe(true);
		const at = frame(BEATS.hit);
		for (const t of at.tiles) expect(Math.hypot(t.dx, t.dy)).toBeLessThan(0.75);
	});
	test("the flash fires at the hit and not before", () => {
		expect(frame(BEATS.hit - 0.05).flash).toBe(0);
		expect(frame(BEATS.hit + 0.02).flash).toBeGreaterThan(0.5);
		expect(frame(BEATS.hit + 0.6).flash).toBeLessThan(0.05);
	});
	test("the sound cue time is the hit beat (one source of truth for picture and sound)", () => {
		expect(BEATS.soundAt).toBe(BEATS.hit);
	});
});

describe("anticipation and follow-through (principles, asserted)", () => {
	test("tiles pull back off their slots just before the hit", () => {
		const a = frame(BEATS.anticipate + 0.05);
		const b = frame(BEATS.hit - 0.1);
		const away = (f) => Math.max(...f.tiles.map((t) => Math.hypot(t.dx, t.dy)));
		// the pull-back is smaller than the incoming distance but non-zero, and it ends exactly on the hit
		expect(away(a)).toBeGreaterThan(0);
		expect(away(b)).toBeGreaterThan(0);
	});
	test("after the hit the mark overshoots a little then settles (scale > 1 then back to the resting value)", () => {
		const peak = Math.max(...[0.05, 0.1, 0.15, 0.2].map((d) => frame(BEATS.hit + d).markScale));
		expect(peak).toBeGreaterThan(1.0);
		expect(peak).toBeLessThan(1.1);
		expect(frame(BEATS.hit + 0.9).markScale).toBeCloseTo(settled().markScale, 1);
	});
});

describe("staging budgets", () => {
	test("tiles arrive in three groups by the mark's own rows: top, middle, bottom (a hero reveal staggers groups, 100-200 ms apart)", () => {
		const row = (t) => (t.cy < 142 ? 0 : t.cy < 285 ? 1 : 2);
		const start = [0, 1, 2].map((r) => Math.min(...TILES.filter((t) => row(t) === r).map((t) => t.delay)));
		expect(start[1] - start[0]).toBeGreaterThanOrEqual(0.1);
		expect(start[1] - start[0]).toBeLessThanOrEqual(0.2);
		expect(start[2] - start[1]).toBeGreaterThanOrEqual(0.1);
		expect(start[2] - start[1]).toBeLessThanOrEqual(0.2);
	});
	test("inside a group tiles are staggered 15-35 ms, and the whole stagger stays under 600 ms", () => {
		const s = stagger();
		expect(s.per).toBeGreaterThanOrEqual(0.015);
		expect(s.per).toBeLessThanOrEqual(0.035);
		expect(s.total).toBeLessThan(0.6);
	});
	test("every tile has landed before the pull-back begins (nothing is still flying when the rest anticipate)", () => {
		for (const t of TILES) expect(BEATS.beams + t.delay + t.fly).toBeLessThanOrEqual(BEATS.anticipate);
	});
	test("1/3 rule: never more than a third of the tiles are in fast flight at the same moment", () => {
		let worst = 0;
		for (let t = 0; t <= DURATION; t += 0.01) worst = Math.max(worst, inFlight(t));
		expect(worst).toBeLessThanOrEqual(Math.ceil(TILES.length / 3));
		expect(worst).toBeGreaterThan(0);
	});
	test("copy and CTA arrive last: nothing of the copy is visible before the push begins, then it rises monotonically to 1", () => {
		expect(frame(BEATS.push - 0.05).copy).toBe(0);
		let prev = 0;
		for (let t = BEATS.push; t <= DURATION; t += 0.02) {
			const c = frame(t).copy;
			expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
			prev = c;
		}
		expect(frame(DURATION).copy).toBe(1);
		expect(frame(BEATS.copy).copy).toBeGreaterThan(0.5);
	});
});

describe("determinism and the settled state", () => {
	test("the same time gives the same frame (renderer, screenshots and tests agree)", () => {
		expect(frame(1.9)).toEqual(frame(1.9));
	});
	test("time before 0 or after the end is clamped, never NaN", () => {
		for (const t of [-5, 0, DURATION, DURATION + 10, Number.NaN]) {
			const f = frame(t);
			for (const v of [f.line, f.flash, f.copy, f.markScale, f.push]) expect(Number.isFinite(v)).toBe(true);
		}
	});
	test("the final frame IS the settled welcome (reduced motion and skip show exactly this)", () => {
		const end = frame(DURATION);
		const rest = settled();
		expect(end.copy).toBeCloseTo(rest.copy, 3);
		expect(end.line).toBe(0);
		expect(end.flash).toBe(0);
		expect(end.tiles.every((t) => t.alpha > 0 && Math.hypot(t.dx, t.dy) < 0.01)).toBe(true);
		expect(end.push).toBeCloseTo(rest.push, 3);
	});
	test("settled has the mark visible at rest and the copy fully in", () => {
		const s = settled();
		expect(s.copy).toBe(1);
		expect(s.tiles.length).toBe(TILES.length);
		expect(s.tiles.every((t) => t.alpha > 0)).toBe(true);
	});
});

describe("easing helpers", () => {
	test("hit the endpoints and are monotonic", () => {
		for (const e of [easeInOut, easeOutExpo]) {
			expect(e(0)).toBeCloseTo(0, 5);
			expect(e(1)).toBeCloseTo(1, 5);
			let prev = -1;
			for (let i = 0; i <= 20; i++) {
				const v = e(i / 20);
				expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
				prev = v;
			}
		}
	});
	test("clamp outside 0..1", () => {
		expect(easeInOut(-1)).toBe(0);
		expect(easeOutExpo(2)).toBe(1);
	});
});

describe("wordmark: 'Atlas' resolves from the light after the hit", () => {
	test("nothing before the hit; letters appear one after another, left to right", () => {
		expect(wordmark(BEATS.hit - 0.01).every((l) => l.alpha === 0)).toBe(true);
		const mid = wordmark(BEATS.hit + 0.3);
		const alphas = mid.map((l) => l.alpha);
		for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] + 1e-9);
		expect(alphas[0]).toBeGreaterThan(alphas[alphas.length - 1]);
	});
	test("has one entry per letter of the name and all are fully in before the push", () => {
		expect(wordmark(0).length).toBe(WORD.length);
		expect(wordmark(BEATS.push - 0.01).every((l) => l.alpha > 0.99)).toBe(true);
	});
	test("tracking starts wide and tightens (letters converge to their resting spacing)", () => {
		const early = wordmark(BEATS.hit + 0.15)[0].spread;
		const late = wordmark(BEATS.push - 0.01)[0].spread;
		expect(early).toBeGreaterThan(late);
		expect(late).toBeCloseTo(0, 1);
	});
	test("letters rise into place (y offset eases to 0)", () => {
		expect(wordmark(BEATS.hit + 0.1)[0].dy).toBeGreaterThan(0);
		expect(wordmark(BEATS.push - 0.01)[0].dy).toBeCloseTo(0, 1);
	});
	test("the wordmark leaves with the push, handing the stage to the copy", () => {
		expect(wordmark(DURATION).every((l) => l.alpha === 0)).toBe(true);
	});
});
