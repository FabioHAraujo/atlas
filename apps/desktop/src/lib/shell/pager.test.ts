// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { beforeEach, expect, test } from "bun:test";
import { rubber, springAt, springDuration, spacePager } from "./pager.ts";

// Bun has no animation frames: a manual queue, stepped by `frame()`.
let queue = [];
let nextId = 1;
globalThis.requestAnimationFrame = (f) => (queue.push([nextId, f]), nextId++);
globalThis.cancelAnimationFrame = (id) => (queue = queue.filter(([i]) => i !== id));
const frame = () => {
	const q = queue;
	queue = [];
	for (const [, f] of q) f(0);
};

/** Let the pager's `await host.flush()` continuations run (microtasks only, no wall clock). */
const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("rubber band is linear inside a page and saturates past it", () => {
	expect(rubber(0.4)).toBe(0.4);
	expect(rubber(-1)).toBe(-1);
	expect(rubber(1.5)).toBeGreaterThan(1);
	expect(rubber(1.5)).toBeLessThan(1.15 + 1e-9);
	expect(rubber(40)).toBeLessThanOrEqual(1.15);
	expect(rubber(-2)).toBe(-rubber(2));
});

test("the spring starts where it was released, never overshoots, and lands on the target", () => {
	let max = 0;
	for (const [x0, v0] of [
		[0.3, 0],
		[0.3, 2],
		[0.9, 5],
		[-0.2, -1],
	]) {
		expect(springAt(x0, v0, 1, 0)).toBeCloseTo(x0, 9);
		for (let t = 0; t < 1.5; t += 0.005) max = Math.max(max, springAt(x0, v0, 1, t));
		expect(springAt(x0, v0, 1, 3)).toBeCloseTo(1, 4);
	}
	// A flick released at 0.9 with high velocity may cross the target only by the critically-damped bump (small).
	expect(max).toBeLessThan(1.1);
});

test("settle time is short (~0.3-0.5 s) and shrinks with a faster release", () => {
	const slow = springDuration(0.4, 0, 1);
	const fast = springDuration(0.4, 4, 1);
	expect(slow).toBeGreaterThan(0.2);
	expect(slow).toBeLessThan(0.7);
	expect(fast).toBeLessThanOrEqual(slow);
});

// ---- protocol: track / settle / go against a fake host ----

class Layer {
	style = {
		transform: "",
		removeProperty(p) {
			if (p === "transform") this.transform = "";
		},
	};
	animations = [];
	animate(frames, opts) {
		const a = {
			frames,
			opts,
			cancelled: false,
			finished: Promise.withResolvers().promise,
			cancel: () => (a.cancelled = true),
		};
		this.animations.push(a);
		return a;
	}
}

let host, layers, committed, moving;
beforeEach(() => {
	queue = [];
	layers = { a: new Layer(), b: new Layer(), z: new Layer() };
	committed = [];
	moving = [];
	let active = "a";
	host = {
		layer: (id) => layers[id],
		width: () => 1000,
		ids: () => ["a", "b", "z"],
		active: () => active,
		commit: (id) => {
			active = id;
			committed.push(id);
		},
		moving: (on, keep) => moving.push([on, keep]),
		flush: () => Promise.resolve(),
	};
	spacePager.attach(host)();
	spacePager.attach(host);
});

test("track moves the current layer by -amount·W and the incoming one next to it, with no state change", () => {
	spacePager.track(0.25);
	expect(layers.a.style.transform).toBe("translate3d(-250px,0,0)");
	expect(layers.b.style.transform).toBe("translate3d(750px,0,0)");
	expect(spacePager.active).toBe(true);
	expect(committed).toEqual([]);
	expect(moving[0]).toEqual([true, ["a", "b"]]);
});

test("a negative amount heads to the previous space (wrapping at the first)", () => {
	spacePager.track(-0.5);
	expect(layers.a.style.transform).toBe("translate3d(500px,0,0)");
	expect(layers.z.style.transform).toBe("translate3d(-500px,0,0)");
});

test("settle(dir) commits the selection once, right away, and animates both layers from the live offset", () => {
	spacePager.track(0.4);
	spacePager.settle(1);
	expect(committed).toEqual(["b"]);
	// AppKit frames keep arriving: no spring of ours yet.
	expect(layers.a.animations.length).toBe(0);
	spacePager.track(0.7);
	expect(layers.a.style.transform).toBe("translate3d(-700px,0,0)");
	// ...and while they do, our spring never starts.
	frame();
	spacePager.track(0.8);
	frame();
	expect(layers.a.animations.length).toBe(0);
});

test("two frames of silence after the decision hand the settle to our spring, from the live offset", () => {
	spacePager.track(0.4);
	spacePager.settle(1);
	frame();
	frame();
	expect(layers.a.animations.length).toBe(1);
	expect(layers.a.animations[0].frames[0].transform).toBe("translate3d(-400px,0,0)");
	expect(layers.a.animations[0].frames.at(-1).transform).toBe("translate3d(-1000px,0,0)");
	expect(layers.b.animations[0].frames.at(-1).transform).toBe("translate3d(0px,0,0)");
});

test("track(0) after tracking without a decision is a cancel: layers return to rest", async () => {
	spacePager.track(0.2);
	spacePager.track(0);
	expect(committed).toEqual([]);
	await settle();
	expect(layers.a.style.transform).toBe("");
	expect(layers.b.style.transform).toBe("");
	expect(spacePager.active).toBe(false);
	expect(moving.at(-1)).toEqual([false]);
});

test("frames reaching ±1 after a commit finish the switch", async () => {
	spacePager.track(0.6);
	spacePager.settle(1);
	spacePager.track(1);
	await settle();
	expect(committed).toEqual(["b"]);
	expect(spacePager.active).toBe(false);
	expect(layers.a.style.transform).toBe("");
});

test("go() commits first, then slides both layers with one animation each", () => {
	expect(spacePager.go("b")).toBe(true);
	expect(committed).toEqual(["b"]);
	expect(layers.a.animations.length).toBe(1);
	expect(layers.b.animations.length).toBe(1);
	const [first, last] = [layers.a.animations[0].frames[0], layers.a.animations[0].frames.at(-1)];
	expect(first.transform).toBe("translate3d(0px,0,0)");
	expect(last.transform).toBe("translate3d(-1000px,0,0)");
	// The incoming layer starts one page to the right and ends at rest.
	expect(layers.b.animations[0].frames[0].transform).toBe("translate3d(1000px,0,0)");
	expect(layers.b.animations[0].frames.at(-1).transform).toBe("translate3d(0px,0,0)");
});

test("go() to the active space or with no host does nothing", () => {
	expect(spacePager.go("a")).toBe(false);
	expect(committed).toEqual([]);
});

test("go(id, origin) animates without committing (the selection already moved)", () => {
	expect(spacePager.go("b", "a")).toBe(true);
	expect(committed).toEqual([]);
});

test("a decision against the gesture's heading retargets to the other neighbour", () => {
	spacePager.track(0.3);
	spacePager.settle(-1);
	expect(committed).toEqual(["z"]);
});
