import { describe, expect, test } from "bun:test";
import { ASPECTS, type TerminalScene } from "../lib/types.ts";
import { buildTerminal } from "./terminal.ts";

const ctx = { aspect: ASPECTS["9:16"], fps: 30, asset: (p: string) => p, esc: (s: string) => s };
const base: TerminalScene = { id: "v2", type: "terminal", take: "take:tui", segments: [[0, 1]], width: 972, duration: 5 };
const proxy = { file: "assets/p.mp4", aspect: 1600 / 1000 };

describe("a terminal scene placed in a reframe viewport", () => {
	const viewport = { x: 0, y: 450, w: 1080, h: 790 };

	test("the take is fitted INSIDE the viewport (contain), centered, never cropped: its window edges stay in frame", () => {
		const o = buildTerminal({ ...base, viewport }, ctx, proxy);
		// 1080 wide at 1.6 is 675 tall < 790: width-limited; H.264 needs even sizes, so 674; centered: y = 450 + (790-674)/2 = 508
		expect(o.html).toContain("left:0px;top:508px;width:1080px;height:674px");
	});

	test("a take taller than the viewport is height-limited", () => {
		const o = buildTerminal({ ...base, viewport }, ctx, { file: proxy.file, aspect: 1.2 });
		expect(o.html).toMatch(/width:948px;height:790px/);
	});

	test("without a viewport the placement is the scene's own (existing films unchanged)", () => {
		const o = buildTerminal({ ...base, y: 700 }, ctx, proxy);
		expect(o.html).toContain("top:700px");
	});
});
