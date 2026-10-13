import { describe, expect, test } from "bun:test";
import { analyzeSubject, checkEdgeClipping, checkSafeArea, overflow, safeRect } from "./checks-image.ts";
import { field, paintWindow, plate } from "./fixtures.ts";
import { checkContrast, checkTextSize, parseTesseractTsv, parseVisionLines } from "./ocr.ts";
import { contrastRatio, decode, luminance } from "./pixels.ts";
import { PROFILES } from "./profiles.ts";

const still = PROFILES.still!;
const vertical = PROFILES["social-vertical"]!;
const codes = (d: Array<{ code: string }>) => d.map((x) => x.code);

describe("edge clipping: the film-poster.jpg / README hero defect", () => {
	// The real poster: a 1920x1080 frame, the window drawn 1520 px wide from y=65 whose TOP was cropped (the film cuts
	// the recording's top 40 px, the titlebar, with `crop=2560:1600:0:40`), so the visible top edge is a flat cut.
	test("a window whose top edge was cropped (flat top, rounded bottom) is an error even with room to the frame", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12, cropTop: 40 });
		const d = checkEdgeClipping(img, still);
		expect(codes(d)).toContain("frame/window-cropped");
		const hit = d.find((x) => x.code === "frame/window-cropped")!;
		expect(hit.severity).toBe("error");
		expect(hit.message).toContain("top");
		expect(hit.rect?.y).toBeLessThan(80); // points at the cut strip
		expect(hit.fix?.action).toBe("reframe");
	});

	test("the same window with its titlebar and rounded corners intact passes", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12 });
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});

	test("a cropped BOTTOM is caught too (the check is not top-only)", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12, cropBottom: 40 });
		const d = checkEdgeClipping(img, still);
		expect(d.find((x) => x.code === "frame/window-cropped")?.message).toContain("bottom");
	});

	test("a window running into the top frame edge needs headroom", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 0, w: 1520, h: 950, radius: 12 });
		const d = checkEdgeClipping(img, still);
		const e = d.find((x) => x.code === "frame/edge-clipped")!;
		expect(e.severity).toBe("error");
		expect(e.message).toContain("top");
		expect(e.fix?.params?.add).toBeGreaterThan(0);
	});

	test("headroom is a fraction of the short side: 30 px is enough at 3% of 1080 only above 32 px", () => {
		const need = Math.ceil(still.headroom * 1080);
		const tight = field(1920, 1080);
		paintWindow(tight, { x: 200, y: need - 4, w: 1520, h: 900, radius: 12 });
		expect(codes(checkEdgeClipping(tight, still))).toContain("frame/edge-clipped");
		const ok = field(1920, 1080);
		paintWindow(ok, { x: 200, y: need + 4, w: 1520, h: 900, radius: 12 });
		expect(checkEdgeClipping(ok, still)).toEqual([]);
	});

	test("left and right touches are reported per side", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 0, y: 100, w: 1920, h: 880, radius: 12 });
		const sides = checkEdgeClipping(img, still).map((x) => x.fix?.params?.side);
		expect(sides).toContain("left");
		expect(sides).toContain("right");
	});

	test("subject detection ignores a gradient field with no subject", () => {
		expect(analyzeSubject(field(1920, 1080)).box).toBeUndefined();
		expect(checkEdgeClipping(field(1920, 1080), still)).toEqual([]);
	});

	test("the detected box is the window, within 12 px (its soft shadow edge counts as occupied)", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12 });
		const { box } = analyzeSubject(img);
		expect(Math.abs(box!.x - 200)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.y - 65)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.w - 1520)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.h - 950)).toBeLessThanOrEqual(12);
	});
});

