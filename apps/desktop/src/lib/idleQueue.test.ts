// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, spyOn, test } from "bun:test";
import { createIdleQueue } from "./idleQueue.ts";

// Incident (selection stall): WKWebView has no requestIdleCallback, so `AfterIdle` fell back to one 50 ms timer and every
// deferred overlay of a layer (~8, 35 body nodes each pair) landed in ONE task right after the switch: the work moved by
// 50 ms, the stall (and the node churn the bench counts) did not shrink. Deferred work runs one item per task, and only
// once nothing has happened for a quiet window.
function harness(quietMs = 300) {
	let now = 0;
	const timers: { at: number; f: () => void; id: number }[] = [];
	let id = 0;
	const q = createIdleQueue({
		quietMs,
		now: () => now,
		setTimer: (f, ms) => {
			timers.push({ at: now + ms, f, id: ++id });
			return id;
		},
		clearTimer: (i) => {
			const k = timers.findIndex((t) => t.id === i);
			if (k >= 0) timers.splice(k, 1);
		},
	});
	/** Advance time, firing due timers in order (a timer may schedule the next one). */
	const run = (ms: number) => {
		const end = now + ms;
		for (;;) {
			timers.sort((a, b) => a.at - b.at);
			const t = timers[0];
			if (!t || t.at > end) break;
			timers.shift();
			now = Math.max(now, t.at);
			t.f();
		}
		now = end;
	};
	return { q, run, timers };
}

test("nothing runs before the quiet window has passed", () => {
	const { q, run } = harness();
	const ran: number[] = [];
	q.add(() => ran.push(1));
	run(299);
	expect(ran).toEqual([]);
	run(2);
	expect(ran).toEqual([1]);
});

test("one item per task: items queued together never run in the same timer callback", () => {
	const { q, run } = harness();
	const ran: number[] = [];
	for (const n of [1, 2, 3]) q.add(() => ran.push(n));
	run(301);
	expect(ran).toEqual([1]); // only the first fired in that window's first task
	run(1);
	expect(ran.length).toBeGreaterThanOrEqual(1);
	run(60);
	expect(ran).toEqual([1, 2, 3]);
});

test("activity pushes the window out: a selection (bump) restarts the quiet wait", () => {
	const { q, run } = harness();
	const ran: number[] = [];
	q.add(() => ran.push(1));
	run(250);
	q.bump();
	run(250);
	expect(ran).toEqual([]);
	run(60);
	expect(ran).toEqual([1]);
});

test("a bump between two items holds the rest back until quiet again", () => {
	const { q, run } = harness();
	const ran: number[] = [];
	for (const n of [1, 2]) q.add(() => ran.push(n));
	run(310);
	expect(ran).toEqual([1]);
	q.bump();
	run(100);
	expect(ran).toEqual([1]);
	run(250);
	expect(ran).toEqual([1, 2]);
});

test("cancel removes a queued item (the layer was unmounted before its turn)", () => {
	const { q, run } = harness();
	const ran: number[] = [];
	const a = q.add(() => ran.push(1));
	q.add(() => ran.push(2));
	a();
	run(400);
	expect(ran).toEqual([2]);
});

test("an idle queue leaves no timer behind (nothing polls while nothing is queued)", () => {
	const { q, run, timers } = harness();
	const c = q.add(() => {});
	run(400);
	expect(timers).toHaveLength(0);
	c();
	q.bump();
	expect(timers).toHaveLength(0);
});

test("an item that throws does not stop the rest", () => {
	const err = spyOn(console, "error").mockImplementation(() => {});
	const { q, run } = harness();
	const ran: number[] = [];
	q.add(() => {
		throw new Error("boom");
	});
	q.add(() => ran.push(2));
	run(500);
	expect(ran).toEqual([2]);
	expect(err).toHaveBeenCalledTimes(1);
	err.mockRestore();
});
