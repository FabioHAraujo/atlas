// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { mouseRoute, wheelReports } from "./mouseRoute.ts";

const mods = (over = {}) => ({ shiftKey: false, metaKey: false, ...over });

// A TUI that turned on mouse reporting (vim, tmux, an agent UI) owns clicks; ⌘ is the app's gesture
// (links, file paths) and ⇧ hands the selection back to the terminal (Ghostty mouse-shift-capture).
test("a program that owns the mouse gets plain clicks; ⇧ and ⌘ stay with Atlas", () => {
	expect(mouseRoute(true, mods())).toBe("program");
	expect(mouseRoute(true, mods({ shiftKey: true }))).toBe("terminal");
	expect(mouseRoute(true, mods({ metaKey: true }))).toBe("terminal");
	expect(mouseRoute(false, mods())).toBe("terminal");
});

// One report per notch, as many as the scroll moved lines, capped so a fling is not a flood.
test("wheel lines become capped up/down notch reports", () => {
	expect(wheelReports(3)).toEqual({ action: "wheelUp", count: 3 });
	expect(wheelReports(-2)).toEqual({ action: "wheelDown", count: 2 });
	expect(wheelReports(500)).toEqual({ action: "wheelUp", count: 20 });
	expect(wheelReports(0)).toBeNull();
});
