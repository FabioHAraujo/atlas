// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { GLOBE, KEY_LIGHT, normalAt, shade } from "./shade.ts";

describe("normalAt: a point of the logo seen as a point on a sphere", () => {
	test("the globe centre faces the viewer", () => {
		const n = normalAt(GLOBE.cx, GLOBE.cy);
		expect(n.z).toBeCloseTo(1, 5);
		expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
	});
	test("points to the right/up lean that way and stay unit length", () => {
		const r = normalAt(GLOBE.cx + GLOBE.r * 0.6, GLOBE.cy);
		expect(r.x).toBeGreaterThan(0.5);
		const u = normalAt(GLOBE.cx, GLOBE.cy - GLOBE.r * 0.6);
		expect(u.y).toBeLessThan(-0.5);
		for (const n of [r, u]) expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
	});
	test("points outside the disc clamp to the rim instead of producing NaN", () => {
		const n = normalAt(GLOBE.cx + GLOBE.r * 3, GLOBE.cy);
		expect(Number.isFinite(n.z)).toBe(true);
		expect(n.z).toBeGreaterThanOrEqual(0);
		expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
	});
});

describe("shade: light on the sphere", () => {
	test("the side facing the key light is brighter than the side facing away", () => {
		const lit = shade(normalAt(GLOBE.cx - GLOBE.r * 0.5, GLOBE.cy - GLOBE.r * 0.5));
		const dark = shade(normalAt(GLOBE.cx + GLOBE.r * 0.5, GLOBE.cy + GLOBE.r * 0.5));
		expect(lit.diffuse).toBeGreaterThan(dark.diffuse);
	});
	test("the key light comes from the upper left, in front", () => {
		expect(KEY_LIGHT.x).toBeLessThan(0);
		expect(KEY_LIGHT.y).toBeLessThan(0);
		expect(KEY_LIGHT.z).toBeGreaterThan(0);
		expect(Math.hypot(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z)).toBeCloseTo(1, 5);
	});
	test("rim light is ~0 at the centre and grows monotonically toward the edge", () => {
		expect(shade(normalAt(GLOBE.cx, GLOBE.cy)).rim).toBeLessThan(0.05);
		let prev = -1;
		for (const k of [0, 0.3, 0.5, 0.7, 0.85, 0.95]) {
			const rim = shade(normalAt(GLOBE.cx + GLOBE.r * k, GLOBE.cy)).rim;
			expect(rim).toBeGreaterThan(prev);
			prev = rim;
		}
		expect(shade(normalAt(GLOBE.cx + GLOBE.r * 0.95, GLOBE.cy)).rim).toBeGreaterThan(0.3);
	});
	test("specular is a tight glint: strong near the highlight, ~0 far from it", () => {
		const hi = normalAt(GLOBE.cx - GLOBE.r * 0.3, GLOBE.cy - GLOBE.r * 0.35);
		const far = normalAt(GLOBE.cx + GLOBE.r * 0.7, GLOBE.cy + GLOBE.r * 0.5);
		expect(shade(hi).spec).toBeGreaterThan(0.3);
		expect(shade(far).spec).toBeLessThan(0.02);
	});
	test("every term stays in 0..1 across the disc (no blown-out or negative light)", () => {
		for (let a = 0; a < Math.PI * 2; a += 0.5)
			for (const k of [0, 0.3, 0.6, 0.9, 1]) {
				const s = shade(normalAt(GLOBE.cx + Math.cos(a) * GLOBE.r * k, GLOBE.cy + Math.sin(a) * GLOBE.r * k));
				for (const v of [s.diffuse, s.rim, s.spec, s.total]) {
					expect(v).toBeGreaterThanOrEqual(0);
					expect(v).toBeLessThanOrEqual(1);
				}
			}
	});
});
