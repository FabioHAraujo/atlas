// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { assess, BUDGET, type Run } from "./gestureProbe.ts";

const clean = (over: Partial<Run> = {}): Run => ({
	trace: "t",
	expect: { zone: "space", steps: 1 },
	start: "b",
	end: "c",
	order: ["a", "b", "c", "d"],
	committed: ["c"],
	frames: Array.from({ length: 60 }, (_, i) => ({ t: i * 16.7, gap: 16.7 })),
	stalls: [],
	reflows: 0,
	settleMs: 310,
	samples: [0, 0.2, 0.5, 0.8, 1].map((a, i) => ({ t: i * 70, x: -a })),
	firstMoveMs: 8,
	native: { parked: 1, restored: 1 },
	consistent: true,
	...over,
});
const names = (r: Run) => assess(r, { hz: 60 }).map((v) => v.rule);

test("a clean run has no violations", () => {
	expect(names(clean())).toEqual([]);
});

test("the committed page must be exactly the expected one: never two steps, never the wrong one", () => {
	expect(names(clean({ end: "a", committed: ["a"] }))).toContain("wrong-target");
	expect(names(clean({ end: "d", committed: ["c", "d"] }))).toContain("wrong-target"); // two steps
	expect(names(clean({ end: "b", committed: [] }))).toContain("wrong-target");
	expect(names(clean({ committed: ["c", "b", "c"] }))).toContain("double-commit");
	// The sidebar wraps: from the last space, next is the first.
	expect(names(clean({ start: "d", end: "a", committed: ["a"] }))).toEqual([]);
});

test("a trace that expects nothing must leave selection and layers alone", () => {
	const r = clean({
		expect: { zone: "space", steps: 0, untouched: true },
		end: "b",
		committed: [],
		samples: [],
	});
	expect(names(r)).toEqual([]);
	expect(names({ ...r, samples: [{ t: 0, x: -0.2 }] })).toContain("moved-when-untouched");
});

test("frame gaps over the budget, stalls and long tasks during the gesture are violations", () => {
	const slow = clean({
		frames: [
			{ t: 0, gap: 16.7 },
			{ t: 40, gap: 41 },
		],
	});
	expect(names(slow)).toContain("frame-gap");
	expect(names(clean({ stalls: [{ t: 100, ms: 30 }] }))).toContain("stall");
});

test("the frame-gap budget is relative to the display: 1.2 frames + 3 ms", () => {
	expect(BUDGET.gap(60)).toBeCloseTo(23, 0);
	expect(BUDGET.gap(120)).toBeCloseTo(13, 0);
});

test("tracking must follow the gesture monotonically toward the target; a bounce is a violation", () => {
	const bounce = clean({ samples: [0, 0.3, 0.6, 0.4, 0.9, 1].map((a, i) => ({ t: i * 60, x: -a })) });
	expect(names(bounce)).toContain("non-monotonic");
	// An allowed reversal: the trace says the finger reversed.
	const rev = clean({
		expect: { zone: "space", steps: -1 },
		start: "b",
		end: "a",
		committed: ["a"],
		samples: [0, -0.1, -0.3, 0.2, 0.7, 1].map((a, i) => ({ t: i * 60, x: -a })),
		reversal: true,
	});
	expect(names(rev)).not.toContain("non-monotonic");
});

test("a settle outside 250-350 ms is a violation; overshoot past the target is too", () => {
	expect(names(clean({ settleMs: 480 }))).toContain("settle-time");
	expect(names(clean({ settleMs: 120 }))).toContain("settle-time");
	expect(names(clean({ samples: [0, 0.5, 1.04, 1].map((a, i) => ({ t: i * 70, x: -a })) }))).toContain(
		"overshoot",
	);
});

test("input to first moved frame is bounded by one frame of the display", () => {
	expect(names(clean({ firstMoveMs: 40 }))).toContain("first-move");
	expect(assess(clean({ firstMoveMs: 17 }), { hz: 60 }).map((v) => v.rule)).not.toContain("first-move");
});

test("forced reflows during the gesture, natives left parked and an inconsistent end state are violations", () => {
	expect(names(clean({ reflows: 3 }))).toContain("layout-thrash");
	expect(names(clean({ native: { parked: 2, restored: 1 } }))).toContain("native-not-restored");
	expect(names(clean({ consistent: false }))).toContain("inconsistent-end-state");
});

test("the engine's own decisions are held to the expectation apart from where the app ended up", () => {
	// Engine said +1 for a trace that must not switch: an engine/trace problem, whatever the app did.
	const r = clean({
		expect: { zone: "space", steps: 0 },
		engineCommits: [[1, 1]],
		start: "b",
		end: "b",
		committed: [],
	});
	expect(names(r)).toContain("engine-decision");
	// Right decision, wrong landing: only the app-side rule fires.
	const landed = clean({ engineCommits: [[1, 1]], end: "d", committed: ["c", "d"] });
	expect(names(landed)).not.toContain("engine-decision");
	expect(names(landed)).toContain("wrong-target");
	// One decision per generation, each at most one page.
	expect(
		names(
			clean({
				engineCommits: [
					[1, 1],
					[1, 1],
				],
			}),
		),
	).toContain("engine-decision");
	expect(names(clean({ engineCommits: [[1, 2]] }))).toContain("engine-decision");
	expect(names(clean({ engineCommits: [[1, 1]] }))).toEqual([]);
});

