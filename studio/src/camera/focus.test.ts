import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Timeline, TimelineBuilder, shift } from "../../../apps/desktop/src/lib/capture/timeline.ts";
import { CACHE, StudioError } from "../lib/paths.ts";
import type { Crop } from "../lib/types.ts";
import { bestLine, readFocusHints, resolveFocuses, timelineOfClip, toSource } from "./focus.ts";

const CAPTURES = join(CACHE, "captures/site-media");
const PANEL = join(CAPTURES, "89d610f57eedc3af");
const scratch = join(CACHE, "focus-test");
mkdirSync(scratch, { recursive: true });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A recording timeline as the app writes it: the REAL builder, then the runner's shift and the JSON on disk.
// 1280x800 CSS px window at scale 2 (the film's recordings), focus steps at 500 ms and 4000 ms.
function recorded(): Timeline {
	const b = new TimelineBuilder({ size: { width: 1280, height: 800, scale: 2 }, fps: 60, clock: { origin_ms: 1000 } });
	b.begin({ index: 0, do: "focus", id: "a" }, 1500, { x: 100, y: 50, width: 400, height: 300 });
	b.focus({ target: { x: 100, y: 50, width: 400, height: 300 }, label: "Services", ms: 1800, textPx: 11, selector: ".panel" });
	b.end(3300, { x: 100, y: 50, width: 400, height: 300 });
	b.begin({ index: 1, do: "focus", id: "b" }, 5000, { x: 120, y: 60, width: 400, height: 300 });
	b.focus({ target: { x: 120, y: 60, width: 400, height: 300 }, ms: 1000, selector: ".panel" });
	b.end(6000, { x: 120, y: 60, width: 400, height: 300 });
	b.begin({ index: 2, do: "focus", id: "c" }, 6000, { x: 900, y: 700, width: 400, height: 200 });
	b.focus({ target: { x: 900, y: 700, width: 400, height: 200 }, ms: 500, selector: ".footer" });
	b.end(6500, { x: 900, y: 700, width: 400, height: 200 });
	return shift(b.finish({ ended_ms: 6500 }), -20);
}

function writeTimeline(name: string, t: unknown): string {
	const p = join(scratch, `${name}.json`);
	writeFileSync(p, JSON.stringify(t));
	return p;
}

const crop: Crop = { x: 0, y: 4, w: 2560, h: 1576 };

/** What the CLI prints for a StudioError: the message and its hint. */
function printed(fn: () => unknown): string {
	try {
		fn();
	} catch (e) {
		if (e instanceof StudioError) return `${e.message}\n${e.hint ?? ""}`;
		throw e;
	}
	throw new Error("did not throw");
}

describe("readFocusHints", () => {
	test("reads the hints the real builder wrote, shifted onto the video's clock", () => {
		const hints = readFocusHints(writeTimeline("rec", recorded()));
		expect(hints.map((h) => [h.selector, h.t])).toEqual([
			[".panel", 480],
			[".panel", 3980],
			[".footer", 4980],
		]);
		expect(hints[0]).toMatchObject({ label: "Services", textPx: 11, ms: 1800 });
	});

	test("the cached recordings predate focus steps: they read as no hints, not as an error", () => {
		const dirs = existsSync(CAPTURES) ? readdirSync(CAPTURES).filter((d) => existsSync(join(CAPTURES, d, "timeline.json"))) : [];
		if (!dirs.length) return console.warn("skipped: no cached site-media timelines (run `bun studio run site-media`)");
		for (const d of dirs) expect(readFocusHints(join(CAPTURES, d, "timeline.json"))).toEqual([]);
	});

	test("a file that is not a timeline is a StudioError naming it", () => {
		const p = writeTimeline("bad", { version: 9 });
		expect(() => readFocusHints(p)).toThrow(StudioError);
		expect(() => readFocusHints(p)).toThrow(/bad\.json/);
	});
});

describe("timelineOfClip", () => {
	test("is the timeline.json beside the recording's video", () => {
		if (!existsSync(join(PANEL, "timeline.json"))) return console.warn("skipped: panel recording not cached");
		expect(timelineOfClip("rec:site-media/panel")).toBe(join(PANEL, "timeline.json"));
	});

	test("is undefined for recordings made before timelines existed (rec_*.mov in .cache/recording)", () => {
		if (!existsSync(join(CACHE, "recording/rec_panel.mov"))) return console.warn("skipped: legacy recording not cached");
		expect(timelineOfClip("rec:panel")).toBeUndefined();
	});
});

