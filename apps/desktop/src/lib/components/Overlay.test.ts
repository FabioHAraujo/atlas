// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { afterEach, expect, mock, test } from "bun:test";

// Incident (selection stall, 13 spaces): every space layer carries ~6 kit overlays (menus, select, bell), each a
// bits-ui Portal that mounts an imperative root under <body> even while closed. A neighbour layer is inert, so its
// overlays wait behind a placeholder of the trigger's size (no layout shift): built one per task once the page is quiet,
// or in the same flush when the layer becomes current (the safety net). Dynamic imports on purpose: the Svelte loader from test/setup.ts must exist before they load.
const { flushSync, mount, unmount, createRawSnippet } = await import("svelte");
const { proxy } = await import("svelte/internal/client");
const { default: Harness } = await import("../../../test/OverlayHarness.svelte");

// The app's idle queue (one item per task, after a quiet window; WKWebView has no requestIdleCallback), driven by hand.
const queue: { f: () => void; cancelled: boolean }[] = [];
mock.module("#lib/idleQueue.ts", () => ({
	idleQueue: {
		add(f: () => void) {
			const item = { f, cancelled: false };
			queue.push(item);
			return () => void (item.cancelled = true);
		},
		bump() {},
	},
}));
afterEach(() => void (queue.length = 0));
/** One task of the queue: the next item runs, the rest wait for their own task. */
const nextTask = () => {
	queue.shift()?.f();
	flushSync();
};

const real = createRawSnippet(() => ({ render: () => `<button class="real">menu</button>` }));

function setup(props = {}) {
	globalThis.__overlayBuilt = 0;
	const target = document.createElement("div");
	const p = proxy({ current: false, width: 28, height: 24, children: real, ...props });
	const app = flushSync(() => mount(Harness, { target, props: p }));
	return {
		p,
		target,
		app,
		real: () => target.querySelector(".real"),
		ph: () => target.querySelector("[data-overlay-placeholder]"),
	};
}

test("in a neighbour layer the overlay is not built: a placeholder of the trigger's size stands in", () => {
	const { real, ph } = setup();
	expect(real()).toBeNull();
	expect(globalThis.__overlayBuilt).toBe(0);
	const el = ph();
	expect(el).not.toBeNull();
	// layout identical to the real trigger: same box, so building it later shifts nothing (CLS 0)
	expect(el.style.width).toBe("28px");
	expect(el.style.height).toBe("24px");
	expect(el.getAttribute("aria-hidden")).toBe("true");
});

test("in the current layer the overlay is built in the very same flush, with no placeholder", () => {
	const { real, ph } = setup({ current: true });
	expect(real()).not.toBeNull();
	expect(ph()).toBeNull();
	expect(globalThis.__overlayBuilt).toBe(1);
});

test("a neighbour builds its overlays one per task once the page is quiet, never all in one", () => {
	const a = setup();
	const b = setup();
	const c = setup();
	expect(globalThis.__overlayBuilt).toBe(0);
	nextTask();
	expect(globalThis.__overlayBuilt).toBe(1);
	expect([a.real(), b.real(), c.real()].filter(Boolean)).toHaveLength(1);
	nextTask();
	nextTask();
	expect(globalThis.__overlayBuilt).toBe(3);
	expect(a.ph()).toBeNull();
});

test("a neighbour that never gets its turn keeps the placeholder (nothing builds it inside the commit)", () => {
	const { real, ph } = setup();
	expect(real()).toBeNull();
	expect(ph()).not.toBeNull();
	expect(globalThis.__overlayBuilt).toBe(0);
});

test("a layer that was current keeps its overlay when it parks as a neighbour (A→B→A does not rebuild)", () => {
	const { p, real, ph } = setup({ current: true });
	expect(globalThis.__overlayBuilt).toBe(1);
	p.current = false;
	flushSync();
	expect(real()).not.toBeNull();
	expect(ph()).toBeNull();
	expect(globalThis.__overlayBuilt).toBe(1);
});

test("a layer that becomes current builds it at once, without waiting for idle", () => {
	const { p, real } = setup();
	expect(real()).toBeNull();
	p.current = true;
	flushSync();
	expect(real()).not.toBeNull();
});

test("`fill` placeholders are 100% wide and shrink with their flex row, like the kit's select they stand for", () => {
	const { ph } = setup({ width: undefined, height: 30, fill: true });
	expect(ph().style.width).toBe("100%");
	expect(ph().style.flex).toBe("0 1 auto");
	expect(ph().style.height).toBe("30px");
});

test("unmounted before its turn: nothing is built and the queued item is cancelled", () => {
	const { app, real } = setup();
	unmount(app);
	flushSync();
	nextTask();
	expect(real()).toBeNull();
	expect(globalThis.__overlayBuilt).toBe(0);
});