describe("safe areas", () => {
	test("safeRect for 9:16 reserves the platform UI zones", () => {
		const r = safeRect(field(1080, 1920), vertical.safe!);
		expect(r.y).toBe(Math.round(1920 * 0.14));
		expect(r.y + r.h).toBe(1920 - Math.round(1920 * 0.25));
		expect(r.x + r.w).toBe(1080 - Math.round(1080 * 0.14));
	});

	test("text in the bottom caption zone is an error, text in the middle is not", () => {
		const img = field(1080, 1920);
		const low = { text: "Install it today", rect: { x: 100, y: 1600, w: 600, h: 60 } };
		const mid = { text: "Atlas", rect: { x: 100, y: 900, w: 600, h: 120 } };
		const d = checkSafeArea(img, vertical, [low, mid]);
		expect(d).toHaveLength(1);
		expect(d[0]!.code).toBe("safe-area/text-overlaps-ui");
		expect(d[0]!.message).toContain("bottom");
	});

	test("text under the right action rail is caught by side", () => {
		const o = overflow({ x: 900, y: 500, w: 170, h: 40 }, safeRect(field(1080, 1920), vertical.safe!));
		expect(o.right).toBeGreaterThan(0);
		expect(o.left).toBe(0);
	});

	test("a profile without safe zones (site) never reports", () => {
		expect(checkSafeArea(field(1920, 1080), PROFILES.site!, [{ text: "x", rect: { x: 0, y: 0, w: 10, h: 10 } }])).toEqual([]);
	});
});

describe("text legibility and contrast", () => {
	test("tiny text at the display size is flagged; large text is not", () => {
		const boxes = [
			{ text: "tiny caption", rect: { x: 10, y: 10, w: 200, h: 12 }, conf: 0.9 },
			{ text: "Big headline", rect: { x: 10, y: 100, w: 800, h: 120 }, conf: 0.9 },
		];
		const d = checkTextSize(boxes, 1920, vertical);
		expect(d).toHaveLength(1);
		expect(d[0]!.code).toBe("text/too-small");
		expect(d[0]!.rect?.y).toBe(10);
	});

	test("a low-confidence OCR hit is not reported (no false positives from noise)", () => {
		expect(checkTextSize([{ text: "ab1", rect: { x: 0, y: 0, w: 20, h: 6 }, conf: 0.2 }], 1920, vertical)).toEqual([]);
	});

	test("WCAG ratio: black on white is 21, same colour is 1", () => {
		expect(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21, 0);
		expect(contrastRatio(luminance(80, 80, 80), luminance(80, 80, 80))).toBeCloseTo(1, 5);
	});

	test("grey text on a slightly different grey plate fails, white on dark passes", () => {
		const img = field(400, 200);
		plate(img, 20, 20, 300, 60, [70, 70, 70], [95, 95, 95]);
		plate(img, 20, 120, 300, 60, [10, 10, 10], [240, 240, 240]);
		const low = { text: "faint text", rect: { x: 20, y: 20, w: 300, h: 60 }, conf: 0.9 };
		const ok = { text: "clear text", rect: { x: 20, y: 120, w: 300, h: 60 }, conf: 0.9 };
		const d = checkContrast(img, [low, ok], still);
		expect(d).toHaveLength(1);
		expect(d[0]!.code).toBe("text/low-contrast");
		expect(d[0]!.measured).toBeLessThan(3);
	});
});

describe("OCR parsers read the real tool output shape", () => {
	test("tesseract TSV merges words into lines with a pixel box", () => {
		const tsv = [
			"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
			"5\t1\t1\t1\t1\t1\t100\t50\t60\t20\t96.5\tOpen",
			"5\t1\t1\t1\t1\t2\t170\t52\t80\t18\t90.0\tsource.",
			"5\t1\t2\t1\t1\t1\t100\t300\t40\t20\t88\tFree",
		].join("\n");
		const boxes = parseTesseractTsv(tsv);
		expect(boxes).toHaveLength(2);
		expect(boxes[0]!.text).toBe("Open source.");
		expect(boxes[0]!.rect).toEqual({ x: 100, y: 50, w: 150, h: 20 });
	});

	test("vision helper JSON lines become boxes (top-left origin, pixels)", () => {
		const out = '{"text":"Atlas","x":120,"y":40,"w":300,"h":80,"conf":0.99}\nnoise line\n';
		expect(parseVisionLines(out)).toEqual([{ text: "Atlas", rect: { x: 120, y: 40, w: 300, h: 80 }, conf: 0.99 }]);
	});
});

