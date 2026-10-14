// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import {
	DEFAULT_KEYMAP,
	bindingsOf,
	label,
	merge,
	normalize,
	rebind,
	shellKeepsCtrl,
	strokeOf,
	strokesOf,
	unbind,
} from "./keys.ts";

test("keystrokes normalize modifier order, aliases and shifted characters", () => {
	expect(normalize("shift-cmd-P")).toBe("shift-cmd-p");
	expect(normalize("cmd-shift-p")).toBe("shift-cmd-p");
	expect(normalize("cmd-?")).toBe("shift-cmd-/");
	expect(normalize("option-super-y")).toBe("alt-cmd-y");
	expect(normalize("cmd--")).toBe("cmd--");
	expect(normalize("hyper-x")).toBeNull();
});

test("key events map by physical key", () => {
	const ev = (code: string, m: Partial<KeyboardEvent> = {}) =>
		({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m }) as KeyboardEvent;
	expect(strokeOf(ev("Slash", { metaKey: true, shiftKey: true }))).toBe(normalize("cmd-?"));
	expect(strokeOf(ev("Backquote", { ctrlKey: true }))).toBe("ctrl-`");
	expect(strokeOf(ev("KeyY", { altKey: true, metaKey: true }))).toBe("alt-cmd-y");
	expect(strokeOf(ev("ShiftLeft", { shiftKey: true }))).toBeNull();
});

test("user keymap overrides, rebinds and unbinds defaults", () => {
	const m = merge(DEFAULT_KEYMAP, {
		"cmd-j": null,
		"cmd-shift-j": "workspace::ToggleBottomDock",
		"nope-x": "x",
	});
	expect(m.get("cmd-j")).toBeUndefined();
	expect(m.get("shift-cmd-j")).toBe("workspace::ToggleBottomDock");
	expect(m.get("cmd-b")).toBe("workspace::ToggleLeftDock");
	expect(label("shift-cmd-p")).toBe("⇧⌘P");
});

test("rebind moves a command to a new key and takes it from its previous owner", () => {
	const r = rebind(DEFAULT_KEYMAP, {}, "workspace::ToggleBottomDock", "cmd-shift-j");
	expect(r.displaced).toBeUndefined();
	const m = merge(DEFAULT_KEYMAP, r.keymap);
	expect(m.get("shift-cmd-j")).toBe("workspace::ToggleBottomDock");
	expect(m.get("cmd-j")).toBeUndefined();

	const steal = rebind(DEFAULT_KEYMAP, {}, "workspace::ToggleBottomDock", "cmd-b");
	expect(steal.displaced).toBe("workspace::ToggleLeftDock");
	const m2 = merge(DEFAULT_KEYMAP, steal.keymap);
	expect(m2.get("cmd-b")).toBe("workspace::ToggleBottomDock");
	expect(bindingsOf("workspace::ToggleLeftDock", m2)).toEqual([]);
});

test("rebind replaces earlier user entries regardless of modifier order", () => {
	const user = { "shift-cmd-j": "workspace::ToggleBottomDock", "cmd-j": null };
	const r = rebind(DEFAULT_KEYMAP, user, "workspace::ToggleBottomDock", "cmd-shift-k");
	const m = merge(DEFAULT_KEYMAP, r.keymap);
	expect(bindingsOf("workspace::ToggleBottomDock", m)).toEqual(["shift-cmd-k"]);
	expect(rebind(DEFAULT_KEYMAP, {}, "x", "hyper-x")).toBeNull();
});

test("unbind removes every binding, defaults included", () => {
	const m = merge(DEFAULT_KEYMAP, unbind(DEFAULT_KEYMAP, {}, "workspace::ToggleLeftDock"));
	expect(bindingsOf("workspace::ToggleLeftDock", m)).toEqual([]);
	expect(m.get("cmd-r")).toBe("workspace::ToggleRightDock");
});

test("default keymap binds every stroke once and has the shell keys", () => {
	const strokes = Object.keys(DEFAULT_KEYMAP).map((k) => normalize(k));
	expect(strokes.every(Boolean)).toBe(true);
	expect(new Set(strokes).size).toBe(strokes.length);
	const m = merge(DEFAULT_KEYMAP, {});
	expect(m.get("cmd-s")).toBe("workspace::Save");
	expect(m.get("alt-cmd-s")).toBe("workspace::SaveAll");
	expect(m.get("ctrl-cmd-s")).toBe("shell::ToggleSidebar");
	expect(label("ctrl-cmd-s")).toBe("⌃⌘S");
	expect(m.get("cmd-[")).toBe("shell::Back");
	expect(m.get("alt-cmd-right")).toBe("shell::NextSpace");
	expect(m.get("cmd-w")).toBe("pane::CloseActiveItem");
	expect(m.get("shift-cmd-t")).toBe("pane::ReopenClosedItem");
	expect(m.get("shift-cmd-a")).toBe("atlas::NewAgentSession");
	expect(m.get("ctrl-tab")).toBe("pane::ActivateRecentItem");
	expect(m.get("cmd-9")).toBe("pane::ActivateLastItem");
	expect(m.get("ctrl-cmd-1")).toBe("atlas::RecentWorktree1");
	expect(m.get("shift-cmd-r")).toBe("atlas::RestartService");
	expect(m.get("cmd-r")).toBe("workspace::ToggleRightDock");
	expect(m.get("ctrl-9")).toBe("shell::Space9");
	expect(label("alt-cmd-left")).toBe("⌥⌘←");
});

