// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { keyAction } from "./keys.ts";

const key = (k: string, mods: Record<string, boolean> = {}) => ({
	key: k,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

test("⌘ shortcuts map to zoom, find and match actions even while typing", () => {
	expect(keyAction(key("=", { metaKey: true }), true, 800)).toEqual({ type: "zoom", to: "in" });
	expect(keyAction(key("-", { ctrlKey: true }), false, 800)).toEqual({ type: "zoom", to: "out" });
	expect(keyAction(key("0", { metaKey: true }), false, 800)).toEqual({ type: "zoom", to: "width" });
	expect(keyAction(key("1", { metaKey: true }), false, 800)).toEqual({ type: "zoom", to: 1 });
	expect(keyAction(key("F", { metaKey: true }), true, 800)).toEqual({ type: "find" });
	expect(keyAction(key("g", { metaKey: true, shiftKey: true }), false, 800)).toEqual({
		type: "match",
		dir: -1,
	});
	expect(keyAction(key("x", { metaKey: true }), false, 800)).toBeNull();
});

test("plain keys scroll by line or 90% of the viewport and are ignored while typing", () => {
	expect(keyAction(key("j"), false, 800)).toEqual({ type: "scroll", dy: 56 });
	expect(keyAction(key("ArrowUp"), false, 800)).toEqual({ type: "scroll", dy: -56 });
	expect(keyAction(key(" "), false, 1000)).toEqual({ type: "scroll", dy: 900 });
	expect(keyAction(key(" ", { shiftKey: true }), false, 1000)).toEqual({ type: "scroll", dy: -900 });
	expect(keyAction(key("PageDown"), false, 1000)).toEqual({ type: "scroll", dy: 900 });
	expect(keyAction(key("Home"), false, 800)).toEqual({ type: "home" });
	expect(keyAction(key("End"), false, 800)).toEqual({ type: "end" });
	expect(keyAction(key("Escape"), false, 800)).toEqual({ type: "escape" });
	expect(keyAction(key("j"), true, 800)).toBeNull();
	expect(keyAction(key("j", { altKey: true }), false, 800)).toBeNull();
	expect(keyAction(key("q"), false, 800)).toBeNull();
});