describe("real poster regression (site/public/media/film-poster.jpg as published with 1.0)", () => {
	// Incident: the cover and README hero showed the app window with its top cut by the frame. `APP_CROP.y = 40` sliced
	// the controls pill of the recording at the window's top edge. The fixture is that exact poster at 960 px wide.
	test("the published poster is reported as cropped at the top, pointing at the sliced strip", async () => {
		const { decode } = await import("./pixels.ts"); // fixture path is runtime data
		const img = await decode(new URL("./__fixtures__/poster-cropped-top.jpg", import.meta.url).pathname);
		const d = checkEdgeClipping(img, still);
		const hit = d.find((x) => x.code === "frame/window-cropped");
		expect(hit, JSON.stringify(d)).toBeDefined();
		expect(hit!.message).toContain("top");
		expect(hit!.rect!.y).toBeLessThan(60);
		expect(d.some((x) => x.message.includes("bottom"))).toBe(false);
	});
});

describe("what is NOT a defect (false positives found scanning the published media)", () => {
	const load = async (name: string) => {
		const { decode } = await import("./pixels.ts"); // fixture path is runtime data
		return decode(new URL(`./__fixtures__/${name}`, import.meta.url).pathname);
	};

	test("a window-only screenshot (the window IS the frame, e.g. shot-panel.jpg) is not edge-clipped", async () => {
		expect(checkEdgeClipping(await load("window-only-shot.jpg"), still)).toEqual([]);
		expect(checkEdgeClipping(await load("window-only-poster.jpg"), still)).toEqual([]);
	});

	test("a dense terminal on a field is not 'sliced' on its sides: text runs to a terminal's left/right edges", async () => {
		// Only top/bottom can be sliced. (This 1040-in-1080 terminal DOES lack side headroom, a separate, real finding.)
		const d = checkEdgeClipping(await load("terminal-on-field.jpg"), still);
		expect(d.filter((x) => x.code === "frame/window-cropped")).toEqual([]);
	});

	test("the vertical cut's terminal box (1040 px in a 1080 frame) is reported for its thin side margins, with the exact amount to add", async () => {
		const d = checkEdgeClipping(await load("terminal-on-field.jpg"), still);
		const sides = d.filter((x) => x.code === "frame/edge-clipped").map((x) => x.fix?.params?.side);
		expect(sides).toEqual(["left", "right"]);
		expect(d[0]!.fix?.params?.add).toBeGreaterThan(0);
	});

	test("a synthetic window with intact chrome on a field has no findings on any side", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 160, y: 90, w: 1600, h: 900, radius: 12 });
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});
});

describe("frame-spanning content is the picture, not a framed object", () => {
	test("a subject touching both top and bottom (a window-only shot with a sidebar tint) is not reported", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 400, y: 0, w: 1520, h: 1080, radius: 0 });
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});

	test("but a subject touching ONLY the top is still an error (the crop defect leaves room on the other side)", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 0, w: 1520, h: 950, radius: 12 });
		expect(codes(checkEdgeClipping(img, still))).toContain("frame/edge-clipped");
	});
});

import { scopeTextToAuthored } from "./ocr.ts";

