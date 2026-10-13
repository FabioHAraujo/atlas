import { describe, expect, test } from "bun:test";
import { StudioError } from "./lib/paths.ts";
import type { Cut } from "./lib/types.ts";
import { stillTime } from "./still.ts";

const cut = { aspect: "16:9", out: "film", scenes: [], captions: { vtt: false, burned: false }, poster: 41 } as Cut;

describe("which instant a still is taken from", () => {
	test("--at wins over the cut's poster time, the poster over the middle", () => {
		expect(stillTime(cut, 77.9, 12)).toBe(12);
		expect(stillTime(cut, 77.9)).toBe(41);
		expect(stillTime({ ...cut, poster: undefined }, 60)).toBe(30);
	});

	test("the last frame is clamped back so the snapshot exists", () => {
		expect(stillTime(cut, 77.9, 77.9)).toBeCloseTo(77.8, 5);
	});

	test("a time outside the film is a hinted error, not a silent clamp", () => {
		expect(() => stillTime(cut, 77.9, 90)).toThrow(StudioError);
		expect(() => stillTime(cut, 77.9, -1)).toThrow(StudioError);
	});
});

import { sceneAt } from "./still.ts";
import type { Scene } from "./lib/types.ts";

describe("which scene a still time falls in (so only that scene is rendered)", () => {
	const mk = (id: string, duration: number, transitionIn?: Scene["transitionIn"]) => ({ id, type: "title", duration, transitionIn, text: { title: "x" } }) as Scene;
	const scenes = [mk("a", 4.5), mk("b", 4.5), mk("c", 1.7), mk("d", 8)];

	test("the poster at 41 s of the real film lands in the 'panel' scene with the right offset", () => {
		const real = [4.5, 4.5, 1.7, 8, 1.7, 6, 1.7, 7, 1.7, 6.0333].map((d, i) => mk(`s${i}`, d));
		const hit = sceneAt(real, 41);
		expect(hit.scene.id).toBe("s9");
		expect(hit.offset).toBeCloseTo(41 - 36.8, 4);
	});

	test("a time exactly on a boundary belongs to the scene that starts there", () => {
		expect(sceneAt(scenes, 4.5).scene.id).toBe("b");
		expect(sceneAt(scenes, 0).scene.id).toBe("a");
	});

	test("a crossfade overlaps the previous scene: it starts `duration` earlier", () => {
		const s = [mk("a", 4), mk("b", 4, { type: "crossfade", duration: 1 })];
		expect(sceneAt(s, 3.5).scene.id).toBe("b");
		expect(sceneAt(s, 3.5).offset).toBeCloseTo(0.5, 5);
	});

	test("a time past the end is an error", () => {
		expect(() => sceneAt(scenes, 99)).toThrow(StudioError);
	});
});
