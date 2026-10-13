import { describe, expect, test } from "bun:test";
import { filmVideoArgs } from "./render.ts";

describe("the film's delivery encode", () => {
	// Incident (`bun studio lint`, film-vertical.mp4): the longest keyframe gap was 8.3 s against the 3 s the social
	// profile allows: x264's default GOP is 250 frames, and a scene without cuts inside runs long. Seeking and platform
	// transcodes both want a keyframe at least every 3 s; 2 s leaves margin.
	test("a keyframe at least every 2 s at the film's frame rate, on every cut", () => {
		for (const fps of [24, 30, 60]) {
			const a = filmVideoArgs({ crf: 26, fps }, false).join(" ");
			expect(a).toMatch(new RegExp(`-g ${fps * 2}\\b`));
			expect(a).toMatch(new RegExp(`-keyint_min ${fps * 2}\\b`));
			expect(a).toContain("-sc_threshold 0"); // scene-change keyframes would add irregular ones; the GOP is the rule
		}
	});

	test("the film's crf and a yuv420p picture are kept; a draft copies the intermediate untouched", () => {
		const a = filmVideoArgs({ crf: 26, fps: 30 }, false).join(" ");
		expect(a).toContain("-crf 26");
		expect(a).toContain("yuv420p");
		expect(filmVideoArgs({ crf: 26, fps: 30 }, true)).toEqual(["-c:v", "copy"]);
	});
});
