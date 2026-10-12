// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { DEFAULT_KEYMAP, normalize } from "#lib/keys.ts";
import { EDITOR_OWNED } from "./ownedKeys.ts";
import { BINDINGS, collisions, editorCommands, normalizeKey } from "./keymap.ts";

test("no two editor bindings share a chord and every id is unique", () => {
	expect(collisions(BINDINGS)).toEqual({ ids: [], keys: [] });
	expect(new Set(editorCommands.map((c) => c.id)).size).toBe(editorCommands.length);
});

test("collisions reports duplicates, modifier order does not matter", () => {
	const run = () => true;
	const dup = [
		{ id: "a", key: "Alt-Mod-x", run },
		{ id: "b", key: "Mod-Alt-x", run },
		{ id: "a", key: "Mod-y", run },
	];
	expect(collisions(dup)).toEqual({ ids: ["a"], keys: ["Alt-Mod-x"] });
	expect(normalizeKey("Mod-Shift-\\")).toBe("Mod-Shift-\\");
	expect(normalizeKey("Mod--")).toBe("Mod--");
	expect(normalizeKey("Mod-k Mod-0")).toBe("Mod-k Mod-0"); // chord spelling still normalises
});

test("VS Code parity bindings exist", () => {
	const keys = new Map(BINDINGS.map((b) => [b.id, b.key]));
	expect(keys.get("editor::SelectNextOccurrence")).toBe("Mod-d");
	expect(keys.get("editor::SelectAllOccurrences")).toBe("Mod-Shift-l");
	expect(keys.get("editor::MoveLineUp")).toBe("Alt-ArrowUp");
	expect(keys.get("editor::CopyLineDown")).toBe("Alt-Shift-ArrowDown");
	expect(keys.get("editor::DeleteLine")).toBe("Mod-Shift-k");
	expect(keys.get("editor::ToggleComment")).toBe("Mod-/");
	expect(keys.get("editor::GoToLine")).toBe("Ctrl-g");
	expect(keys.get("editor::Indent")).toBe("Tab");
});

test("an editor binding the shell also binds is either owned by the editor or documented as shadowed", () => {
	// CodeMirror spelling (`Mod-Shift-\\`, single stroke) -> the keymap's canonical stroke (`shift-cmd-\\`).
	const stroke = (key: string) => {
		if (key.includes(" ")) return null;
		const parts = key.split("-");
		const k = parts.pop() === "" ? "-" : key.slice(key.lastIndexOf("-") + 1);
		const mods = new Set(parts);
		const out = [
			mods.has("Ctrl") && "ctrl",
			mods.has("Alt") && "alt",
			mods.has("Shift") && "shift",
			mods.has("Mod") && "cmd",
		];
		return normalize([...out.filter(Boolean), k.length === 1 ? k.toLowerCase() : k.toLowerCase()].join("-"));
	};
	const shell = new Set(Object.keys(DEFAULT_KEYMAP).map(normalize));
	const dead: string[] = [];
	for (const b of BINDINGS) {
		const st = stroke(b.key);
		if (st && shell.has(st) && !Object.hasOwn(EDITOR_OWNED, st)) dead.push(`${b.id} (${b.key})`);
	}
	expect(dead).toEqual([]);
	// And the owned list is not stale: each entry is an editor binding.
	const editorStrokes = new Set(BINDINGS.map((b) => stroke(b.key)));
	for (const owned of Object.keys(EDITOR_OWNED)) expect(editorStrokes.has(owned)).toBe(true);
});
