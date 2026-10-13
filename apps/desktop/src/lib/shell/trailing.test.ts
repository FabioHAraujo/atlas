// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { trailing } from "./trailing.ts";

/** A manual clock: timers fire when `advance` passes them. */
function clock() {
	let now = 0;
	let timers = [];
	return {
		set: (f, ms) => {
			const t = { f, at: now + ms };
			timers.push(t);
			return t;
		},
		clear: (t) => (timers = timers.filter((x) => x !== t)),
		advance(ms) {
			now += ms;
			const due = timers.filter((t) => t.at <= now);
			timers = timers.filter((t) => t.at > now);
			for (const t of due) t.f();
		},
	};
}

test("a burst of calls runs once, ms after the LAST call", () => {
	const c = clock();
	let n = 0;
	const f = trailing(() => n++, 100, c.set, c.clear);
	f();
	c.advance(60);
	f();
	c.advance(60);
	expect(n).toBe(0); // 120 ms since the first call, but only 60 since the last
	c.advance(50);
	expect(n).toBe(1);
	c.advance(1000);
	expect(n).toBe(1);
});

test("a call after it ran starts a new wait", () => {
	const c = clock();
	let n = 0;
	const f = trailing(() => n++, 100, c.set, c.clear);
	f();
	c.advance(100);
	f();
	c.advance(99);
	expect(n).toBe(1);
	c.advance(1);
	expect(n).toBe(2);
});

test("cancel drops the pending run", () => {
	const c = clock();
	let n = 0;
	const f = trailing(() => n++, 100, c.set, c.clear);
	f();
	f.cancel();
	c.advance(500);
	expect(n).toBe(0);
});

import { availability } from "./trailing.ts";

test("availability is a stable signature of what the engine needs to know about an entry", () => {
	const a = availability({ can: (d) => d === 1, pinned: () => true });
	expect(availability({ can: (d) => d === 1, pinned: () => true })).toBe(a);
	expect(availability({ can: (d) => d === -1, pinned: () => true })).not.toBe(a);
	expect(availability({ can: () => true })).not.toBe(availability({ can: () => true, pinned: () => true }));
});

import { availabilityKey } from "./trailing.ts";

test("a push is needed only when what the engine is told changed: availability of any entry or the entry set", () => {
	const e = (can) => ({ spec: { can, pinned: undefined } });
	const a = [e((d) => d === 1), e(() => true)];
	const key = availabilityKey(a);
	// same answers, new closures (a re-render): no push
	expect(availabilityKey([e((d) => d === 1), e(() => true)])).toBe(key);
	// the first space gained a previous neighbour: push
	expect(availabilityKey([e(() => true), e(() => true)])).not.toBe(key);
	// an entry came or went: push
	expect(availabilityKey([a[0]])).not.toBe(key);
});
