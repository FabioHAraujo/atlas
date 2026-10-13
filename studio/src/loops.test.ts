import { describe, expect, test } from "bun:test";
import { loopMp4Args, loopWebmArgs, posterArgs, shotArgs } from "./loops.ts";

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
