import { describe, expect, test } from "bun:test";
import { windowTopRow } from "./window-rect.ts";
import { decode } from "../lint/pixels.ts";

// Incident (lint of the new recordings: film.mp4 `frame/window-cropped` at 38.97 s and 58.45 s): every recording of
// the app is 4 px taller than its window. The top 4 rows are the wallpaper of the private virtual display (a bright
// orange sliver), the window starts at row 4. Used whole, the sliver sits above the window's dark bezel and the lint
// (and the eye) read it as structure crossing the window's top edge. The fixture is that strip of a real capture.
const fixture = new URL("../lint/__fixtures__/capture-top-band.png", import.meta.url).pathname;

describe("windowTopRow (where the app window starts inside a capture frame)", () => {
	test("on a real capture the window starts at row 4: rows 0-3 are the display's wallpaper", async () => {
		expect(windowTopRow(await decode(fixture))).toBe(4);
	});

	test("a frame whose first row is already the window (an exact capture) starts at row 0", () => {
		const w = 64;
		const h = 20;
		const data = new Uint8Array(w * h * 3);
		// the window's own ramp: bezel highlight into the toolbar, a few levels per row (what the real strip shows)
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill(0x40 - y * 2, (y * w + x) * 3, (y * w + x) * 3 + 3);
		expect(windowTopRow({ w, h, data })).toBe(0);
	});
	test("a sliver of any height is found, not a constant 4", () => {
		const w = 64;
		const h = 20;
		const data = new Uint8Array(w * h * 3).fill(0x30);
		for (let y = 0; y < 7; y++) for (let x = 0; x < w; x++) data.set([0xff, 0xcc, 0x99], (y * w + x) * 3);
		expect(windowTopRow({ w, h, data })).toBe(7);
	});

	test("an all-wallpaper frame has no window: it says so instead of returning a row", () => {
		const w = 64;
		const h = 20;
		const data = new Uint8Array(w * h * 3).fill(0xcc);
		expect(() => windowTopRow({ w, h, data })).toThrow(/no window/);
	});
});
