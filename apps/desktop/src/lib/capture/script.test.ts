// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { MAX_SCRIPT_MS, parseScript, scriptDurationMs } from "./script.ts";

const ok = (over = {}) => ({
	version: 1,
	size: { width: 1280, height: 800 },
	fps: 60,
	steps: [{ do: "pause", ms: 500 }],
	...over,
});

describe("parseScript: envelope", () => {
	test("a minimal script parses and gets defaults (fps 60, scale 2, no cursor)", () => {
		const r = parseScript({
			version: 1,
			size: { width: 1280, height: 800 },
			steps: [{ do: "pause", ms: 100 }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.script.fps).toBe(60);
		expect(r.script.cursor).toBe(false);
		expect(r.script.size).toEqual({ width: 1280, height: 800 });
	});

	test("a JSON string is accepted as well as an object (the CLI and the ctl socket send text)", () => {
		expect(parseScript(JSON.stringify(ok())).ok).toBe(true);
		const bad = parseScript("{nope");
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.errors[0].path).toBe("");
	});

	test("an unknown version is refused instead of guessed", () => {
		const r = parseScript(ok({ version: 2 }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0].path).toBe("version");
	});

	test("size is validated: even, bounded, integer (video encoders reject odd sizes)", () => {
		for (const size of [
			{ width: 1281, height: 800 },
			{ width: 100, height: 100 },
			{ width: 8000, height: 800 },
			{ width: 1280.5, height: 800 },
			{ width: "a", height: 1 },
			undefined,
		]) {
			const r = parseScript(ok({ size }));
			expect(r.ok).toBe(false);
		}
	});

	test("fps must be one of 24, 30, 60", () => {
		expect(parseScript(ok({ fps: 30 })).ok).toBe(true);
		expect(parseScript(ok({ fps: 45 })).ok).toBe(false);
		expect(parseScript(ok({ fps: 120 })).ok).toBe(false);
	});

	test("an empty step list is an error: a recording of nothing is a bug in the recipe", () => {
		expect(parseScript(ok({ steps: [] })).ok).toBe(false);
	});

	test("unknown top-level keys are errors (typos like `step:` must not silently record nothing)", () => {
		const r = parseScript(ok({ step: [] }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.some((e) => e.path === "step")).toBe(true);
	});
});

describe("parseScript: steps", () => {
	const step = (s) => parseScript(ok({ steps: [s] }));

	test("every step kind with its required fields parses", () => {
		const good = [
			{ do: "pause", ms: 250 },
			{ do: "view", view: "agents" },
			{ do: "worktree", project: "orbit-shop", name: "feat" },
			{ do: "tab", kind: "logs" },
			{ do: "terminal", argv: ["sh", "-c", "echo hi"], label: "demo" },
			{ do: "run", command: "ls -la", typeDelayMs: 40 },
			{ do: "type", selector: "input.search", text: "orb", delayMs: 80 },
			{ do: "click", selector: ".btn" },
			{ do: "click", text: "Start" },
			{ do: "key", combo: "cmd-shift-p" },
			{ do: "scroll", selector: ".log", to: 400, ms: 900 },
			{ do: "wait", selector: ".ready", timeoutMs: 5000 },
			{ do: "wait", text: "Running" },
			{ do: "wait", terminal: { contains: "ready", timeoutMs: 3000 } },
			{ do: "zoom", target: ".panel", scale: 1.6, ms: 700 },
			{ do: "caption", text: "Every service, one place", ms: 2000 },
			{ do: "pointer", target: ".btn", ms: 400 },
			{ do: "mark", name: "money-shot" },
			{ do: "shot", name: "panel" },
		];
		for (const s of good) {
			const r = step(s);
			expect(r.ok).toBe(true);
		}
	});

	test("an unknown `do` names the allowed ones", () => {
		const r = step({ do: "teleport" });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors[0].path).toBe("steps[0].do");
			expect(r.errors[0].message).toContain("pause");
		}
	});

	test("missing and mistyped fields are reported with the step index in the path", () => {
		const r = parseScript(
			ok({
				steps: [
					{ do: "pause", ms: 10 },
					{ do: "type", selector: ".x" },
					{ do: "scroll", selector: ".y", to: "top", ms: 5 },
				],
			}),
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			const paths = r.errors.map((e) => e.path);
			expect(paths).toContain("steps[1].text");
			expect(paths).toContain("steps[2].to");
			expect(paths.some((p) => p.startsWith("steps[0]"))).toBe(false);
		}
	});

	test("click needs exactly one of selector or text", () => {
		expect(step({ do: "click" }).ok).toBe(false);
		expect(step({ do: "click", selector: ".a", text: "A" }).ok).toBe(false);
	});

	test("wait needs exactly one condition", () => {
		expect(step({ do: "wait" }).ok).toBe(false);
		expect(step({ do: "wait", selector: ".a", text: "A" }).ok).toBe(false);
	});

	test("durations are bounded: negative, NaN and absurd values are refused", () => {
		for (const ms of [-1, Number.NaN, Infinity, MAX_SCRIPT_MS + 1, "10"])
			expect(step({ do: "pause", ms }).ok).toBe(false);
		expect(step({ do: "pause", ms: 0 }).ok).toBe(true);
	});

	test("zoom scale must make the picture larger and stay sane (1..4)", () => {
		expect(step({ do: "zoom", target: ".a", scale: 0.5, ms: 100 }).ok).toBe(false);
		expect(step({ do: "zoom", target: ".a", scale: 9, ms: 100 }).ok).toBe(false);
		expect(step({ do: "zoom", target: ".a", scale: 1, ms: 100 }).ok).toBe(true);
	});

	test("a step may carry an id and a note, ids must be unique across the script", () => {
		expect(step({ do: "pause", ms: 1, id: "intro", note: "breathe" }).ok).toBe(true);
		const dup = parseScript(
			ok({
				steps: [
					{ do: "pause", ms: 1, id: "a" },
					{ do: "pause", ms: 1, id: "a" },
				],
			}),
		);
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.errors[0].path).toBe("steps[1].id");
	});

	test("shot and mark names are file/label safe", () => {
		for (const name of ["../etc/passwd", "a/b", "", "x".repeat(65), "has space"]) {
			expect(step({ do: "shot", name }).ok).toBe(false);
		}
		expect(step({ do: "shot", name: "panel-1_final" }).ok).toBe(true);
	});

	test("shot names are unique: two shots with one name would overwrite each other", () => {
		const r = parseScript(
			ok({
				steps: [
					{ do: "shot", name: "a" },
					{ do: "shot", name: "a" },
				],
			}),
		);
		expect(r.ok).toBe(false);
	});

	test("the total declared time is bounded so a typo cannot record for hours", () => {
		const r = parseScript(
			ok({ steps: Array.from({ length: 40 }, () => ({ do: "pause", ms: MAX_SCRIPT_MS / 10 })) }),
		);
		expect(r.ok).toBe(false);
	});

	test("a non-object step is an error, not a crash", () => {
		for (const s of [null, 7, "pause", []]) expect(step(s).ok).toBe(false);
	});
});

describe("scriptDurationMs", () => {
	test("sums the declared durations: pause + typing (chars x delay) + scroll/zoom/caption ms", () => {
		const r = parseScript(
			ok({
				steps: [
					{ do: "pause", ms: 500 },
					{ do: "type", selector: "i", text: "abcd", delayMs: 100 },
					{ do: "scroll", selector: ".l", to: 10, ms: 300 },
					{ do: "run", command: "ls", typeDelayMs: 50 },
				],
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// 500 + 4*100 + 300 + (2 chars + Enter)*50
		expect(scriptDurationMs(r.script)).toBe(500 + 400 + 300 + 150);
	});
});
