import { describe, expect, test } from "bun:test";
import { loopMp4Args, loopWebmArgs, posterArgs, shotArgs } from "./loops.ts";
import { LOOPS } from "./site-media.ts";

describe("loop encode arguments (the site's <Clip>: 1280x800, silent, 30 fps)", () => {
	const spec = { name: "panel", capture: "panel", from: 0.5, seconds: 9 };

	test("the cut is the spec's window of the capture, scaled to 1280x800 at 30 fps, with no audio track", () => {
		const a = loopMp4Args("/in.mov", spec, 24, "/out.mp4").join(" ");
		expect(a).toContain("-ss 0.5");
		expect(a).toContain("-t 9");
		expect(a).toContain("scale=1280:800");
		expect(a).toContain("fps=30");
		expect(a).toContain("-an");
		expect(a).toContain("-crf 24");
	});

	test("the mp4 is seekable from the first byte and has a keyframe at least every 2 s (the lint caps the gap at 3 s on social profiles)", () => {
		const a = loopMp4Args("/in.mov", spec, 24, "/out.mp4").join(" ");
		expect(a).toContain("+faststart");
		expect(a).toMatch(/-g 60\b/);
	});

	test("the webm sibling is the same cut, VP9, silent", () => {
		const a = loopWebmArgs("/in.mov", spec, 34, "/out.webm").join(" ");
		expect(a).toContain("libvpx-vp9");
		expect(a).toContain("-an");
		expect(a).toContain("-ss 0.5");
		expect(a).toContain("scale=1280:800");
	});

	test("the poster is the loop's FIRST frame (what shows before the video loads), so it matches the footage", () => {
		const a = posterArgs("/in.mov", spec, "/p.jpg").join(" ");
		expect(a).toContain("-ss 0.5");
		expect(a).toContain("-frames:v 1");
		expect(a).toContain("scale=1280:800");
	});
});

describe("shot encode arguments", () => {
	test("a window PNG (2x) becomes a 2000 px wide JPEG, aspect kept (height rounded to even)", () => {
		const a = shotArgs("/in.png", "/shot.jpg").join(" ");
		expect(a).toContain("scale=2000:-2");
		expect(a).toContain("-frames:v 1");
	});
});

describe("per-loop frame rate and the encoder's text tuning", () => {
	// Incident: the new `atlas dev` take is a full terminal of text; at 30 fps / `slow` it was 1.3 MB for 10 s, over the
	// 600 KB budget even at CRF 36. The 1.0 loop was 24 fps. Text compresses far better with aq-mode 3 and veryslow.
	test("a loop may name its own frame rate (the TUI loop is 24 fps); the default stays 30", () => {
		const tui = { name: "tui", capture: "take:tui", from: 10.6, seconds: 8, fps: 24 };
		expect(loopMp4Args("/in.mp4", tui, 30, "/o.mp4").join(" ")).toContain("fps=24");
		expect(loopMp4Args("/in.mp4", tui, 30, "/o.mp4").join(" ")).toMatch(/-g 48\b/);
		expect(loopMp4Args("/in.mp4", { name: "p", capture: "p", from: 0, seconds: 9 }, 24, "/o.mp4").join(" ")).toContain("fps=30");
	});

	test("the keyframe interval is two seconds at the loop's own rate", () => {
		for (const [fps, g] of [[24, 48], [30, 60]] as const) {
			expect(loopMp4Args("/in.mov", { name: "x", capture: "x", from: 0, seconds: 9, fps }, 24, "/o.mp4").join(" ")).toMatch(new RegExp(`-g ${g}\\b`));
		}
	});

	test("text-heavy footage is encoded with veryslow and aq-mode 3", () => {
		const a = loopMp4Args("/in.mov", { name: "x", capture: "x", from: 0, seconds: 9 }, 24, "/o.mp4").join(" ");
		expect(a).toContain("veryslow");
		expect(a).toContain("aq-mode=3");
	});
});