describe("toSource: CSS px of the window -> source px of the scene's crop", () => {
	test("multiplies by the recording's scale and subtracts the crop origin", () => {
		expect(toSource({ x: 100, y: 50, width: 400, height: 300 }, 2, crop)).toEqual({ x: 200, y: 96, w: 800, h: 600 });
	});

	test("clips to the crop: what sticks out of the window is not part of the shot", () => {
		const r = toSource({ x: 1200, y: 780, width: 200, height: 100 }, 2, crop)!;
		expect(r.x + r.w).toBeLessThanOrEqual(crop.w);
		expect(r.y + r.h).toBeLessThanOrEqual(crop.h);
		expect(r).toEqual({ x: 2400, y: 1556, w: 160, h: 20 });
	});

	test("a rect entirely outside the crop is undefined, never a negative or zero rect", () => {
		expect(toSource({ x: 3000, y: 0, width: 10, height: 10 }, 2, crop)).toBeUndefined();
		expect(toSource({ x: 0, y: 0, width: 10, height: 1 }, 2, crop)).toBeUndefined(); // y 0..2 is above the crop (y=4)
	});
});

describe("resolveFocuses: via the timeline", () => {
	const clip = "rec:test";
	const timelinePath = () => writeTimeline("rec2", recorded());
	const scene = (focus: object[], from = 0) => ({ clip, from, crop, focus }) as never;

	test("finds the hint by selector, converts to source px and takes label/textPx from it", async () => {
		const [r] = await resolveFocuses(scene([{ id: "f", at: 1, selector: ".panel" }]), { timeline: timelinePath() });
		expect(r).toMatchObject({ id: "f", via: "timeline", rect: { x: 200, y: 96, w: 800, h: 600 }, label: "Services", textPx: 11 });
	});

	test("the Focus' own label and textPx win over the hint's", async () => {
		const [r] = await resolveFocuses(scene([{ id: "f", at: 1, selector: ".panel", label: "Mine", textPx: 16 }]), { timeline: timelinePath() });
		expect(r).toMatchObject({ label: "Mine", textPx: 16 });
	});

	test("several hints with one selector: the one nearest the clip time (from + at) is used", async () => {
		const p = timelinePath();
		const early = await resolveFocuses(scene([{ id: "f", at: 0.5, selector: ".panel" }]), { timeline: p });
		const late = await resolveFocuses(scene([{ id: "f", at: 0.5, selector: ".panel" }], 4), { timeline: p }); // clip time 4.5 s
		expect(early[0]!.rect.x).toBe(200); // hint at 0.48 s: x 100 css
		expect(late[0]!.rect.x).toBe(240); // hint at 3.98 s: x 120 css
	});

	test("a selector the timeline has no hint for fails naming the selector and the ones it has", async () => {
		const err = await resolveFocuses(scene([{ id: "f", at: 1, selector: ".nope" }]), { timeline: timelinePath() }).catch((e) => e);
		expect(err).toBeInstanceOf(StudioError);
		expect(`${err.message}\n${err.hint}`).toMatch(/\.nope[\s\S]*\.panel[\s\S]*\.footer/);
	});

	test("a selector with no timeline at all says the recording has none and how to get one", async () => {
		await expect(resolveFocuses(scene([{ id: "f", at: 1, selector: ".panel" }]), { timeline: undefined })).rejects.toThrow(/focus/i);
	});

	test("a hint that falls outside the crop is an error, not an empty rect", async () => {
		const tiny = { clip, from: 0, crop: { x: 0, y: 0, w: 100, h: 100 }, focus: [{ id: "f", at: 1, selector: ".footer" }] } as never;
		await expect(resolveFocuses(tiny, { timeline: timelinePath() })).rejects.toThrow(/\.footer/);
	});
});

