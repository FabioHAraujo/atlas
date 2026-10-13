import { describe, expect, test } from "bun:test";
import { StudioError } from "../lib/paths.ts";
import { assertLevels, TRUE_PEAK_CEILING } from "./mix.ts";

const target = { target: -14, tolerance: 0.7 };

describe("the mixer asserts the peak ceiling as well as the loudness", () => {
	// Incident: the published film.mp4/film.webm measured -0.8 / -0.6 dBFS, above the -1 dBTP ceiling that platform
	// transcodes need; the mixer only checked integrated loudness, so the render passed.
	test("a mix that lands at -0.8 dBFS peak fails, with the ceiling in the hint", () => {
		let err: unknown;
		try {
			assertLevels("film", { lufs: -14.1, peak: -0.8 }, target);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(StudioError);
		expect((err as StudioError).message).toContain("-0.8");
		expect((err as StudioError).message).toContain(String(TRUE_PEAK_CEILING));
	});

	test("exactly at the ceiling passes; just above fails", () => {
		expect(() => assertLevels("film", { lufs: -14, peak: TRUE_PEAK_CEILING }, target)).not.toThrow();
		expect(() => assertLevels("film", { lufs: -14, peak: TRUE_PEAK_CEILING + 0.1 }, target)).toThrow(StudioError);
	});

	test("loudness outside the tolerance still fails, on its own", () => {
		expect(() => assertLevels("film", { lufs: -12.9, peak: -3 }, target)).toThrow(/integrated loudness/);
		expect(() => assertLevels("film", { lufs: -14.7, peak: -3 }, target)).not.toThrow();
	});

	test("silence (no voice, no music) is exempt: -70 LUFS is the 'no audio' marker", () => {
		expect(() => assertLevels("film", { lufs: -70, peak: -70 }, target)).not.toThrow();
	});
});
