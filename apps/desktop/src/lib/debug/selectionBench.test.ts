// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { BUDGET, check, pct, summarize, waitQuiet } from "./selectionBench.ts";

// Incident: a space selection stalled the main thread 44-50 ms (measured, 13 spaces) because the pager mounted a whole
// neighbour layer (~357 nodes, a dozen tooltips) inside the commit. These tests pin the budget that keeps it fixed.
const sample = (o = {}) => ({ flushMs: 2, paintMs: 30, stallMs: 3, nodes: 60, records: 100, ...o });
const many = (n, f) => Array.from({ length: n }, (_, i) => sample(f(i)));

describe("percentiles are nearest-rank, so one outlier cannot hide in a p95", () => {
	test("p50 / p95 / max of 1..20", () => {
		const xs = Array.from({ length: 20 }, (_, i) => i + 1);
		expect([pct(xs, 0.5), pct(xs, 0.95), pct(xs, 1)]).toEqual([10, 19, 20]);
	});
	test("unsorted input, a single value, and an empty list", () => {
		expect(pct([9, 1, 5], 0.5)).toBe(5);
		expect(pct([7], 0.95)).toBe(7);
		expect(pct([], 0.95)).toBe(0);
	});
});

describe("check: the budget a selection must stay inside", () => {
	test("a cheap selection passes", () => {
		expect(check(summarize(many(40, () => ({}))))).toEqual([]);
	});
	test("the measured baseline (flush 12, stall 31, a layer of nodes churned) fails on all three counts", () => {
		const bad = check(summarize(many(40, () => ({ flushMs: 12, stallMs: 31, nodes: 603 }))));
		expect(bad).toHaveLength(3);
		expect(bad.join(" ")).toMatch(/stall.*flush.*nodes/);
	});
	test("p95, not the mean: 3 slow selections out of 40 break the budget", () => {
		const s = summarize(many(40, (i) => ({ stallMs: i < 3 ? 60 : 2 })));
		expect(s.stallMs.p50).toBe(2);
		expect(check(s)).toHaveLength(1);
	});
	test("one slow selection in 40 is inside p95 (a lone GC pause is not a regression)", () => {
		expect(check(summarize(many(40, (i) => ({ stallMs: i === 7 ? 60 : 2 }))))).toEqual([]);
	});
	test("exactly on the budget passes; one step over fails", () => {
		expect(check(summarize(many(20, () => ({ stallMs: BUDGET.stallP95Ms }))))).toEqual([]);
		expect(check(summarize(many(20, () => ({ stallMs: BUDGET.stallP95Ms + 0.5 }))))).toHaveLength(1);
	});
	test("a bench that measured nothing never passes", () => {
		expect(check(summarize([]))).toEqual(["no selections were measured"]);
	});
});

describe("summarize", () => {
	test("rounds to 0.1 ms and reports max", () => {
		const s = summarize([sample({ flushMs: 1.234 }), sample({ flushMs: 9.876 })]);
		expect(s.flushMs).toEqual({ p50: 1.2, p95: 9.9, max: 9.9 });
		expect(s.n).toBe(2);
	});
});

// Incident: the bench slept a fixed 120 ms after each selection, but a space switch schedules follow-up work later
// (deferred overlays after a 300 ms quiet window, native snapshot warm-up). It leaked into the NEXT sample or was never
// counted, so two runs of the same build disagreed (stall p95 25 vs 60). A selection owns everything it causes.
describe("waitQuiet: attribute late work to the selection that caused it", () => {
	const clock = () => {
		let t = 0;
		return { now: () => t, sleep: async (ms: number) => void (t += ms) };
	};
	test("returns once nothing has happened for the quiet window", async () => {
		const c = clock();
		let lastEvent = 0;
		const waited = await waitQuiet({
			...c,
			lastEvent: () => lastEvent,
			quietMs: 250,
			maxMs: 3000,
			stepMs: 50,
		});
		expect(waited).toBeGreaterThanOrEqual(250);
		expect(waited).toBeLessThan(400);
	});
	test("activity restarts the window: late work (at 400 ms) keeps the sample open until 400 + quiet", async () => {
		const c = clock();
		const lastEvent = () => (c.now() < 400 ? c.now() : 400);
		const waited = await waitQuiet({ ...c, lastEvent, quietMs: 250, maxMs: 3000, stepMs: 50 });
		expect(waited).toBeGreaterThanOrEqual(650);
	});
	test("never waits forever: a page that never settles is cut at maxMs", async () => {
		const c = clock();
		const waited = await waitQuiet({ ...c, lastEvent: () => c.now(), quietMs: 250, maxMs: 1000, stepMs: 50 });
		expect(waited).toBeLessThanOrEqual(1050);
	});
});