describe("text findings are about what the film authors, not the captured app UI", () => {
	const subject = { x: 100, y: 200, w: 800, h: 500 };
	const inside = { text: "orbit-shop", rect: { x: 120, y: 220, w: 90, h: 10 }, conf: 0.9 };
	const title = { text: "atlas dev", rect: { x: 300, y: 60, w: 400, h: 90 }, conf: 0.95 };

	test("lines inside the captured window are not judged for size; lines on the field are", () => {
		const { authored, captured } = scopeTextToAuthored([inside, title], subject);
		expect(authored).toEqual([title]);
		expect(captured).toEqual([inside]);
	});

	test("with no detected subject every line is authored", () => {
		expect(scopeTextToAuthored([inside, title], undefined).authored).toHaveLength(2);
	});

	test("a line straddling the subject edge counts as authored (the film put it there)", () => {
		const edge = { text: "caption over edge", rect: { x: 100, y: 180, w: 300, h: 40 }, conf: 0.9 };
		expect(scopeTextToAuthored([edge], subject).authored).toEqual([edge]);
	});
});

describe("a subject that is small relative to the frame along one axis is still found whole", () => {
	// Incident (vertical poster, 1080x1920): a 1040x650 terminal covers only 34% of the frame height, so a column-occupancy
	// threshold taken against the whole frame height cut the box to the sidebar and hid the real left/right edges.
	test("a wide, short window on a tall frame is boxed at its real width", () => {
		const img = field(1080, 1920);
		paintWindow(img, { x: 20, y: 700, w: 1040, h: 650, radius: 12 });
		const { box } = analyzeSubject(img);
		expect(box).toBeDefined();
		expect(Math.abs(box!.x - 20)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.w - 1040)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.y - 700)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.h - 650)).toBeLessThanOrEqual(12);
	});

	test("a tall, narrow window on a wide frame likewise", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 800, y: 60, w: 300, h: 960, radius: 12 });
		const { box } = analyzeSubject(img);
		expect(Math.abs(box!.w - 300)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.h - 960)).toBeLessThanOrEqual(12);
	});
});

describe("background model when the subject touches a side strip", () => {
	// Incident: a window flush with the RIGHT edge made the right border strip look like background, so the blend of
	// left/right strips swallowed the window and its box collapsed to an 86 px sliver.
	test("a window flush with the right edge is boxed at its full width", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 400, y: 100, w: 1520, h: 880, radius: 0 });
		const { box } = analyzeSubject(img);
		expect(box).toBeDefined();
		expect(Math.abs(box!.x - 400)).toBeLessThanOrEqual(12);
		expect(Math.abs(box!.w - 1520)).toBeLessThanOrEqual(12);
	});

	test("a window flush with the left edge is boxed at its full width", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 0, y: 100, w: 1500, h: 880, radius: 0 });
		const { box } = analyzeSubject(img);
		expect(box).toBeDefined();
		expect(Math.abs(box!.w - 1500)).toBeLessThanOrEqual(12);
	});
});

describe("a sliver is not a framed subject", () => {
	// Incident (scan of the published media): loop-tui-poster.jpg is a full-bleed terminal recording; the box found was
	// one 827x7 px text row, whose "sliced" top and bottom were just text.
	test("a full-bleed terminal recording (loop-tui-poster.jpg) has no framed subject to judge", async () => {
		const img = await decode(new URL("./__fixtures__/terminal-fullbleed.jpg", import.meta.url).pathname);
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});

	// Incident (lint of site/public/media, loop-tui.mp4 @ 7.63 s): the same full-bleed terminal, but a frame where only a
	// 451x133 block of log lines differs enough from the terminal background. That block is 35% x 17% of the frame, so
	// the size floor let it through, and "window-cropped" fired top AND bottom on what is just text.
	test("a block of terminal text in the middle of a full-bleed recording is not a framed window", async () => {
		const img = await decode(new URL("./__fixtures__/terminal-fullbleed-midframe.jpg", import.meta.url).pathname);
		expect(checkEdgeClipping(img, PROFILES["site-loop"]!)).toEqual([]);
	});

	// Same incident, other frames of loop-tui.mp4 (3 s and 9 s): the text block is 8-12% of the frame, past any size floor.
	// What they share is the border: corners and mid-edges are one flat terminal colour, i.e. there is no field around
	// a subject, the frame IS the content.
	test.each(["terminal-fullbleed-t3.jpg", "terminal-fullbleed-t9.jpg"])("%s: a uniform border ring means the frame is the content", async (name) => {
		const img = await decode(new URL(`./__fixtures__/${name}`, import.meta.url).pathname);
		expect(checkEdgeClipping(img, PROFILES["site-loop"]!)).toEqual([]);
	});

	test("a real framed window on a flat field is still judged: the ring guard needs the border to match the frame, not just be flat", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12, cropTop: 40 });
		expect(codes(checkEdgeClipping(img, still))).toContain("frame/window-cropped");
	});

	test("a thin bar painted on a field is not a window", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 300, y: 500, w: 1300, h: 10, radius: 0 });
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});

	test("a real window just above the size floor is still judged (the floor does not hide defects)", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 700, y: 400, w: 520, h: 300, radius: 12, cropTop: 40 });
		expect(codes(checkEdgeClipping(img, still))).toContain("frame/window-cropped");
	});
});

