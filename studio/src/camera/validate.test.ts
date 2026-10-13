import { describe, expect, test } from "bun:test";
import type { AppClipScene, Cut, Film } from "../lib/types.ts";
import { validateRenditions } from "./validate.ts";

const crop = { x: 0, y: 4, w: 2560, h: 1576 };
const app = (id: string, focus: AppClipScene["focus"]): AppClipScene => ({ id, type: "app", clip: "rec:x", from: 0, duration: 5, crop, box: { x: 0, y: 0, w: 100 }, focus });
const source = (scenes: Cut["scenes"]): Cut => ({ aspect: "16:9", out: "social", scenes, captions: { vtt: false, burned: false } });
const voice = { id: "v", tag: "", stability: 0.5, similarity: 0.7, model: "m", lufs: -14, lines: [] };
const rend = (over: Partial<Cut> = {}): Cut => ({ aspect: "9:16", out: "v", scenes: [], voice, captions: { vtt: false, burned: true }, reframe: { from: "social", profile: "social-vertical" }, ...over });
const film = (sources: Cut[], renditions: Cut[]): Film => ({ id: "t", title: "t", fps: 30, crf: 26, loudness: { target: -14, tolerance: 1 }, cuts: [], sources, renditions });

describe("validateRenditions: mistakes a film author can make, caught before a render", () => {
	test("a valid film has no problems", () => {
		expect(validateRenditions(film([source([app("a", [{ id: "f", at: 1, text: "x" }])])], [rend()]))).toEqual([]);
	});

	test("a rendition whose source cut does not exist names the cuts that do", () => {
		const p = validateRenditions(film([source([])], [rend({ reframe: { from: "nope", profile: "social-vertical" } })]));
		expect(p.join()).toMatch(/nope/);
		expect(p.join()).toMatch(/social/);
	});

	test("an unknown profile is caught", () => {
		expect(validateRenditions(film([source([])], [rend({ reframe: { from: "social", profile: "reels-2099" } })])).join()).toMatch(/reels-2099/);
	});

	test("the profile must match the aspect (a 9:16 cut linted as a square would pass the wrong rules)", () => {
		expect(validateRenditions(film([source([])], [rend({ reframe: { from: "social", profile: "social-square" } })])).join()).toMatch(/aspect/);
	});

	test("duplicate focus ids in a scene are caught (camera.json overrides are keyed by them)", () => {
		const f = [{ id: "f", at: 1, text: "a" }, { id: "f", at: 3, text: "b" }];
		expect(validateRenditions(film([source([app("a", f)])], [rend()])).join()).toMatch(/duplicate focus id "f"/);
	});

	test("a focus with no anchor (selector, text or rect) cannot be located", () => {
		expect(validateRenditions(film([source([app("a", [{ id: "f", at: 1 }])])], [rend()])).join()).toMatch(/selector, text or rect/);
	});

	test("a focus that starts after its scene ends can never be read", () => {
		expect(validateRenditions(film([source([app("a", [{ id: "f", at: 6, text: "x" }])])], [rend()])).join()).toMatch(/after the scene/);
	});

	test("two renditions may not write the same file", () => {
		expect(validateRenditions(film([source([])], [rend(), rend()])).join()).toMatch(/same out/);
	});

	test("a rendition that burns captions needs a voice", () => {
		expect(validateRenditions(film([source([])], [rend({ voice: undefined })])).join()).toMatch(/voice/);
	});
});
