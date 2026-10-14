// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { noticeText, shouldNotify } from "./termNotice.ts";

// OSC 9 / OSC 777;notify from a terminal program (an agent saying it is done). The Rust side
// serializes `{tab, title, body}` with `title: null` when the program sent none.
test("the banner title is the program's, else the worktree and terminal", () => {
	expect(noticeText({ title: "Claude", body: "needs you" }, "api")).toEqual({
		title: "Claude",
		body: "needs you",
	});
	expect(noticeText({ title: null, body: "build done" }, "api")).toEqual({
		title: "api · terminal",
		body: "build done",
	});
	expect(noticeText({ title: null, body: "x" }, undefined).title).toBe("Terminal");
});

test("the body is one line, trimmed and capped", () => {
	const n = noticeText({ title: null, body: `  a\n\n b ${"z".repeat(300)}` }, "w");
	expect(n.body.startsWith("a b z")).toBe(true);
	expect(n.body.length).toBe(120);
});

// Same rule as agent status changes: the notice is for someone who is looking elsewhere.
test("notify only when away, unless the user opted into focused notices", () => {
	const base = { enabled: true, suppressWhenFocused: true };
	expect(shouldNotify(base, { windowFocused: true, tabVisible: true })).toBe(false);
	expect(shouldNotify(base, { windowFocused: false, tabVisible: true })).toBe(true);
	expect(shouldNotify(base, { windowFocused: true, tabVisible: false })).toBe(true);
	expect(
		shouldNotify({ ...base, suppressWhenFocused: false }, { windowFocused: true, tabVisible: true }),
	).toBe(true);
	expect(shouldNotify({ ...base, enabled: false }, { windowFocused: false, tabVisible: false })).toBe(false);
});
