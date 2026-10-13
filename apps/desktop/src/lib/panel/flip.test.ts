// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { orderChanged, flipPlan } from "./flip.ts";

// Incident (gesture bench, first space switch of a cold instance: 1 forced layout, 22-32 ms stall): the service grid
// used Svelte's `animate:flip`, and Svelte measures EVERY cell (`getBoundingClientRect`) on EVERY reconcile of the
// keyed each, i.e. whenever a service row's data changes (cpu, state, ticker), not only when cards move. The measure
// lands on DOM writes of the same flush: a forced layout per update, per mounted layer. Animating is only needed
// when the order of the keys changed, so that is the one thing that may trigger a measure.

describe("orderChanged", () => {
	test("the same keys in the same order is not a change, whatever the rows carry", () => {
		expect(orderChanged(["a", "b", "c"], ["a", "b", "c"])).toBe(false);
		expect(orderChanged([], [])).toBe(false);
	});
	test("a reorder, an insertion and a removal are changes", () => {
		expect(orderChanged(["a", "b", "c"], ["b", "a", "c"])).toBe(true);
		expect(orderChanged(["a", "b"], ["a", "b", "c"])).toBe(true);
		expect(orderChanged(["a", "b", "c"], ["a", "c"])).toBe(true);
	});
	test("no previous order (first render) animates nothing", () => {
		expect(orderChanged(null, ["a", "b"])).toBe(false);
	});
});

describe("flipPlan", () => {
	const r = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 50 });
	test("a card that moved gets the inverse translation to play from; one that stayed gets none", () => {
		const plan = flipPlan(
			{ a: r(0, 0), b: r(100, 0), c: r(200, 0) },
			{ a: r(0, 0), b: r(200, 0), c: r(100, 0) },
		);
		expect(plan).toEqual({ b: { dx: -100, dy: 0 }, c: { dx: 100, dy: 0 } });
	});
	test("a card that is new (no before) or gone (no after) is not animated", () => {
		expect(flipPlan({ a: r(0, 0) }, { a: r(0, 0), n: r(100, 0) })).toEqual({});
		expect(flipPlan({ a: r(0, 0), g: r(100, 0) }, { a: r(0, 0) })).toEqual({});
	});
	test("sub-pixel jitter is not a move", () => {
		expect(flipPlan({ a: r(0, 0) }, { a: r(0.2, 0.1) })).toEqual({});
	});
});