import { bestRun, isTimingOnly } from "./gestureProbe.ts";

const viol = (...rules: string[]) => rules.map((rule) => ({ rule, detail: "" }));

test("a failure that is only timing (frames, stalls, first move) may be noise; a wrong page never is", () => {
	expect(isTimingOnly(viol("frame-gap", "stall"))).toBe(true);
	expect(isTimingOnly(viol("frame-gap", "wrong-target"))).toBe(false);
	expect(isTimingOnly(viol("engine-decision"))).toBe(false);
	expect(isTimingOnly(viol("layout-thrash"))).toBe(false); // deterministic: forced layouts do not depend on load
	expect(isTimingOnly(viol("settle-time"))).toBe(false);
	expect(isTimingOnly([])).toBe(false);
});

test("the best of several attempts: a clean one wins, else the one with the fewest violations", () => {
	const a = { v: viol("frame-gap", "stall") };
	const b = { v: viol("frame-gap") };
	const c = { v: [] };
	expect(bestRun([a, b])).toBe(b);
	expect(bestRun([a, c, b])).toBe(c);
	expect(bestRun([a])).toBe(a);
});

import { noiseFloor } from "./gestureProbe.ts";

test("the host's noise floor is its own idle jitter: p95 frame gap and the longest stall of a quiet page", () => {
	const idle = {
		frames: [16.7, 16.7, 17, 16.6, 40, 16.7, 16.8, 16.7, 16.7, 16.7].map((gap, i) => ({ t: i * 17, gap })),
		stalls: [{ t: 5, ms: 12 }],
	};
	const f = noiseFloor(idle);
	expect(f.gapP95).toBeGreaterThanOrEqual(17);
	expect(f.worstStall).toBe(12);
	// an idle page with nothing in it has no floor to speak of
	expect(noiseFloor({ frames: [], stalls: [] })).toEqual({ gapP95: 0, worstStall: 0, frames: 0 });
});

test("a loaded host raises the bar for timing rules only: a gap or stall within the floor is not the app's", () => {
	const floor = { gapP95: 30, worstStall: 40, frames: 100 };
	const slow = clean({
		frames: [
			{ t: 0, gap: 16.7 },
			{ t: 40, gap: 41 },
		],
		stalls: [{ t: 9, ms: 35 }],
	});
	expect(assess(slow, { hz: 60 }).map((v) => v.rule)).toEqual(expect.arrayContaining(["frame-gap", "stall"]));
	// held to the floor instead of the ideal budget: a 41 ms gap on a host that idles at p95 30 is 1.4× its noise
	expect(assess(slow, { hz: 60, floor }).map((v) => v.rule)).not.toContain("stall");
	// deterministic rules ignore the floor entirely
	expect(assess(clean({ reflows: 2 }), { hz: 60, floor }).map((v) => v.rule)).toContain("layout-thrash");
	expect(assess(clean({ end: "d", committed: ["c", "d"] }), { hz: 60, floor }).map((v) => v.rule)).toContain(
		"wrong-target",
	);
});

import { ReadCounter } from "./gestureProbe.ts";

test("a layout read is a forced layout only when the DOM changed since the last one (style/layout were invalidated)", () => {
	let pending = 0;
	const c = new ReadCounter(() => pending);
	c.read("a.js:1"); // clean DOM: the browser answers from the last layout
	c.read("a.js:1");
	expect(c.forced).toBe(0);
	expect(c.reads).toBe(2);
	pending = 3; // mutations queued since the last read: this read has to recalc layout
	c.read("b.js:9");
	expect(c.forced).toBe(1);
	// the first dirty read flushed it (the mutations are now accounted for): the next one is clean again
	pending = 0;
	c.read("b.js:9");
	expect(c.forced).toBe(1);
	expect(c.sites).toEqual({ "b.js:9": 1 });
});

// Incident (bench, two-quick-swipes): "overshoot 1.000 pages past the target". Samples are the origin page's position
// in page widths and accumulate across gestures (a second gesture continues from the landing of the first), so a
// +2 run legitimately ends at -2. The target of the overshoot rule is the whole net distance, not one page.
test("a multi-gesture run ends at -steps pages: reaching it is not an overshoot, passing it is", () => {
	const two = (xs: number[]) =>
		clean({
			expect: { steps: 2, gestures: 2 } as never,
			end: "c",
			start: "a",
			order: ["a", "b", "c", "d", "e"],
			committed: ["b", "c"],
			settleMs: 300,
			samples: xs.map((x, i) => ({ t: i * 70, x })),
		});
	expect(names(two([0, -0.5, -1, -1.4, -2]))).not.toContain("overshoot");
	expect(names(two([0, -0.5, -1, -1.4, -2.04, -2]))).toContain("overshoot");
	// backwards, three pages
	const back = clean({
		expect: { steps: -3, gestures: 3 } as never,
		start: "e",
		end: "b",
		order: ["a", "b", "c", "d", "e"],
		committed: ["d", "c", "b"],
		settleMs: 300,
		samples: [0, 1, 2, 3].map((x, i) => ({ t: i * 70, x })),
	});
	expect(names(back)).not.toContain("overshoot");
	// a single page is unchanged
	expect(names(clean({ samples: [0, 0.5, 1.04, 1].map((a, i) => ({ t: i * 70, x: -a })) }))).toContain(
		"overshoot",
	);
});
