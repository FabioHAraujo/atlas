import { describe, expect, test } from "bun:test";
import type { AppClipScene, Cut, Film, TerminalScene, TitleScene } from "../lib/types.ts";
import { PROFILES } from "../lint/profiles.ts";
import { layoutFor, reframeCut, type ResolveFocus } from "./reframe.ts";
import type { ResolvedFocus } from "./types.ts";

const crop = { x: 0, y: 4, w: 2560, h: 1576 };
const app: AppClipScene = {
	id: "panel",
	type: "app",
	clip: "rec:site-media/panel",
	from: 2.2,
	duration: 6,
	bg: "a",
	crop,
	box: { x: "center", y: "center", w: 1520, h: 936 },
	focus: [
		{ id: "kpi", at: 1, text: "Services", textPx: 22, label: "5 of 7 up" },
		{ id: "fail", at: 3.2, text: "payments", textPx: 22, label: "payments failed" },
	],
};
const title: TitleScene = { id: "intro", type: "title", duration: 4.5, text: { title: "Atlas", subtitle: "Your whole dev stack. One file.", y: 650, titleSize: 150 } };
const wide: Cut = { aspect: "16:9", out: "film", scenes: [title, app], captions: { vtt: true, burned: false } };
const film = { id: "t", title: "t", fps: 30, crf: 26, loudness: { target: -14, tolerance: 1 }, cuts: [wide] } as Film;

// A resolver that answers from fixed source rects: the reframe is pure given resolved focuses (the I/O is injected).
const resolve: ResolveFocus = async (_scene, focus) =>
	focus.map((f, i): ResolvedFocus => ({ ...f, rect: { x: 300 + 700 * i, y: 500 + 300 * i, w: 360, h: 60 }, via: "ocr" }));

const derived = (aspect: "9:16" | "1:1" | "4:5"): Cut => ({ aspect, out: `film-${aspect}`, scenes: [], captions: { vtt: false, burned: true }, reframe: { from: "film", profile: aspect === "9:16" ? "social-vertical" : aspect === "1:1" ? "social-square" : "social-portrait" } });

