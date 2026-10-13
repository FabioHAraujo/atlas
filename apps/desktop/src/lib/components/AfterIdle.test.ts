// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { afterEach, expect, mock, test } from "bun:test";

// Incident (selection stall): a space layer mounts ~15 overlay roots (menus, drawers, dialogs, tooltips: each a bits-ui
// Portal with its own watcher and an imperative root under <body>) INSIDE the commit of a space switch. Overlays are
// unreachable in a neighbour layer (inert), so they mount when the browser is idle, or at once when needed.
// Dynamic imports on purpose: the Svelte loader registered by test/setup.ts must exist before these modules load.
// The queue is the app's `idleQueue` (WKWebView has no requestIdleCallback): here a manual one the tests drain.
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
const { flushSync, mount, unmount, createRawSnippet } = await import("svelte");
const { proxy } = await import("svelte/internal/client"); // what `proxy({...})` compiles to
const { default: AfterIdle } = await import("./AfterIdle.svelte");

const child = createRawSnippet(() => ({ render: () => `<i class="late">overlay</i>` }));
const pending = () => queue.filter((i) => !i.cancelled).length;
afterEach(() => {
	queue.length = 0;
});
const runIdle = () => {
	queue.splice(0).forEach((i) => !i.cancelled && i.f());
	flushSync();
};

function setup(props = {}) {
	const target = document.createElement("div");
	const app = flushSync(() => mount(AfterIdle, { target, props: { children: child, ...props } }));
	return { target, app, late: () => target.querySelector(".late") };
}

test("nothing is mounted at first: the content is queued behind the page being quiet", () => {
	const { late } = setup();
	expect(late()).toBeNull();
	expect(pending()).toBe(1);
});

test("when its turn in the idle queue comes the content mounts, once, and stays", () => {
	const { late } = setup();
	runIdle();
	expect(late()).not.toBeNull();
	runIdle();
	expect(late()).not.toBeNull();
});

test("`now` mounts it in the same flush (the layer became current: no wait, no flash)", () => {
	const { late } = setup({ now: true });
	expect(late()).not.toBeNull();
});

test("`now` arriving later mounts it at once, without waiting for idle", () => {
	const target = document.createElement("div");
	const props = proxy({ now: false, children: child });
	const app = flushSync(() => mount(AfterIdle, { target, props }));
	expect(target.querySelector(".late")).toBeNull();
	props.now = true;
	flushSync();
	expect(target.querySelector(".late")).not.toBeNull();
	unmount(app);
});

test("once mounted it is never torn down when `now` turns false again (closing animations, open menus)", () => {
	const target = document.createElement("div");
	const props = proxy({ now: true, children: child });
	flushSync(() => mount(AfterIdle, { target, props }));
	props.now = false;
	flushSync();
	expect(target.querySelector(".late")).not.toBeNull();
});

test("unmounting before its turn cancels the queued item (no work for a layer that is already gone)", () => {
	const { app } = setup();
	expect(pending()).toBe(1);
	unmount(app);
	flushSync();
	expect(pending()).toBe(0);
});

test("a fallback stands in until the content mounts, then leaves (a placeholder of the final size)", () => {
	const fb = createRawSnippet(() => ({ render: () => `<b class="ph">ph</b>` }));
	const { target, late } = setup({ fallback: fb });
	expect(target.querySelector(".ph")).not.toBeNull();
	expect(late()).toBeNull();
	runIdle();
	expect(target.querySelector(".ph")).toBeNull();
	expect(late()).not.toBeNull();
});

test("`idle={false}` never mounts on its own (nothing is even queued): only `now` builds it, and it stays", () => {
	const target = document.createElement("div");
	const props = proxy({ now: false, idle: false, children: child });
	flushSync(() => mount(AfterIdle, { target, props }));
	expect(pending()).toBe(0);
	runIdle();
	expect(target.querySelector(".late")).toBeNull();
	props.now = true;
	flushSync();
	expect(target.querySelector(".late")).not.toBeNull();
	props.now = false;
	flushSync();
	expect(target.querySelector(".late")).not.toBeNull();
});
