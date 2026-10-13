// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { TimelineBuilder, cameraTrack, captionTrack, parseTimeline, shift } from "./timeline.ts";

const size = { width: 1280, height: 800, scale: 2 };

function sample() {
	const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 1000 } });
	b.begin({ index: 0, do: "pause", id: "intro" }, 1000);
	b.end(1500);
	b.begin({ index: 1, do: "zoom" }, 1500, { x: 100, y: 50, width: 400, height: 300 });
	b.camera({ target: { x: 100, y: 50, width: 400, height: 300 }, scale: 1.6, ms: 700 });
	b.end(2300, { x: 100, y: 50, width: 400, height: 300 });
	b.begin({ index: 2, do: "caption" }, 2300);
	b.caption({ text: "Hello", ms: 1500 });
	b.end(3800);
	b.cursor(1600, 10, 20);
	b.cursor(1700, 30, 40);
	return b;
}

describe("TimelineBuilder", () => {
	test("step times are stored relative to the capture origin, in ms", () => {
		const t = sample().finish({ ended_ms: 3800 });
		expect(t.steps[0]).toMatchObject({ index: 0, do: "pause", id: "intro", start_ms: 0, end_ms: 500 });
		expect(t.steps[1]).toMatchObject({ start_ms: 500, end_ms: 1300 });
		expect(t.duration_ms).toBe(2800);
	});

	test("rects are kept for the step start and end (the element may move)", () => {
		const t = sample().finish({ ended_ms: 3800 });
		expect(t.steps[1].rect_start).toEqual({ x: 100, y: 50, width: 400, height: 300 });
		expect(t.steps[1].rect_end).toEqual({ x: 100, y: 50, width: 400, height: 300 });
		expect(t.steps[0].rect_start).toBeUndefined();
	});

	test("a step that never ended is closed at finish with ok=false and the reason, not dropped", () => {
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 0 } });
		b.begin({ index: 0, do: "wait" }, 100);
		const t = b.finish({ ended_ms: 900, error: "timeout waiting for .x" });
		expect(t.steps[0]).toMatchObject({
			start_ms: 100,
			end_ms: 900,
			ok: false,
			error: "timeout waiting for .x",
		});
	});

	test("begin while another step is open is a programming error", () => {
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 0 } });
		b.begin({ index: 0, do: "pause" }, 0);
		expect(() => b.begin({ index: 1, do: "pause" }, 5)).toThrow(/still open/);
	});

	test("time can never go backwards (the script clock is monotonic)", () => {
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 1000 } });
		b.begin({ index: 0, do: "pause" }, 1200);
		expect(() => b.end(1100)).toThrow(/backwards/);
	});

	test("cursor samples are relative to the origin and must be strictly increasing", () => {
		const t = sample().finish({ ended_ms: 3800 });
		expect(t.cursor).toEqual([
			{ t: 600, x: 10, y: 20 },
			{ t: 700, x: 30, y: 40 },
		]);
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 0 } });
		b.cursor(10, 0, 0);
		expect(() => b.cursor(10, 1, 1)).toThrow(/increasing/);
	});

	test("camera and caption hints carry the step's start time", () => {
		const t = sample().finish({ ended_ms: 3800 });
		expect(cameraTrack(t)).toEqual([
			{ t: 500, ms: 700, scale: 1.6, target: { x: 100, y: 50, width: 400, height: 300 } },
		]);
		expect(captionTrack(t)).toEqual([{ t: 1300, ms: 1500, text: "Hello" }]);
	});

	test("shots and marks are recorded with their time", () => {
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 0 } });
		b.begin({ index: 0, do: "shot" }, 40);
		b.shot({ name: "panel", file: "/tmp/panel.png", width: 2560, height: 1600 });
		b.end(60);
		b.begin({ index: 1, do: "mark" }, 80);
		b.mark("money-shot");
		b.end(80);
		const t = b.finish({ ended_ms: 100 });
		expect(t.shots).toEqual([{ t: 40, name: "panel", file: "/tmp/panel.png", width: 2560, height: 1600 }]);
		expect(t.marks).toEqual([{ t: 80, name: "money-shot" }]);
	});
});

