// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../../test/setup.ts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Incident (tab bar, 2026-10): with enough tabs open (a terminal and a browser among them) the "+" was gone. The strip was
// one `overflow-x: auto` scroller with the scrollbar hidden and the "+" as its LAST child, so every tab past the pane width
// pushed it out of reach (measured: "+" at x=1983 in a strip that ends at 1264, scrollLeft 0, nothing to scroll it back).
// The "+" menu, the quick actions and the drag region must live OUTSIDE the scroller; only the tabs scroll.
// Dynamic imports on purpose: the Svelte loader registered by test/setup.ts must exist before these modules load, so static imports cannot work.
const { flushSync, mount, unmount, createRawSnippet } = await import("svelte");
const { default: TabStrip } = await import("./TabStrip.svelte");
const { scrollTabIntoView } = await import("./tabStrip.ts");

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));

function setup() {
	const target = document.createElement("div");
	document.body.append(target);
	const app = flushSync(() =>
		mount(TabStrip, {
			target,
			props: {
				tabList: snip(`<div><div class="tab" id="t1">one</div><div class="tab" id="t2">two</div></div>`),
				actions: snip(
					`<div><span class="plus" id="plus">+</span><button class="quick" id="q">q</button></div>`,
				),
				swipeOptions: { onEnd() {}, can: () => false },
			},
		}),
	);
	return { target, done: () => (unmount(app), target.remove()) };
}

/** Elements between `el` and the strip root that can scroll horizontally (declared in the component's own style). */
const scrollers = (el: Element, root: Element) => {
	const out: Element[] = [];
	for (let n = el.parentElement; n && n !== root; n = n.parentElement)
		if (n.classList.contains("tabs")) out.push(n);
	return out;
};

test("the tabs scroll in their own container and the + / quick actions are NOT inside it", () => {
	const { target, done } = setup();
	const strip = target.querySelector(".strip");
	expect(strip).not.toBeNull();
	const scroller = strip.querySelector(".tabs");
	expect(scroller).not.toBeNull();
	expect(scroller.querySelector("#t1")).not.toBeNull();
	expect(scroller.querySelector("#t2")).not.toBeNull();
	// the incident: "+" was a child of the scroller
	expect(scrollers(target.querySelector("#plus"), strip)).toEqual([]);
	expect(scrollers(target.querySelector("#q"), strip)).toEqual([]);
	done();
});

test("a drag region fills the rest of the strip so the window stays movable by it", () => {
	const { target, done } = setup();
	expect(target.querySelector(".strip > .fill[data-tauri-drag-region]")).not.toBeNull();
	done();
});

test("the real stylesheet: only .tabs scrolls horizontally, .strip itself does not (it would clip the +)", () => {
	const css = readFileSync(join(import.meta.dir, "TabStrip.svelte"), "utf8").split("<style>")[1];
	const rule = (sel: string) =>
		new RegExp(`${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
	expect(rule(".strip")).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/);
	expect(rule(".tabs")).toMatch(/overflow-x\s*:\s*auto/);
	// the scroller must be allowed to shrink below its content, or flexbox grows it past the strip and the + goes with it
	expect(rule(".tabs")).toMatch(/min-width\s*:\s*0/);
});

test("TabGroupView renders its tabs through the strip, with the new-tab menu among the actions", () => {
	const src = readFileSync(join(import.meta.dir, "TabGroupView.svelte"), "utf8");
	expect(src).toContain("<TabStrip");
	// the old shape: the menu rendered straight inside the scrolling strip div
	expect(src).not.toMatch(/class="strip"/);
});

// --- scrolling the active tab into view (a long strip hid the active tab too: the browser tab was off-screen) ---

const box = (left: number, width: number) => ({ left, right: left + width });

test("scrollTabIntoView: a tab hidden on the right scrolls just far enough to show, with a margin", () => {
	expect(scrollTabIntoView({ scroller: box(0, 400), tab: box(380, 100), scrollLeft: 0, margin: 8 })).toBe(88);
});

test("scrollTabIntoView: a tab hidden on the left scrolls back to it", () => {
	// scroller scrolled 300px: a tab at content x=100..200 shows at viewport x=-200..-100
	expect(scrollTabIntoView({ scroller: box(0, 400), tab: box(-200, 100), scrollLeft: 300, margin: 8 })).toBe(
		92,
	);
});

test("scrollTabIntoView: a tab fully inside does not move the strip", () => {
	expect(scrollTabIntoView({ scroller: box(0, 400), tab: box(50, 100), scrollLeft: 120, margin: 8 })).toBe(
		120,
	);
});

test("scrollTabIntoView: never negative (first tab, margin larger than the offset)", () => {
	expect(scrollTabIntoView({ scroller: box(0, 400), tab: box(2, 100), scrollLeft: 0, margin: 8 })).toBe(0);
});

test("scrollTabIntoView: a tab wider than the viewport aligns its left edge", () => {
	expect(scrollTabIntoView({ scroller: box(0, 100), tab: box(40, 220), scrollLeft: 0, margin: 8 })).toBe(32);
});
