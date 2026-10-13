// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";

// Incident (selection stall, 13 spaces): every space layer mounts ~13 <Tip>s and each one built a full bits-ui
// Tooltip (Provider + Root + Trigger + Portal state) at mount, inside the commit of a space switch. A tooltip is
// only needed once the pointer or focus reaches its control, so the tooltip machinery must not exist before.
// Dynamic imports on purpose: the Svelte loader registered by test/setup.ts must exist before these modules load.
const { installUiKit } = await import("../../../test/uiKit.ts");
await installUiKit({ tooltip: true });
const built = () => globalThis.__tooltipsBuilt ?? 0;
mock.module(resolve(import.meta.dir, "../keymap.svelte.ts"), () => ({ shortcutFor: () => "⌘B" }));

const { flushSync, mount, unmount, createRawSnippet } = await import("svelte");
const { default: Tip } = await import("./Tip.svelte");

// The kit hands the trigger props to the control; the control's own DOM events are what Tip must react to.
const child = createRawSnippet(() => ({ render: () => `<button class="ctl">x</button>` }));

function setup(label = "Toggle") {
	const target = document.createElement("div");
	document.body.append(target);
	globalThis.__tooltipsBuilt = 0;
	const app = flushSync(() =>
		mount(Tip, { target, props: { label, command: "workspace::ToggleLeftDock", child } }),
	);
	return { target, done: () => (unmount(app), target.remove()) };
}

test("a Tip renders its control but builds no tooltip until the pointer or focus arrives", () => {
	const { target, done } = setup();
	expect(target.querySelector(".ctl")).not.toBeNull();
	expect(built()).toBe(0);
	done();
});

test("hovering the control builds the tooltip once, with the label and the current key binding", () => {
	const { target, done } = setup("Toggle left dock");
	target.querySelector(".ctl").dispatchEvent(new Event("pointerover", { bubbles: true }));
	flushSync();
	expect(built()).toBe(1);
	expect(target.querySelector("[data-tooltip-stub]")?.getAttribute("data-content")).toBe(
		"Toggle left dock  ⌘B",
	);
	target.querySelector(".ctl").dispatchEvent(new Event("pointerover", { bubbles: true }));
	flushSync();
	expect(built()).toBe(1);
	done();
});

test("keyboard focus builds it too (a control without a hover is still described)", () => {
	const { target, done } = setup();
	target.querySelector(".ctl").dispatchEvent(new Event("focusin", { bubbles: true }));
	flushSync();
	expect(built()).toBe(1);
	done();
});

// The swap from bare control to tooltip re-creates the control: a keyboard user who tabbed onto it must not lose focus.
test("arming on focus keeps keyboard focus on the (re-created) control", () => {
	const { target, done } = setup();
	const before = target.querySelector(".ctl");
	before.focus();
	expect(document.activeElement).toBe(before);
	before.dispatchEvent(new Event("focusin", { bubbles: true }));
	return Promise.resolve().then(async () => {
		await new Promise((r) => setTimeout(r, 0));
		const after = target.querySelector(".ctl");
		expect(built()).toBe(1);
		expect(after).not.toBeNull();
		expect(document.activeElement).toBe(after);
		done();
	});
});

test("the control keeps its place: the wrapper is the same element before and after arming", () => {
	const { target, done } = setup();
	const wrap = target.querySelector(".tip");
	target.querySelector(".ctl").dispatchEvent(new Event("pointerover", { bubbles: true }));
	flushSync();
	expect(target.querySelector(".tip")).toBe(wrap);
	expect(wrap.querySelector(".ctl")).not.toBeNull();
	done();
});
