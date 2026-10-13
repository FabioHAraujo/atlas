// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { camera, ribbon } from "./ribbon.ts";

describe("ribbon: the light trail a tile leaves along its flight", () => {
	const tile = { from: { x: 600, y: -300 }, bow: 120 };
	test("starts at the tile's current offset and runs back toward where it came from", () => {
		const pts = ribbon(tile, { dx: 100, dy: -50 }, 12);
		expect(pts.length).toBe(12);
		expect(pts[0].x).toBeCloseTo(100, 5);
		expect(pts[0].y).toBeCloseTo(-50, 5);
		// the tail is farther from home than the head
		const d = (p) => Math.hypot(p.x, p.y);
		expect(d(pts[pts.length - 1])).toBeGreaterThan(d(pts[0]));
	});
	test("width tapers from the head to a point at the tail", () => {
		const pts = ribbon(tile, { dx: 100, dy: -50 }, 12);
		for (let i = 1; i < pts.length; i++) expect(pts[i].w).toBeLessThanOrEqual(pts[i - 1].w + 1e-9);
		expect(pts[pts.length - 1].w).toBeLessThan(0.15 * pts[0].w);
	});
	test("alpha fades toward the tail", () => {
		const pts = ribbon(tile, { dx: 100, dy: -50 }, 12);
		expect(pts[pts.length - 1].a).toBeLessThan(pts[0].a);
		for (const p of pts) {
			expect(p.a).toBeGreaterThanOrEqual(0);
			expect(p.a).toBeLessThanOrEqual(1);
		}
	});
	test("the trail bows with the tile's arc (it is a curve, not a straight line)", () => {
		const pts = ribbon(tile, { dx: 100, dy: -50 }, 12);
		const a = pts[0],
			b = pts[pts.length - 1],
			m = pts[6];
		const cross = Math.abs((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x));
		expect(cross).toBeGreaterThan(50);
	});
	// Storyboard v3: the trails read as small sparks. A ribbon is a streak of light: long and wide at the head.
	test("the trail is long: it reaches back at least 140 logo units for a tile that is still far out", () => {
		const pts = ribbon(tile, { dx: 400, dy: -200 }, 16);
		const span = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
		expect(span).toBeGreaterThan(140);
	});
	test("the head is wide enough to read as light at the mark's scale (>= 6 units half-width)", () => {
		expect(ribbon(tile, { dx: 400, dy: -200 }, 16)[0].w).toBeGreaterThanOrEqual(6);
	});
	test("a tile that has landed leaves no ribbon", () => {
		expect(ribbon(tile, { dx: 0, dy: 0 }, 12)).toEqual([]);
	});
});

describe("camera: the punch on the hit and the push into the mark", () => {
	test("rests at 1 before anything happens and after it has all settled", () => {
		expect(camera(0).zoom).toBe(1);
		expect(camera(0).shakeX).toBe(0);
	});
	test("the hit punches the camera in (zoom > 1) and shakes, then both decay to rest", () => {
		const hit = camera(1.7);
		expect(hit.zoom).toBeGreaterThan(1.02);
		const mag = (c) => Math.hypot(c.shakeX, c.shakeY);
		expect(Math.max(...[1.69, 1.71, 1.73, 1.76, 1.8].map((t) => mag(camera(t))))).toBeGreaterThan(0.5);
		expect(mag(camera(2.4))).toBeLessThan(0.01);
		expect(camera(2.4).zoom).toBeLessThan(hit.zoom);
	});
	test("shake is deterministic (screenshots and the live view agree)", () => {
		expect(camera(1.74)).toEqual(camera(1.74));
	});
	test("reduced shake scales it down without changing the zoom punch", () => {
		const full = camera(1.72, 1);
		const calm = camera(1.72, 0);
		expect(Math.hypot(calm.shakeX, calm.shakeY)).toBe(0);
		expect(calm.zoom).toBeCloseTo(full.zoom, 5);
	});
});