describe("focus hints", () => {
	function withFocus() {
		const b = new TimelineBuilder({ size, fps: 60, clock: { origin_ms: 1000 } });
		b.begin({ index: 0, do: "focus", id: "read" }, 1500, { x: 1, y: 2, width: 30, height: 40 });
		b.focus({
			target: { x: 1, y: 2, width: 30, height: 40 },
			label: "Services",
			ms: 1800,
			textPx: 11,
			selector: ".panel",
		});
		b.end(3300, { x: 1, y: 2, width: 30, height: 40 });
		return b.finish({ ended_ms: 3300 });
	}

	test("the builder starts with no focus hints and stamps the step's start time", () => {
		expect(sample().finish({ ended_ms: 3800 }).focus).toEqual([]);
		expect(withFocus().focus).toEqual([
			{
				t: 500,
				ms: 1800,
				target: { x: 1, y: 2, width: 30, height: 40 },
				label: "Services",
				textPx: 11,
				selector: ".panel",
			},
		]);
	});

	test("JSON written by the real builder parses back identical, focus included", () => {
		const t = withFocus();
		const r = parseTimeline(JSON.parse(JSON.stringify(t)));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.timeline).toEqual(t);
	});

	test("a timeline recorded before focus existed (no `focus` key) still parses, as no hints", () => {
		const old = JSON.parse(JSON.stringify(sample().finish({ ended_ms: 3800 })));
		delete old.focus;
		const r = parseTimeline(old);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.timeline.focus).toEqual([]);
	});

	test("a present `focus` must be a list of well-formed hints", () => {
		const t = JSON.parse(JSON.stringify(withFocus()));
		expect(parseTimeline({ ...t, focus: "x" }).ok).toBe(false);
		expect(parseTimeline({ ...t, focus: {} }).ok).toBe(false);
		expect(parseTimeline({ ...t, focus: [null] }).ok).toBe(false);
		const noSel = structuredClone(t);
		delete noSel.focus[0].selector;
		expect(parseTimeline(noSel).ok).toBe(false);
		const badRect = structuredClone(t);
		badRect.focus[0].target = { x: 1 };
		expect(parseTimeline(badRect).ok).toBe(false);
		const badT = structuredClone(t);
		badT.focus[0].t = "0";
		expect(parseTimeline(badT).ok).toBe(false);
	});

	test("shift moves focus.t like every other track and keeps the rest", () => {
		const s = shift(withFocus(), -200);
		expect(s.focus[0]).toMatchObject({ t: 300, ms: 1800, selector: ".panel", label: "Services" });
		expect(shift(withFocus(), -5000).focus[0].t).toBe(0);
	});
});

describe("shift (align the timeline to the video's first frame)", () => {
	test("moves every time by the same delta and drops what falls before t=0", () => {
		const t = sample().finish({ ended_ms: 3800 });
		const s = shift(t, -200); // the first frame arrived 200 ms after the clock origin
		expect(s.steps[0]).toMatchObject({ start_ms: 0, end_ms: 300 }); // clamped at 0, not negative
		expect(s.steps[1]).toMatchObject({ start_ms: 300, end_ms: 1100 });
		expect(s.cursor[0].t).toBe(400);
		expect(s.duration_ms).toBe(2600);
		expect(cameraTrack(s)[0].t).toBe(300);
	});

	test("never produces negative times or end < start", () => {
		const t = sample().finish({ ended_ms: 3800 });
		for (const d of [-5000, -1, 0, 1, 777]) {
			const s = shift(t, d);
			for (const st of s.steps) {
				expect(st.start_ms).toBeGreaterThanOrEqual(0);
				expect(st.end_ms).toBeGreaterThanOrEqual(st.start_ms);
			}
			for (const c of s.cursor) expect(c.t).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("parseTimeline (what Studio reads back from disk)", () => {
	test("round-trips what the builder produced", () => {
		const t = sample().finish({ ended_ms: 3800 });
		const r = parseTimeline(JSON.parse(JSON.stringify(t)));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.timeline).toEqual(t);
	});

	test("refuses a wrong version, overlapping steps, and a step past the duration", () => {
		const t = JSON.parse(JSON.stringify(sample().finish({ ended_ms: 3800 })));
		expect(parseTimeline({ ...t, version: 9 }).ok).toBe(false);
		const overlap = structuredClone(t);
		overlap.steps[1].start_ms = 100;
		expect(parseTimeline(overlap).ok).toBe(false);
		const past = structuredClone(t);
		past.steps[2].end_ms = past.duration_ms + 1;
		expect(parseTimeline(past).ok).toBe(false);
	});

	test("garbage is an error list, not an exception", () => {
		for (const v of [null, 3, "x", [], {}]) expect(parseTimeline(v).ok).toBe(false);
	});
});
