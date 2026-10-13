import { describe, expect, test } from "bun:test";
import { StudioError } from "../lib/paths.ts";
import { explainCaptureFailure } from "./errors.ts";

const explain = (msg: string) => explainCaptureFailure(msg);

describe("explainCaptureFailure: every native failure becomes a message + a concrete fix", () => {
	test("Screen Recording permission missing -> where to grant it, and that snapshot mode needs none", () => {
		const e = explain("Screen Recording permission is missing (user declined TCCs). Grant it to Atlas");
		expect(e).toBeInstanceOf(StudioError);
		expect(e.hint).toMatch(/System Settings/);
		expect(e.hint).toMatch(/snapshot/);
	});

	test("window not capturable (minimized / hidden / other Space) -> show the window, or use snapshot", () => {
		const e = explain("window 42 is not capturable: it is minimized, hidden, or on another Space");
		expect(e.hint).toMatch(/snapshot|visible|show/i);
	});

	test("macOS older than 15 -> says video needs 15 and what still works", () => {
		const e = explain("video capture needs macOS 15 or newer (stills work on 14+, `snapshot` everywhere)");
		expect(e.hint).toMatch(/macOS 15/);
	});

	test("selector timeout names the selector and suggests how to find the right one", () => {
		const e = explain("step 3 (wait): timed out after 8000 ms waiting for .ready");
		expect(e.message).toContain(".ready");
		expect(e.hint).toMatch(/debug eval|selector/i);
	});

	test("an element that is not there at all (click/zoom/pointer) gets the same selector guidance", () => {
		expect(explain("step 5 (zoom): zoom: no element matches .scroll").hint).toMatch(/selector/i);
		expect(explain("step 1 (click): nothing visible to click: .go").hint).toMatch(/selector/i);
	});

	test("no frames captured -> the window was not drawing; tells how to check", () => {
		expect(explain("no frames were captured: the window was minimized, hidden or on another Space").hint).toMatch(/visible|show/i);
	});

	test("an invalid script the app rejected is passed through with its paths intact", () => {
		const e = explain("invalid script:\n  steps[0].do: unknown step \"teleport\"");
		expect(e.message).toContain("steps[0].do");
	});

	test("Atlas Desktop not running -> how to start an instance", () => {
		expect(explain("Atlas Desktop is not running; launch it with `atlas desktop`").hint).toMatch(/atlas desktop|bun studio/);
	});

	test("a file permission error is NOT blamed on Screen Recording (the hint must not mislead)", () => {
		const e = explain("EACCES: permission denied, open '/tmp/out/video.mov'");
		expect(e.hint).not.toMatch(/Screen Recording/);
		expect(e.message).toContain("EACCES");
	});

	test("an unknown message is kept verbatim (never swallowed) with a generic hint pointing at the app log", () => {
		const e = explain("something exotic");
		expect(e.message).toContain("something exotic");
		expect(e.hint).toBeTruthy();
	});

	test("a recording that is already running is explained as a stale instance", () => {
		expect(explain("a recording is already running; stop it first (capture_stop)").hint).toMatch(/capture stop|restart/i);
	});
});