test("⌘1…8 and ⌘9 are tab shortcuts, worktrees moved to ⌃⌘", () => {
	const m = merge(DEFAULT_KEYMAP, {});
	for (let n = 1; n <= 8; n++) expect(m.get(`cmd-${n}`)).toBe(`pane::ActivateItem${n}`);
	for (let n = 1; n <= 6; n++) expect(m.get(`ctrl-cmd-${n}`)).toBe(`atlas::RecentWorktree${n}`);
	expect(label("ctrl-cmd-1")).toBe("⌃⌘1");
	expect(strokeOf({ code: "Tab", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe(
		"ctrl-shift-tab",
	);
});

test("⌃- and ⌃⇧- are Go Back / Go Forward over jump positions, distinct from ⌘[ ⌘] tab history", () => {
	const m = merge(DEFAULT_KEYMAP, {});
	expect(m.get(normalize("ctrl--"))).toBe("editor::GoBack");
	expect(m.get(normalize("ctrl-shift--"))).toBe("editor::GoForward");
	expect(m.get("cmd-[")).toBe("shell::Back");
});

// Incident (Windows, first run): every shortcut was bound to ⌘ (the Meta key), which on Windows and Linux is the
// system's own Windows/Super key, so no app shortcut worked and every hint read `⌘K`. Off macOS, Ctrl takes ⌘'s
// place (as in VS Code and Zed) and labels read `Ctrl+K`.
test("off macOS, Ctrl is the primary modifier: Ctrl+K is the ⌘K binding", () => {
	const ev = (code: string, m: Partial<KeyboardEvent> = {}) =>
		({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m }) as KeyboardEvent;
	expect(strokeOf(ev("KeyK", { ctrlKey: true }), false)).toBe("cmd-k");
	expect(strokeOf(ev("KeyP", { ctrlKey: true, shiftKey: true }), false)).toBe("shift-cmd-p");
	expect(strokeOf(ev("KeyS", { ctrlKey: true, altKey: true }), false)).toBe("alt-cmd-s");
	// The Windows key is the system's: it never reaches a binding.
	expect(strokeOf(ev("KeyK", { metaKey: true }), false)).toBeNull();
	// macOS is unchanged.
	expect(strokeOf(ev("KeyK", { ctrlKey: true }), true)).toBe("ctrl-k");
	expect(strokeOf(ev("KeyK", { metaKey: true }), true)).toBe("cmd-k");
});

test("off macOS a Ctrl chord also reaches a binding written with ctrl, after the ⌘ one", () => {
	const ev = (code: string, m: Partial<KeyboardEvent> = {}) =>
		({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m }) as KeyboardEvent;
	expect(strokesOf(ev("Tab", { ctrlKey: true }), false)).toEqual(["cmd-tab", "ctrl-tab"]);
	expect(strokesOf(ev("Backquote", { ctrlKey: true }), false)).toEqual(["cmd-`", "ctrl-`"]);
	expect(strokesOf(ev("KeyK", { metaKey: true }), true)).toEqual(["cmd-k"]);
	expect(strokesOf(ev("KeyA"), false)).toEqual(["a"]);
	const m = merge(DEFAULT_KEYMAP, {});
	const run = (e: KeyboardEvent) =>
		strokesOf(e, false)
			.map((s) => m.get(s))
			.find(Boolean);
	expect(run(ev("KeyK", { ctrlKey: true }))).toBe("atlas::Jump");
	expect(run(ev("Tab", { ctrlKey: true }))).toBe("pane::ActivateRecentItem");
	expect(run(ev("Backquote", { ctrlKey: true }))).toBe("terminal_panel::ToggleFocus");
	expect(run(ev("KeyP", { ctrlKey: true, shiftKey: true }))).toBe("command_palette::Toggle");
});

test("labels read Ctrl/Alt/Shift words off macOS and glyphs on macOS", () => {
	expect(label("shift-cmd-p", false)).toBe("Ctrl+Shift+P");
	expect(label("cmd-k", false)).toBe("Ctrl+K");
	expect(label("alt-cmd-s", false)).toBe("Ctrl+Alt+S");
	expect(label("ctrl-tab", false)).toBe("Ctrl+Tab");
	expect(label("ctrl-`", false)).toBe("Ctrl+`");
	expect(label("alt-cmd-left", false)).toBe("Ctrl+Alt+←");
	expect(label("cmd--", false)).toBe("Ctrl+-");
	expect(label("escape", false)).toBe("Esc");
	expect(label("shift-cmd-p", true)).toBe("⇧⌘P");
});

// Off macOS the app's shortcuts are Ctrl chords; a shell needs ^C, ^R, ^L, ^W, ^K… for itself. In a focused terminal a
// plain Ctrl+letter goes to the program and the app is reached with Shift added, as in Windows Terminal.
test("off macOS a focused terminal keeps plain Ctrl+letter for the program", () => {
	const ev = (code: string, m = {}) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, ...m });
	for (const code of ["KeyC", "KeyR", "KeyL", "KeyW", "KeyK", "KeyT"]) {
		expect(shellKeepsCtrl(ev(code, { ctrlKey: true }), false)).toBe(true);
	}
	// The app still gets Ctrl+Shift chords, Ctrl+digits, Ctrl+Tab and Ctrl+`.
	expect(shellKeepsCtrl(ev("KeyT", { ctrlKey: true, shiftKey: true }), false)).toBe(false);
	expect(shellKeepsCtrl(ev("Digit1", { ctrlKey: true }), false)).toBe(false);
	expect(shellKeepsCtrl(ev("Tab", { ctrlKey: true }), false)).toBe(false);
	expect(shellKeepsCtrl(ev("Backquote", { ctrlKey: true }), false)).toBe(false);
	expect(shellKeepsCtrl(ev("KeyR", { ctrlKey: true, altKey: true }), false)).toBe(false);
	// macOS app shortcuts are ⌘ chords: nothing to keep.
	expect(shellKeepsCtrl(ev("KeyC", { ctrlKey: true }), true)).toBe(false);
});
