// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { expect, test } from "bun:test";
import { DEFAULT_KEYMAP, normalize } from "#lib/keys.ts";
import { EDITOR_OWNED, editorOwnsKey } from "#lib/editor/ownedKeys.ts";

const key = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
	new KeyboardEvent("keydown", { code, ...mods });

function inEditor() {
	const host = document.createElement("div");
	host.className = "cm-editor";
	const inner = document.createElement("div");
	host.append(inner);
	document.body.append(host);
	return inner;
}

test("every owned chord is a canonical stroke the shell really binds (else the entry is dead weight)", () => {
	// DEFAULT_KEYMAP is written loosely (`cmd-shift-\\`); the dispatcher compares canonical strokes.
	const bound = new Set(Object.keys(DEFAULT_KEYMAP).map(normalize));
	for (const stroke of Object.keys(EDITOR_OWNED)) {
		expect(normalize(stroke)).toBe(stroke);
		expect(bound.has(stroke)).toBe(true);
	}
});

test("inside an editor, ⌘/ ⌘[ ⌘] ⌘L ⇧⌘\\ go to the editor", () => {
	const t = inEditor();
	for (const [code, mods] of [
		["Slash", { metaKey: true }],
		["BracketLeft", { metaKey: true }],
		["BracketRight", { metaKey: true }],
		["KeyL", { metaKey: true }],
		["Backslash", { metaKey: true, shiftKey: true }],
	] as const) {
		expect(editorOwnsKey(key(code, mods), t)).toBe(true);
	}
});

test("outside an editor the shell keeps every one of them", () => {
	const t = document.createElement("div");
	document.body.append(t);
	expect(editorOwnsKey(key("Slash", { metaKey: true }), t)).toBe(false);
	expect(editorOwnsKey(key("Slash", { metaKey: true }), null)).toBe(false);
});

test("inside an editor, every other shell shortcut still wins (save, quick open, close tab)", () => {
	const t = inEditor();
	for (const [code, mods] of [
		["KeyK", { metaKey: true }], // Jump stays available from inside an editor
		["KeyS", { metaKey: true }],
		["KeyP", { metaKey: true }],
		["KeyW", { metaKey: true }],
		["KeyP", { metaKey: true, shiftKey: true }],
		["Backslash", { metaKey: true }],
		["BracketLeft", { metaKey: true, shiftKey: true }],
	] as const) {
		expect(editorOwnsKey(key(code, mods), t)).toBe(false);
	}
});
