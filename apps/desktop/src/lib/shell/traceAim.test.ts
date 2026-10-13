// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { aim, type LiveZone } from "./traceAim.ts";
import { synth } from "./trace.ts";

const zones: LiveZone[] = [
	{ zone: "history", rect: { x: 8, y: 8, w: 1264, h: 774 }, prev: true, next: true, pinned: true },
	{ zone: "tab", id: "g1", rect: { x: 268, y: 40, w: 1000, h: 740 }, prev: true, next: true, pinned: false },
	{ zone: "space", rect: { x: 8, y: 8, w: 260, h: 774 }, prev: true, next: true, pinned: false },
];
const ev = synth({ x: 1, y: 1, travel: -100, ms: 100, seed: 1 });

test("a trace is aimed at the middle of the zone it is meant for, every sample", () => {
	const s = aim(ev, "sidebar", zones)!;
	expect(new Set(s.map((e) => `${e.x},${e.y}`))).toEqual(new Set(["138,395"]));
	const t = aim(ev, "strip", zones)!;
	// the strip is the top band of the tab group: its y is inside the first 32 px of the group
	expect(t[0].x).toBe(768);
	expect(t[0].y).toBeGreaterThanOrEqual(40);
	expect(t[0].y).toBeLessThan(80);
});

test("the content aim lands where only the history zone (not a tab group) is under the pointer", () => {
	const p = aim(ev, "history", zones)!;
	const inTab = p[0].x >= 268 && p[0].x < 1268 && p[0].y >= 40;
	expect(inTab).toBe(false);
	expect(p[0].x).toBeGreaterThanOrEqual(8);
});

test("an outside aim is above every zone (the titlebar), and a missing zone is reported, not guessed", () => {
	const o = aim(ev, "outside", zones)!;
	expect(o[0].y).toBeLessThan(8);
	expect(
		aim(
			ev,
			"sidebar",
			zones.filter((z) => z.zone !== "space"),
		),
	).toBeNull();
});

test("aiming keeps timing, phases and deltas untouched", () => {
	const s = aim(ev, "sidebar", zones)!;
	expect(s.map((e) => [e.t, e.phase, e.dx, e.dy])).toEqual(ev.map((e) => [e.t, e.phase, e.dx, e.dy]));
});
