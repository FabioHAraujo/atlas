import { describe, expect, test } from "bun:test";
import { fixLoop, overridesFrom } from "./fix.ts";
import type { Diagnostic, LintReport } from "./lint/types.ts";

const report = (file: string, diagnostics: Diagnostic[]): LintReport => ({
	version: 1,
	target: { file, kind: "video", profile: "social-vertical", width: 1080, height: 1920, duration: 30 },
	diagnostics,
	skipped: [],
	summary: { errors: diagnostics.filter((d) => d.severity === "error").length, warnings: 0, infos: 0 },
});
const zoomFix = (shot: string, focus: string, zoom: number, severity: Diagnostic["severity"] = "error"): Diagnostic => ({
	severity,
	code: "text/too-small-for-target",
	message: "x",
	range: { start: 5, end: 6 },
	fix: { action: "set-camera-zoom", description: "zoom", params: { shot, focus, zoom } },
});

describe("overridesFrom: lint diagnostics -> camera.json entries", () => {
	test("a set-camera-zoom fix becomes an override keyed <cut>/<shot>/<focus>", () => {
		expect(overridesFrom("film-v", [zoomFix("panel", "fail", 2.4)])).toEqual({ "film-v/panel/fail": { zoom: 2.4 } });
	});

	test("two fixes for one focus keep the LARGEST zoom (the one that satisfies both rules)", () => {
		expect(overridesFrom("film-v", [zoomFix("panel", "fail", 2.1), zoomFix("panel", "fail", 2.6)])).toEqual({ "film-v/panel/fail": { zoom: 2.6 } });
	});

	test("a too-large zoom (subject-out-of-frame) and a too-small one (legibility) for the same focus cannot both hold: the smaller ceiling is reported as a conflict, not applied silently", () => {
		const out = overridesFrom("film-v", [zoomFix("panel", "fail", 3, "error"), { ...zoomFix("panel", "fail", 2, "error"), code: "camera/subject-out-of-frame" }]);
		expect(out["film-v/panel/fail"]).toBeUndefined();
	});

	test("fixes of other actions, and diagnostics without a fix, are ignored (the loop only turns camera knobs)", () => {
		const other: Diagnostic = { severity: "error", code: "audio/loudness", message: "x", fix: { action: "normalize-loudness", description: "x" } };
		expect(overridesFrom("film-v", [other, { severity: "error", code: "x", message: "x" }])).toEqual({});
	});

	test("warnings are not applied: only errors are the loop's business", () => {
		expect(overridesFrom("film-v", [zoomFix("panel", "fail", 2.4, "warning")])).toEqual({});
	});
});

describe("fixLoop: lint -> fix -> lint with a ceiling", () => {
	// A fake world with the real contract: lint returns reports for the current overrides; render is a no-op marker.
	const world = (need: number) => {
		const calls: string[] = [];
		let overrides: Record<string, { zoom?: number }> = {};
		return {
			calls,
			get overrides() {
				return overrides;
			},
			io: {
				cutOut: "film-v",
				lint: async () => {
					calls.push("lint");
					const z = overrides["film-v/panel/fail"]?.zoom ?? 1.5;
					return [report("film-v.mp4", z >= need ? [] : [zoomFix("panel", "fail", Math.min(need, z * 1.4))])];
				},
				apply: async (o: Record<string, { zoom?: number }>) => {
					calls.push("apply");
					overrides = { ...overrides, ...o };
				},
				render: async () => void calls.push("render"),
			},
		};
	};

	test("converges: lint, apply, render, lint until 0 errors, and says how many iterations it took", async () => {
		const w = world(2.5);
		const r = await fixLoop(w.io, { maxIterations: 5 });
		expect(r.converged).toBe(true);
		expect(r.iterations.at(-1)!.errors).toBe(0);
		expect(w.calls[0]).toBe("lint");
		expect(w.calls.at(-1)).toBe("lint");
	});

	test("a loop that cannot converge stops at maxIterations with the remaining errors in the report", async () => {
		const w = world(99);
		const r = await fixLoop(w.io, { maxIterations: 3 });
		expect(r.converged).toBe(false);
		expect(r.iterations).toHaveLength(3 + 1); // the final lint after the last fix is reported too
		expect(r.remaining.length).toBeGreaterThan(0);
	});

	test("it stops EARLY when a round changes nothing (no applicable fix): no spinning", async () => {
		const stuck = {
			cutOut: "film-v",
			lint: async () => [report("film-v.mp4", [{ severity: "error" as const, code: "audio/loudness", message: "x" }])],
			apply: async () => {},
			render: async () => {},
		};
		const r = await fixLoop(stuck, { maxIterations: 5 });
		expect(r.converged).toBe(false);
		expect(r.iterations).toHaveLength(1);
		expect(r.reason).toMatch(/no applicable fix/);
	});

	test("it never re-renders when there is nothing to apply, and never when already clean", async () => {
		const w = world(1);
		const r = await fixLoop(w.io, { maxIterations: 5 });
		expect(r.converged).toBe(true);
		expect(w.calls).toEqual(["lint"]);
	});

	test("an unfixable error (enlarge-source-text) is reported as needing a human decision and ends the loop for that focus", async () => {
		const io = {
			cutOut: "film-v",
			lint: async () => [report("film-v.mp4", [{ severity: "error" as const, code: "text/too-small-for-target", message: "x", fix: { action: "enlarge-source-text" as const, description: "x", params: { shot: "panel", focus: "fail", neededZoom: 4, maxZoom: 2 } } }])],
			apply: async () => {},
			render: async () => {},
		};
		const r = await fixLoop(io, { maxIterations: 5 });
		expect(r.converged).toBe(false);
		expect(r.reason).toMatch(/enlarge-source-text|human/);
	});
});
