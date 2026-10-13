// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { cursorPath, easeInOutCubic, parseCombo, rectCenter } from "./motion.ts";

describe("easeInOutCubic", () => {
	test("starts at 0, ends at 1, is monotonic and symmetric around 0.5", () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(1)).toBe(1);
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
		let prev = -1;
		for (let i = 0; i <= 100; i++) {
			const v = easeInOutCubic(i / 100);
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
		expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 10);
	});

	test("out-of-range input is clamped, not extrapolated", () => {
		expect(easeInOutCubic(-3)).toBe(0);
		expect(easeInOutCubic(7)).toBe(1);
		expect(easeInOutCubic(Number.NaN)).toBe(0);
	});
});

describe("cursorPath", () => {
	test("begins exactly at the start, ends exactly at the target, in the requested number of steps", () => {
		const p = cursorPath({ x: 0, y: 0 }, { x: 300, y: 100 }, 20);
		expect(p.length).toBe(21);
		expect(p[0]).toEqual({ x: 0, y: 0 });
		expect(p[20]).toEqual({ x: 300, y: 100 });
	});

	test("eases: the first and last steps are shorter than the middle ones", () => {
		const p = cursorPath({ x: 0, y: 0 }, { x: 400, y: 0 }, 20);
		const d = (i) => Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
		expect(d(0)).toBeLessThan(d(10));
		expect(d(19)).toBeLessThan(d(10));
	});

	test("a human-looking arc: the path bows away from the straight line, but never past 12% of the distance", () => {
		const p = cursorPath({ x: 0, y: 0 }, { x: 500, y: 0 }, 40);
		const maxOff = Math.max(...p.map((q) => Math.abs(q.y)));
		expect(maxOff).toBeGreaterThan(0);
		expect(maxOff).toBeLessThanOrEqual(500 * 0.12 + 1e-9);
	});

	test("is deterministic (a re-run of a recipe must produce the same pointer path)", () => {
		const a = cursorPath({ x: 5, y: 9 }, { x: 80, y: 300 }, 30);
		const b = cursorPath({ x: 5, y: 9 }, { x: 80, y: 300 }, 30);
		expect(a).toEqual(b);
	});

	test("zero distance or one step degenerates safely", () => {
		expect(cursorPath({ x: 1, y: 1 }, { x: 1, y: 1 }, 10).every((q) => q.x === 1 && q.y === 1)).toBe(true);
		expect(cursorPath({ x: 0, y: 0 }, { x: 10, y: 10 }, 1)).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
		]);
		expect(cursorPath({ x: 0, y: 0 }, { x: 10, y: 10 }, 0).length).toBe(2);
	});
});

describe("rectCenter", () => {
	test("is the middle of the rect", () => {
		expect(rectCenter({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
	});
});

describe("parseCombo (the key steps: cmd-shift-p, ctrl-cmd-s, escape, --)", () => {
	test("modifiers and key", () => {
		expect(parseCombo("cmd-shift-p")).toEqual({
			key: "p",
			code: "KeyP",
			meta: true,
			shift: true,
			ctrl: false,
			alt: false,
		});
		expect(parseCombo("ctrl-cmd-s")).toMatchObject({ key: "s", meta: true, ctrl: true });
	});
	test("named keys map to DOM names", () => {
		expect(parseCombo("escape").key).toBe("Escape");
		expect(parseCombo("alt-cmd-right")).toMatchObject({ key: "ArrowRight", alt: true, meta: true });
		expect(parseCombo("enter").code).toBe("Enter");
	});
	test("digits and the minus key", () => {
		expect(parseCombo("cmd-1")).toMatchObject({ key: "1", code: "Digit1" });
		expect(parseCombo("cmd--")).toMatchObject({ key: "-", meta: true });
	});
	test("an unknown modifier is an error, not silently ignored", () => {
		expect(() => parseCombo("hyper-p")).toThrow(/modifier/);
		expect(() => parseCombo("")).toThrow();
	});
});
