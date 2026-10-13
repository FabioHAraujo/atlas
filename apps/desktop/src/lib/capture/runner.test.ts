// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { runScript } from "./runner.ts";
import { parseScript } from "./script.ts";

/** A virtual clock: `sleep` advances time, nothing really waits. */
function world(over = {}, firstFrameOffset = 0) {
	let t = 1_000_000;
	const log: string[] = [];
	const rects: Record<string, any> = {
		".panel": { x: 10, y: 10, width: 300, height: 200 },
		".btn": { x: 400, y: 300, width: 80, height: 30 },
	};
	const env = {
		now: () => t,
		sleep: async (ms: number) => void (t += ms),
		log,
		native: {
			async start(a) {
				log.push(`native.start ${a.fps} ${a.size.width}x${a.size.height}`);
				t += 20; // the call itself takes time
				return {
					out: a.out,
					width: a.size.width * 2,
					height: a.size.height * 2,
					scale: 2,
					started_epoch_ms: t,
				};
			},
			async stop() {
				log.push("native.stop");
				return {
					frames: 100,
					max_gap_ms: 30,
					first_frame_offset_ms: firstFrameOffset,
					duration_ms: 5000,
					out: "/tmp/v.mov",
					width: 2560,
					height: 1600,
					bytes: 1,
				};
			},
			async shot(a) {
				log.push(`native.shot ${a.out}`);
				return { out: a.out, bytes: 5 };
			},
		},
		app: {
			rect: (sel) => rects[sel],
			click: async (a) => (log.push(`click ${a.selector ?? a.text}`), true),
			type: async (sel, text) => void log.push(`type ${sel} ${text}`),
			key: (c) => void log.push(`key ${c}`),
			view: async (v) => void log.push(`view ${v}`),
			worktree: async (p, n) => void log.push(`worktree ${p}/${n ?? "main"}`),
			tab: async (k) => void log.push(`tab ${k}`),
			terminal: async (argv) => void log.push(`terminal ${argv.join(" ")}`),
			run: async (cmd) => void log.push(`run ${cmd}`),
			scroll: async (sel, to) => void log.push(`scroll ${sel} ${to}`),
			terminalHas: async () => true,
			textVisible: () => true,
			cursor: { moveTo: async () => {}, show() {}, hide() {} },
			caption: () => {},
		},
		...over,
	};
	return env;
}
const script = (steps, extra = {}) => {
	const r = parseScript({ version: 1, size: { width: 1280, height: 800 }, steps, ...extra });
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.script;
};

