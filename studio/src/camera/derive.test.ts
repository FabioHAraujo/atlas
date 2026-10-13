import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppClipScene, Cut, Film, TerminalScene } from "../lib/types.ts";
import { loadOverrides, mergeOverrides, saveOverrides, sidecarFor } from "./derive.ts";
import { planCamera } from "./plan.ts";
import { layoutFor, reframeCut, type ResolveFocus } from "./reframe.ts";
import type { ResolvedFocus } from "./types.ts";

// camera.json is the ONE file `studio fix --apply` writes: film.ts stays hand-authored, the planner's per-focus zoom
// is overridden here. It must roundtrip byte-stably and reject what it cannot honour, or a fix loop would diverge.
describe("camera.json overrides", () => {
	const dir = mkdtempSync(join(tmpdir(), "camera-json-"));
	const file = join(dir, "camera.json");
	test("missing file is no overrides", () => {
		expect(loadOverrides(join(dir, "nope.json"))).toEqual({});
	});

	test("save then load roundtrips, and the bytes are stable (sorted keys, trailing newline)", () => {
		saveOverrides(file, { "b/x/f": { zoom: 2.5 }, "a/y/g": { zoom: 1.75 } });
		const first = Bun.file(file).text();
		saveOverrides(file, loadOverrides(file));
		expect(loadOverrides(file)).toEqual({ "a/y/g": { zoom: 1.75 }, "b/x/f": { zoom: 2.5 } });
		return first.then(async (a) => expect(await Bun.file(file).text()).toBe(a));
	});

	test("a zoom below 1 or not a number is refused with the offending key", () => {
		writeFileSync(file, JSON.stringify({ version: 1, overrides: { "a/b/c": { zoom: 0.5 } } }));
		expect(() => loadOverrides(file)).toThrow(/a\/b\/c/);
		writeFileSync(file, JSON.stringify({ version: 1, overrides: { "a/b/c": { zoom: "big" } } }));
		expect(() => loadOverrides(file)).toThrow(/a\/b\/c/);
	});

	test("a newer zoom replaces the older one for the same focus and keeps the others", () => {
		expect(mergeOverrides({ "a/b/c": { zoom: 2 }, "a/b/d": { zoom: 3 } }, { "a/b/c": { zoom: 2.4 } })).toEqual({ "a/b/c": { zoom: 2.4 }, "a/b/d": { zoom: 3 } });
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

describe("sidecarFor: the file the lint reads, built from the cut the compositor rendered", () => {
	const crop = { x: 0, y: 4, w: 2560, h: 1576 };
	const app: AppClipScene = { id: "panel", type: "app", clip: "rec:x", from: 0, duration: 6, crop, box: { x: "center", y: "center", w: 1520, h: 936 }, focus: [{ id: "fail", at: 1.5, text: "payments", textPx: 22 }] };
	const film = { id: "t", title: "t", fps: 30, crf: 26, loudness: { target: -14, tolerance: 1 }, cuts: [{ aspect: "16:9", out: "film", scenes: [{ id: "intro", type: "title", duration: 4, text: { title: "A", y: 1, titleSize: 1 } }, app], captions: { vtt: false, burned: false } }] } as Film;
	const resolve: ResolveFocus = async (_s, f) => f.map((x): ResolvedFocus => ({ ...x, rect: { x: 400, y: 700, w: 400, h: 60 }, via: "ocr" }));
	const cut: Cut = { aspect: "9:16", out: "film-v", scenes: [], captions: { vtt: false, burned: false }, reframe: { from: "film", profile: "social-vertical" } };

	test("one shot per scene, offset by the scene's start; focus windows are in CUT seconds, rects in OUTPUT px", async () => {
		const derived = await reframeCut(film, cut, resolve);
		const sc = sidecarFor(film, derived, { intro: 0, panel: 4 });
		expect(sc.shots.map((s) => [s.id, s.start, s.end])).toEqual([["intro", 0, 4], ["panel", 4, 10]]);
		const shot = sc.shots[1]!;
		const f = shot.focuses[0]!;
		expect(f.from).toBeGreaterThanOrEqual(4 + 1.5);
		expect(f.rect.w).toBeGreaterThan(400); // zoomed in: bigger than its 400 source px at fit 0.42
		expect(shot.viewport).toEqual(layoutFor("9:16").viewport);
		expect(sc.frame).toEqual({ w: 1080, h: 1920 });
	});

	test("the sidecar's focus plan is what the planner reports (the lint and the render never disagree)", async () => {
		const derived = await reframeCut(film, cut, resolve);
		const scene = derived.scenes[1] as AppClipScene;
		const sc = sidecarFor(film, derived, { intro: 0, panel: 4 });
		const again = planCamera({ source: { w: 2560, h: 1576 }, viewport: scene.viewport!, frame: { w: 1080, h: 1920 }, scale: 2 }, { minTextPx: 18, displayHeight: 844 }, sc.shots[1]!.limits, scene.camera!.focuses, 6);
		expect(sc.shots[1]!.focuses[0]!.zoom).toBeCloseTo(again.report[0]!.zoom, 9);
	});
});

describe("sidecarFor: a terminal scene in a viewport is a camera shot too (a still: its text is the take's own)", () => {
	// Incident: the 9:16 social cut's TUI beat (v2) had no viewport in the sidecar, so the lint judged 115 lines of the
	// take's own 6 px log text and called its window cropped, as if it were authored typography.
	const term: TerminalScene = { id: "v2", type: "terminal", take: "take:tui", segments: [[19, 24]], width: 972, duration: 5 };
	const film = { id: "t", title: "t", fps: 30, crf: 26, loudness: { target: -14, tolerance: 1 }, cuts: [], sources: [{ aspect: "16:9", out: "film", scenes: [term], captions: { vtt: false, burned: false } }] } as Film;
	const cut: Cut = { aspect: "9:16", out: "film-v", scenes: [], captions: { vtt: false, burned: false }, reframe: { from: "film", profile: "social-vertical" } };

	test("its shot carries the viewport and no focuses", async () => {
		const derived = await reframeCut(film, cut, async () => []);
		const sc = sidecarFor(film, derived, { v2: 0 });
		expect(sc.shots[0]!.viewport).toEqual(layoutFor("9:16").viewport);
		expect(sc.shots[0]!.focuses).toEqual([]);
	});
});
