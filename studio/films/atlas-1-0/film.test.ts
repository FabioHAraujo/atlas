import { describe, expect, test } from "bun:test";
import { placeBox } from "../../src/scenes/app.ts";
import { ASPECTS } from "../../src/lib/types.ts";
import { PROFILES } from "../../src/lint/profiles.ts";
import film from "./film.ts";

// Incident (lint of site/public/media): film-vertical.mp4/.webm failed frame/edge-clipped at 7.5 s and 22.5 s: the
// subject was 20 px from the left and right edges, the lint wants >= 3% of the short side (33 px at 1080). The box was
// 1000 of 1080 px (40 px by arithmetic), but the detector measures the window including its soft shadow/bezel, which
// eats ~20 px per side. The margin that counts is the DETECTED one, so the box keeps a margin on top of the 3% rule.
const DETECTED_BLEED = 20;

describe("every app clip leaves the headroom the lint demands, measured the way the lint measures", () => {
	for (const cut of film.cuts) {
		const aspect = ASPECTS[cut.aspect];
		const profile = PROFILES[cut.aspect === "9:16" ? "social-vertical" : "site-film"]!;
		const need = Math.ceil(profile.headroom * Math.min(aspect.w, aspect.h));
		for (const scene of cut.scenes) {
			if (scene.type !== "app") continue;
			test(`${cut.out}/${scene.id}: >= ${need}px between the window and every edge (+${DETECTED_BLEED}px of detected shadow)`, () => {
				const b = placeBox(scene.box, aspect, scene.crop.w / scene.crop.h);
				const room = { left: b.x, right: aspect.w - (b.x + b.w), top: b.y, bottom: aspect.h - (b.y + b.h) };
				for (const [side, px] of Object.entries(room)) expect(px - DETECTED_BLEED, `${side} of ${scene.id}`).toBeGreaterThanOrEqual(need);
			});
		}
	}
});

describe("recordings are used whole: cropping a window slices its titlebar (film-poster.jpg / README hero defect)", () => {
	test("no app scene crops the recording (the full frame, from 0,0)", () => {
		for (const cut of film.cuts) for (const s of cut.scenes) if (s.type === "app") expect(s.crop).toEqual({ x: 0, y: 0, w: 2560, h: 1640 });
	});
});