describe("resolveFocuses: via a given rect", () => {
	test("is passed through untouched (already source px)", async () => {
		const rect = { x: 10, y: 20, w: 300, h: 40 };
		const [r] = await resolveFocuses({ clip: "rec:x", from: 0, crop, focus: [{ id: "f", at: 0, rect }] } as never, {});
		expect(r).toMatchObject({ via: "rect", rect });
	});

	test("a focus with no selector, text or rect says which one is missing", async () => {
		await expect(resolveFocuses({ clip: "rec:x", from: 0, crop, focus: [{ id: "lonely", at: 0 }] } as never, {})).rejects.toThrow(/lonely/);
	});

	test("no focus list resolves to nothing", async () => {
		expect(await resolveFocuses({ clip: "rec:x", from: 0, crop } as never, {})).toEqual([]);
	});
});

describe("bestLine: the OCR line a text names", () => {
	const box = (text: string, conf: number, y = 0) => ({ text, conf, rect: { x: 0, y, w: 100, h: 10 } });

	test("matches case-insensitively as a substring", () => {
		expect(bestLine([box("Open Payments dashboard", 0.9), box("Other", 0.9)], "payments").text).toBe("Open Payments dashboard");
	});

	test("prefers the tightest match (closest in length), then the most confident", () => {
		const lines = [box("all payments listed below", 0.99), box("Payments", 0.7), box("payments", 0.9, 20)];
		expect(bestLine(lines, "payments").rect.y).toBe(20);
	});

	test("two equally good lines are ambiguous: it throws naming the text and listing what OCR saw", () => {
		const lines = [box("payments", 0.9, 0), box("payments", 0.9, 50), box("other", 0.9)];
		expect(printed(() => bestLine(lines, "payments"))).toMatch(/payments[\s\S]*ambiguous[\s\S]*other/i);
	});

	test("absent text throws naming the text and listing the lines", () => {
		expect(printed(() => bestLine([box("alpha", 0.9), box("beta", 0.9)], "gamma"))).toMatch(/gamma[\s\S]*alpha[\s\S]*beta/);
	});
});

// The panel recording of the site film (1280x800 CSS px at 2x, window crop {0,4,2560,1576}): the word "payments" is
// on screen at 4 s inside the left card. Vision reports where; we assert the resolved rect lies there, not exact pixels.
const panelVideo = join(PANEL, "video.mov");
const ocrTest = existsSync(panelVideo) && process.platform === "darwin" ? test : test.skip;
if (!existsSync(panelVideo)) console.warn("skipped OCR fallback: studio/.cache/captures/site-media/89d610f57eedc3af/video.mov is absent");

describe("resolveFocuses: via OCR on the source frame", () => {
	const cacheDir = join(CACHE, "focus");
	const scene = (text: string, at = 4) => ({ clip: "rec:site-media/panel", from: 0, crop, focus: [{ id: "f", at, text }] }) as never;

	ocrTest(
		"locates 'payments' at 4 s inside the crop and in the left card",
		async () => {
			const [r] = await resolveFocuses(scene("payments"), { video: panelVideo });
			expect(r!.via).toBe("ocr");
			expect(r!.rect.w).toBeGreaterThan(0);
			expect(r!.rect.h).toBeGreaterThan(0);
			expect(r!.rect.x).toBeGreaterThanOrEqual(0);
			expect(r!.rect.y).toBeGreaterThanOrEqual(0);
			expect(r!.rect.x + r!.rect.w).toBeLessThanOrEqual(crop.w);
			expect(r!.rect.y + r!.rect.h).toBeLessThanOrEqual(crop.h);
			expect(r!.rect.x).toBeLessThan(1100);
		},
		60_000,
	);

	ocrTest(
		"the result is cached under .cache/focus and the second call does not re-run OCR",
		async () => {
			const a = await resolveFocuses(scene("payments"), { video: panelVideo });
			const files = readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
			expect(files.length).toBeGreaterThan(0);
			const t0 = performance.now();
			const b = await resolveFocuses(scene("payments"), { video: panelVideo });
			expect(b).toEqual(a);
			expect(performance.now() - t0).toBeLessThan(500);
		},
		60_000,
	);

	ocrTest(
		"text that is not on screen throws naming the text and listing the OCR lines found",
		async () => {
			const run = resolveFocuses(scene("zzz-not-on-screen-zzz"), { video: panelVideo });
			await expect(run).rejects.toThrow(StudioError);
			await expect(run).rejects.toThrow(/zzz-not-on-screen-zzz/);
		},
		60_000,
	);
});