describe("runScript", () => {
	test("starts the recorder before the first step and stops it after the last, in that order", async () => {
		const w = world();
		await runScript(
			script([
				{ do: "pause", ms: 200 },
				{ do: "click", selector: ".btn" },
			]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(w.log[0]).toBe("native.start 60 1280x800");
		expect(w.log.at(-1)).toBe("native.stop");
		expect(w.log).toContain("click .btn");
	});

	test("timeline step times follow the virtual clock exactly: a 200 ms pause is a 200 ms step", async () => {
		const w = world();
		const r = await runScript(
			script([
				{ do: "pause", ms: 200 },
				{ do: "pause", ms: 300 },
			]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		const [a, b] = r.timeline.steps;
		expect(a.end_ms - a.start_ms).toBe(200);
		expect(b.end_ms - b.start_ms).toBe(300);
		expect(b.start_ms).toBe(a.end_ms);
	});

	test("the timeline is aligned to the video's first frame using the recorder's measured offset", async () => {
		const w = world({}, 40); // the picture starts 40 ms after the clock origin
		const r = await runScript(
			script([{ do: "pause", ms: 100 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		const first = r.timeline.steps[0];
		expect(first.start_ms).toBe(0); // clamped: nothing is before the first frame
		expect(first.end_ms).toBe(100 - 40);
		expect(r.timeline.video).toMatchObject({ frames: 100, max_gap_ms: 30, first_frame_offset_ms: 40 });
	});

	test("focus records rect, label, selector and the viewer's time, taking exactly its declared ms", async () => {
		const w = world();
		const r = await runScript(
			script([{ do: "focus", target: ".panel", label: "Every service", ms: 1800, textPx: 11, id: "read" }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.ok).toBe(true);
		expect(r.timeline.focus).toHaveLength(1);
		expect(r.timeline.focus[0]).toMatchObject({
			target: { x: 10, y: 10, width: 300, height: 200 },
			label: "Every service",
			ms: 1800,
			textPx: 11,
			selector: ".panel",
		});
		const s = r.timeline.steps[0];
		expect(r.timeline.focus[0].t).toBe(s.start_ms);
		expect(s.end_ms - s.start_ms).toBe(1800);
		expect(s.rect_start).toEqual({ x: 10, y: 10, width: 300, height: 200 });
		expect(s.rect_end).toEqual({ x: 10, y: 10, width: 300, height: 200 });
	});

	test("focus without label/textPx records neither key (nothing invented)", async () => {
		const r = await runScript(
			script([{ do: "focus", target: ".btn", ms: 500 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			world(),
		);
		expect(Object.keys(r.timeline.focus[0]).sort()).toEqual(["ms", "selector", "t", "target"]);
	});

	test("focus fails naming the selector when no element matches, and the recorder still stops", async () => {
		const w = world();
		const r = await runScript(
			script([{ do: "focus", target: ".nope", ms: 500 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.ok).toBe(false);
		expect(r.error).toContain("focus: no element matches .nope");
		expect(r.timeline.focus).toEqual([]);
		expect(w.log.at(-1)).toBe("native.stop");
	});

	test("focus does not touch the page: no click, key, scroll, caption or cursor movement", async () => {
		const w = world();
		const touched: string[] = [];
		w.app.caption = (t) => void touched.push(`caption ${t}`);
		w.app.cursor.moveTo = async () => void touched.push("cursor");
		await runScript(
			script([{ do: "focus", target: ".panel", label: "x", ms: 300 }], { cursor: true }),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(w.log.filter((l) => !l.startsWith("native."))).toEqual([]);
		expect(touched.filter((t) => t !== "caption null")).toEqual([]);
	});

	test("focus recorded before the video's first frame is shifted with the rest of the timeline", async () => {
		const r = await runScript(
			script([
				{ do: "pause", ms: 200 },
				{ do: "focus", target: ".panel", ms: 400 },
			]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			world({}, 40),
		);
		expect(r.timeline.focus[0].t).toBe(200 - 40);
	});

	test("zoom records the target rect and a camera hint, and takes its declared time", async () => {
		const w = world();
		const r = await runScript(
			script([{ do: "zoom", target: ".panel", scale: 1.5, ms: 600 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.timeline.camera).toHaveLength(1);
		expect(r.timeline.camera[0]).toMatchObject({
			scale: 1.5,
			ms: 600,
			target: { x: 10, y: 10, width: 300, height: 200 },
		});
		expect(r.timeline.steps[0].rect_start).toEqual({ x: 10, y: 10, width: 300, height: 200 });
		const s = r.timeline.steps[0];
		expect(s.end_ms - s.start_ms).toBe(600);
	});

	test("a shot step writes a PNG named after the step into shotsDir and is listed in the timeline", async () => {
		const w = world();
		const r = await runScript(
			script([{ do: "shot", name: "panel" }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(w.log).toContain("native.shot /tmp/s/panel.png");
		expect(r.timeline.shots[0]).toMatchObject({ name: "panel", file: "/tmp/s/panel.png" });
	});

	test("a failing step stops the script, still stops the recorder, and returns the partial timeline with the reason", async () => {
		const w = world();
		w.app.click = async () => {
			throw new Error("no element matches .gone");
		};
		const r = await runScript(
			script([
				{ do: "pause", ms: 50 },
				{ do: "click", selector: ".gone" },
				{ do: "pause", ms: 999 },
			]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/\.gone/);
		expect(w.log.at(-1)).toBe("native.stop");
		expect(r.timeline.steps).toHaveLength(2);
		expect(r.timeline.steps[1]).toMatchObject({ ok: false, error: expect.stringMatching(/\.gone/) });
	});

	test("wait polls until the condition holds and fails with the selector after the timeout", async () => {
		const w = world();
		let n = 0;
		w.app.rect = (sel) => (sel === ".ready" && ++n >= 4 ? { x: 0, y: 0, width: 1, height: 1 } : undefined);
		const ok = await runScript(
			script([{ do: "wait", selector: ".ready", timeoutMs: 5000 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(ok.ok).toBe(true);
		expect(ok.timeline.steps[0].end_ms - ok.timeline.steps[0].start_ms).toBeGreaterThan(0);

		const w2 = world();
		w2.app.rect = () => undefined;
		const bad = await runScript(
			script([{ do: "wait", selector: ".never", timeoutMs: 1000 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w2,
		);
		expect(bad.ok).toBe(false);
		expect(bad.error).toMatch(/\.never/);
		expect(bad.error).toMatch(/1000/);
	});

	test("the native recorder failing to start aborts before any step runs", async () => {
		const w = world();
		w.native.start = async () => {
			throw new Error("Screen Recording permission is missing");
		};
		const r = await runScript(
			script([{ do: "click", selector: ".btn" }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/permission/);
		expect(w.log).not.toContain("click .btn");
		expect(w.log).not.toContain("native.stop");
	});

	test("cursor: true moves the pointer to a click target and records the samples", async () => {
		const w = world();
		const moves: any[] = [];
		w.app.cursor.moveTo = async (p, ms, sample) => {
			moves.push(p);
			sample(w.now(), p.x, p.y);
		};
		const r = await runScript(
			script([{ do: "click", selector: ".btn" }], { cursor: true }),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(moves[0]).toEqual({ x: 440, y: 315 }); // center of .btn
		expect(r.timeline.cursor.length).toBeGreaterThan(0);
	});

	test("a script without cursor never touches the overlay", async () => {
		const w = world();
		let shown = false;
		w.app.cursor.show = () => (shown = true);
		await runScript(
			script([{ do: "click", selector: ".btn" }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(shown).toBe(false);
	});

	test("timeline size carries the scale the recorder reported (retina = 2)", async () => {
		const w = world();
		const r = await runScript(
			script([{ do: "pause", ms: 10 }]),
			{ out: "/tmp/v.mov", shotsDir: "/tmp/s" },
			w,
		);
		expect(r.timeline.size).toEqual({ width: 1280, height: 800, scale: 2 });
	});
});