describe("the app window's top row: the capture frame is a few px taller than the window", () => {
	// Incident (looking at the published loops): every capture is 4 px taller than the app window and its first rows are the
	// private display's wallpaper, a peach sliver. Scaled into the loop it showed as a 2 px bright line above the window
	// (and 3 px on every shot-*.jpg); only the film (crop y:4) cut it. The encoder crops what the capture measures.
	const spec = { name: "panel", capture: "panel", from: 0.5, seconds: 9 };

	test("loops crop the measured top rows off the frame before scaling", () => {
		for (const a of [loopMp4Args("/in.mov", spec, 24, "/o.mp4", 4), loopWebmArgs("/in.mov", spec, 34, "/o.webm", 4), posterArgs("/in.mov", spec, "/p.jpg", 4)]) {
			expect(a.join(" ")).toContain("crop=iw:ih-4:0:4,scale=1280:800");
		}
	});

	test("shots crop it too", () => {
		expect(shotArgs("/in.png", "/s.jpg", 4).join(" ")).toContain("crop=iw:ih-4:0:4,scale=2000:-2");
	});

	test("a frame that is exactly the window (row 0) adds no crop filter", () => {
		expect(loopMp4Args("/in.mp4", spec, 24, "/o.mp4", 0).join(" ")).not.toContain("crop=");
		expect(shotArgs("/in.png", "/s.jpg", 0).join(" ")).not.toContain("crop=");
	});

	test("the row is measured on the real footage: every new capture's window starts below a sliver, and the take (vhs) has none", async () => {
		const { topRowOf } = await import("./loops.ts");
		const { assetPath } = await import("./lib/assets.ts");
		const { existsSync } = await import("node:fs");
		const take = assetPath("take:tui");
		if (!existsSync(take)) return;
		expect(await topRowOf(take, 10.6)).toBe(0);
	});

	test("a real recipe capture measures a sliver of 1-8 rows, so the trim is not a no-op", async () => {
		const { topRowOf } = await import("./loops.ts");
		const { assetPath } = await import("./lib/assets.ts");
		const { existsSync } = await import("node:fs");
		const clip = assetPath("rec:site-media/panel");
		if (!existsSync(clip)) return;
		const top = await topRowOf(clip, 2);
		expect(top).toBeGreaterThanOrEqual(1);
		expect(top).toBeLessThanOrEqual(8);
	});
});

describe("a loop's first frame (its poster) is the scene, not its boot", () => {
	// Incident (looking at the published posters): at from 0.5 s the logs poster was a blank Logs tab with a half-hidden
	// sidebar, and the terminal and mcp posters an empty prompt. The poster is what the page shows until the video is in
	// view. A booting frame is the app's own first moment; the loop must start on a frame that has moved on from it: its
	// window content differs from the recording's frame at 0.5 s (boot) by more than render noise, except where the
	// scene itself is static at that point (spaces, panel and agents are fixture-driven and already up at 0.5 s).
	const STATIC_AT_BOOT = new Set(["workspace", "panel", "agents"]);
	test("loops of scenes that boot into an empty view start later than that view", () => {
		for (const l of LOOPS) if (!STATIC_AT_BOOT.has(l.name)) expect(l.from, `loop-${l.name} starts on its boot frame`).toBeGreaterThanOrEqual(1);
	});

	test("every loop's poster has content: its window area is not a flat colour (luma spread >= 2.4)", async () => {
		const { existsSync, mkdtempSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { assetPath } = await import("./lib/assets.ts");
		const { decode } = await import("./lint/pixels.ts");
		const { ffmpeg } = await import("./lib/exec.ts");
		const dir = mkdtempSync(join(tmpdir(), "atlas-studio-first-"));
		try {
			for (const l of LOOPS) {
				const clip = (() => {
					try {
						return assetPath(`rec:site-media/${l.capture}`);
					} catch {
						return "";
					}
				})();
				if (!clip || !existsSync(clip)) continue;
				const png = join(dir, `${l.name}.png`);
				await ffmpeg(["-ss", String(l.from), "-i", clip, "-frames:v", "1", "-vf", "crop=iw:ih-300:0:300,scale=640:-2", png]);
				const img = await decode(png);
				let sum = 0;
				let sq = 0;
				const n = img.w * img.h;
				for (let i = 0; i < n; i++) {
					const y = 0.2126 * img.data[i * 3]! + 0.7152 * img.data[i * 3 + 1]! + 0.0722 * img.data[i * 3 + 2]!;
					sum += y;
					sq += y * y;
				}
				expect(Math.sqrt(sq / n - (sum / n) ** 2), `loop-${l.name} poster is blank`).toBeGreaterThanOrEqual(2.4);
			}
		} finally {
			if (dir.startsWith(tmpdir()) && !dir.includes("..")) rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("a loop does not end on a stalled picture", () => {
	// Incident (`bun studio loops`: video/frozen-frames on loop-mcp.webm): the scripted agent of the mcp scene finishes
	// at ~9.5 s of the capture; a 14 s loop from 3 s showed 6 s of a frozen screen. The lint's limit is 8 s, and the page's
	// loop should keep moving; the mcp loop is cut to the part of the recording where something happens.
	test("the mcp loop ends where the scripted agent stops (the capture is static from 9.5 s)", () => {
		const mcp = LOOPS.find((l) => l.name === "mcp")!;
		expect(mcp.from + mcp.seconds).toBeLessThanOrEqual(12);
	});
});