describe("reframe: the same film data, one cut per rendition", () => {
	test("every source scene yields one scene with the same id, duration and clip, in order", async () => {
		const cut = await reframeCut(film, derived("9:16"), resolve);
		expect(cut.scenes.map((s) => s.id)).toEqual(["intro", "panel"]);
		expect(cut.scenes.map((s) => s.duration)).toEqual([4.5, 6]);
		const a = cut.scenes[1] as AppClipScene;
		expect(a.clip).toBe(app.clip);
		expect(a.from).toBe(app.from);
	});

	test("the app scene gets a camera planned for THIS rendition (zoom differs between 9:16 and 1:1)", async () => {
		const v = (await reframeCut(film, derived("9:16"), resolve)).scenes[1] as AppClipScene;
		const s = (await reframeCut(film, derived("1:1"), resolve)).scenes[1] as AppClipScene;
		expect(v.camera?.keys.length).toBeGreaterThan(1);
		const zoom = (c: AppClipScene) => Math.max(...c.camera!.keys.map((k) => k.zoom));
		expect(zoom(v)).not.toBeCloseTo(zoom(s), 2);
	});

	test("the viewport is inside the frame and, on a vertical cut, between the headline and the caption zone", async () => {
		const v = (await reframeCut(film, derived("9:16"), resolve)).scenes[1] as AppClipScene;
		const safe = PROFILES["social-vertical"]!.safe!;
		expect(v.viewport!.y).toBeGreaterThanOrEqual(0);
		expect(v.viewport!.y + v.viewport!.h).toBeLessThanOrEqual(1920 * (1 - safe.bottom));
		expect(v.viewport!.x + v.viewport!.w).toBeLessThanOrEqual(1080);
	});

	test("the first frame is a complete, legible thumbnail: the shot opens on the whole window, then moves in", async () => {
		const v = (await reframeCut(film, derived("9:16"), resolve)).scenes[1] as AppClipScene;
		expect(v.camera!.keys[0]).toMatchObject({ t: 0, zoom: 1 });
	});

	test("a title scene is re-laid-out for the aspect: its text stays inside the platform safe area", async () => {
		const cut = await reframeCut(film, derived("9:16"), resolve);
		const t = cut.scenes[0] as TitleScene;
		const safe = PROFILES["social-vertical"]!.safe!;
		expect(t.text.y).toBeGreaterThanOrEqual(1920 * safe.top);
		expect(t.text.maxWidth).toBeLessThanOrEqual(1080 * (1 - safe.left - safe.right));
	});

	test("the source cut is not mutated and a second run gives the identical cut (deterministic)", async () => {
		const before = JSON.stringify(film);
		const a = await reframeCut(film, derived("9:16"), resolve);
		const b = await reframeCut(film, derived("9:16"), resolve);
		expect(JSON.stringify(film)).toBe(before);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	test("camera.json overrides replace the planned zoom of exactly one focus", async () => {
		const base = (await reframeCut(film, derived("9:16"), resolve)).scenes[1] as AppClipScene;
		const over = (await reframeCut(film, derived("9:16"), resolve, { "film-9:16/panel/fail": { zoom: 1.5 } })).scenes[1] as AppClipScene;
		const z = (c: AppClipScene, id: string) => c.camera!.keys.find((k) => k.focus === id)!.zoom;
		expect(z(over, "fail")).toBeCloseTo(1.5, 5);
		expect(z(over, "kpi")).toBeCloseTo(z(base, "kpi"), 5);
	});

	test("an app scene without focus keeps a still, whole-window camera (nothing to read, nothing to chase)", async () => {
		const bare: Film = { ...film, cuts: [{ ...wide, scenes: [{ ...app, focus: undefined }] }] };
		const v = (await reframeCut(bare, derived("9:16"), resolve)).scenes[0] as AppClipScene;
		expect(v.camera!.keys).toHaveLength(1);
	});
});

describe("layouts per aspect", () => {
	test("each rendition has a viewport region and a headline band that do not overlap", () => {
		for (const a of ["9:16", "1:1", "4:5"] as const) {
			const l = layoutFor(a);
			expect(l.headline.y + l.headline.h).toBeLessThanOrEqual(l.viewport.y);
		}
	});
});

describe("headline overlays are placed by the layout, never by film data", () => {
	const withOverlay: AppClipScene = { ...app, overlay: { title: "Live panel", subtitle: "health, CPU, memory", y: 0, titleSize: 100, subtitleSize: 64 } };
	const f2: Film = { ...film, cuts: [{ ...wide, scenes: [withOverlay] }] };

	test("the overlay sits inside the headline band of the aspect, above the viewport and below the top UI", async () => {
		for (const a of ["9:16", "1:1", "4:5"] as const) {
			const s = (await reframeCut(f2, derived(a), resolve)).scenes[0] as AppClipScene;
			const l = layoutFor(a);
			expect(s.overlay!.y).toBeGreaterThanOrEqual(l.headline.y);
			expect(s.overlay!.y + s.overlay!.titleSize + (s.overlay!.subtitleSize ?? 0)).toBeLessThanOrEqual(l.headline.y + l.headline.h + 8);
			expect(s.overlay!.maxWidth).toBeLessThanOrEqual(l.headline.w);
		}
	});

	test("a headline too big for the band is scaled down to fit it, keeping the subtitle under the title", async () => {
		const big: AppClipScene = { ...app, overlay: { title: "A GPU terminal", subtitle: "emoji and images", y: 0, titleSize: 200, subtitleSize: 120 } };
		const s = (await reframeCut({ ...film, cuts: [{ ...wide, scenes: [big] }] }, derived("1:1"), resolve)).scenes[0] as AppClipScene;
		const l = layoutFor("1:1");
		expect(s.overlay!.titleSize + s.overlay!.subtitleSize!).toBeLessThanOrEqual(l.headline.h);
	});
});

describe("a terminal scene gets a viewport too (the same layout, the take as the source)", () => {
	test("viewport set, box replaced, overlay placed", async () => {
		const term: TerminalScene = { id: "v2", type: "terminal", take: "take:tui", segments: [[19, 24]], width: 972, duration: 5, overlay: { title: "atlas dev", subtitle: "x", y: 0, titleSize: 100, subtitleSize: 64 } };
		const f2: Film = { ...film, cuts: [{ ...wide, scenes: [term] }] };
		const s = (await reframeCut(f2, derived("9:16"), resolve)).scenes[0] as TerminalScene;
		expect(s.viewport).toEqual(layoutFor("9:16").viewport);
		expect(s.overlay!.y).toBeGreaterThanOrEqual(layoutFor("9:16").headline.y);
	});
});

describe("title text is centered on the SAFE rect, not on the frame (the right rail is wider than the left margin)", () => {
	// Incident: "Open source. Free." was centered on the 1080 px frame and ran 23 px into Reels' right rail (14%).
	test("a title's horizontal center is the center of the safe rect", async () => {
		const cut = await reframeCut(film, derived("9:16"), resolve);
		const t = cut.scenes[0] as TitleScene;
		const safe = PROFILES["social-vertical"]!.safe!;
		const center = (1080 * safe.left + (1080 - 1080 * safe.right)) / 2;
		expect(t.text.centerX).toBeCloseTo(center, 0);
	});
});

describe("headlines meet the profile's own legibility floor (incident: 18-26 px warnings on 'One file. Whole stack.' and 'in their own worktrees')", () => {
	// overlayFor scaled the headline to the band; the band must be tall enough that the SUBTITLE still reaches minTextPx.
	test("every aspect's headline band holds a title and a subtitle at the profile's minimum font", () => {
		for (const [a, profile] of [["9:16", "social-vertical"], ["1:1", "social-square"], ["4:5", "social-portrait"]] as const) {
			const p = PROFILES[profile]!;
			const frameH = a === "9:16" ? 1920 : a === "1:1" ? 1080 : 1350;
			const minFont = Math.ceil((p.minTextPx / 0.8) * (frameH / p.displayHeight));
			expect(layoutFor(a).headline.h, a).toBeGreaterThanOrEqual(minFont * 1.1 * 2 + 12);
		}
	});

	test("a long headline is wrapped inside the band, not shrunk below the floor", async () => {
		const o: AppClipScene = { ...app, overlay: { title: "A GPU terminal", subtitle: "in their own worktrees", y: 0, titleSize: 100, subtitleSize: 64 } };
		const s = (await reframeCut({ ...film, cuts: [{ ...wide, scenes: [o] }] }, derived("9:16"), resolve)).scenes[0] as AppClipScene;
		const minFont = Math.ceil((PROFILES["social-vertical"]!.minTextPx / 0.8) * (1920 / 844));
		expect(s.overlay!.subtitleSize).toBeGreaterThanOrEqual(minFont);
		expect(s.overlay!.titleSize).toBeGreaterThanOrEqual(minFont);
	});
});

describe("the headline block clears the viewport (incident: 'health, CPU, memory' ran into the picture on 4:5 and 1:1)", () => {
	// A titleblock is title (size x ~1.1 line) + a 22 px margin + subtitle (size x ~1.1 line): the old estimate ignored the
	// margin and the line-height, so a band that 'fit' on paper overlapped the viewport by ~25 px.
	test("title + margin + subtitle, as the title block draws them, end above the viewport on every aspect", async () => {
		for (const a of ["9:16", "1:1", "4:5"] as const) {
			const o: AppClipScene = { ...app, overlay: { title: "Live panel", subtitle: "health, CPU, memory", y: 0, titleSize: 100, subtitleSize: 64 } };
			const s = (await reframeCut({ ...film, cuts: [{ ...wide, scenes: [o] }] }, derived(a), resolve)).scenes[0] as AppClipScene;
			const ov = s.overlay!;
			const bottom = ov.y + ov.titleSize * 1.1 + 22 + (ov.subtitleSize ?? 0) * 1.1;
			expect(bottom, a).toBeLessThanOrEqual(s.viewport!.y);
		}
	});
});