describe("the window box is located by its edges, not by how different its fill is from the field", () => {
	// Incident: the real poster's dark window interior (luminance ~0.005) sits on a dark-navy field (~0.013); fill
	// difference alone gave a 191 px box for a 470 px window. The boundary is a luminance STEP (bezel highlight).
	test("the real poster's window box spans the whole window (bottom edge near y=505 at 960 px wide)", async () => {
		const { decode } = await import("./pixels.ts"); // fixture path is runtime data
		const img = await decode(new URL("./__fixtures__/poster-cropped-top.jpg", import.meta.url).pathname);
		const { box } = analyzeSubject(img);
		expect(box!.y).toBeLessThan(40);
		expect(box!.y + box!.h).toBeGreaterThan(495);
		expect(box!.y + box!.h).toBeLessThan(515);
		expect(Math.abs(box!.x - 100)).toBeLessThan(12);
		expect(Math.abs(box!.w - 760)).toBeLessThan(14);
	});

	test("a cropped bottom is found even though the soft shadow below it is also 'different'", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12, cropBottom: 40 });
		const { box } = analyzeSubject(img);
		expect(Math.abs(box!.y + box!.h - (65 + 950))).toBeLessThanOrEqual(3);
	});

	test("synthetic boxes are within 3 px on every side", () => {
		const img = field(1920, 1080);
		paintWindow(img, { x: 200, y: 65, w: 1520, h: 950, radius: 12 });
		const { box } = analyzeSubject(img);
		expect([box!.x, box!.y, box!.w, box!.h].map((v, i) => Math.abs(v - [200, 65, 1520, 950][i]!)).every((d) => d <= 3)).toBe(true);
	});
});

describe("false positives found re-linting site/public/media", () => {
	test("safe-area is judged on authored text only: captured UI text near a platform margin is the app's own", () => {
		const subject = { x: 20, y: 700, w: 1040, h: 650 };
		const captured = { text: "22:59:41", rect: { x: 47, y: 795, w: 61, h: 11 }, conf: 0.9 };
		const title = { text: "atlas dev", rect: { x: 200, y: 400, w: 400, h: 90 }, conf: 0.95 };
		const { authored } = scopeTextToAuthored([captured, title], subject);
		expect(checkSafeArea(field(1080, 1920), vertical, authored)).toEqual([]);
		const low = { text: "Install it today", rect: { x: 100, y: 1600, w: 600, h: 60 }, conf: 0.9 };
		expect(checkSafeArea(field(1080, 1920), vertical, scopeTextToAuthored([captured, low], subject).authored)).toHaveLength(1);
	});

	test("a subject under 15% of the frame in either axis (a row of text, 451x8) is not a window", () => {
		const img = field(1280, 800);
		paintWindow(img, { x: 119, y: 319, w: 451, h: 8, radius: 0 });
		expect(checkEdgeClipping(img, still)).toEqual([]);
	});
});
