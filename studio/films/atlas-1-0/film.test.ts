import { describe, expect, test } from "bun:test";
import { placeBox } from "../../src/scenes/app.ts";
import { ASPECTS } from "../../src/lib/types.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetPath } from "../../src/lib/assets.ts";
import { run } from "../../src/lib/exec.ts";
import { decode } from "../../src/lint/pixels.ts";
import { PROFILES } from "../../src/lint/profiles.ts";
import { windowTopRow } from "../../src/capture/window-rect.ts";
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

describe("each app scene crops exactly the window of ITS recording (not a constant that fits an older one)", () => {
	// Incident: film.mp4 failed frame/window-cropped at 38.97 s and 58.45 s. The 1.0 recordings carry 16 px of the
	// display's wallpaper above the window (the new ones 4 px); the film cropped from row 0 on all of them, so a
	// bright strip sat above the window's bezel. The crop is measured on the footage the scene actually plays.
	const scenes = film.cuts.flatMap((c) => c.scenes).filter((s) => s.type === "app");
	test.each(scenes.map((s) => [s.id, s] as const))("%s", async (_id, scene) => {
		if (scene.type !== "app") return;
		const path = assetPath(scene.clip);
		const tmp = join(tmpdir(), `film-test-${process.pid}-${scene.id}.png`);
		await run(["ffmpeg", "-y", "-v", "error", "-ss", String(scene.from + 1), "-i", path, "-frames:v", "1", "-vf", "crop=iw:60:0:0", tmp]);
		const top = windowTopRow(await decode(tmp));
		const dims = (await run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path])).out.trim().split(",").map(Number);
		expect(scene.crop.y, `${scene.clip}: the window starts at row ${top}`).toBe(top);
		expect(scene.crop.x).toBe(0);
		expect(scene.crop.w).toBe(dims[0]!);
		expect(scene.crop.y + scene.crop.h, `${scene.clip}: the crop ends at the frame's bottom edge`).toBe(dims[1]!);
	});
});

describe("the vertical cut's authored text meets the social profile's legibility floor", () => {
	// Incident (lint of film-vertical.mp4): "your stack in the terminal" and "in their own worktrees" measured 19.8 px
	// at the 844 px display height (min 28). The OCR glyph band (ascender to descender) is ~0.8 x the font size. The
	// frame is 1920 px tall: shown at 844 px the font must be >= 28 / 0.8 = 35 px there, i.e. >= 80 px in the frame.
	const profile = PROFILES["social-vertical"]!;
	const vertical = film.cuts.find((c) => c.aspect === "9:16")!;
	const minFont = Math.ceil((profile.minTextPx / 0.8) * (ASPECTS["9:16"].h / profile.displayHeight));
	test.each(vertical.scenes.flatMap((s) => (("overlay" in s && s.overlay?.subtitle) ? [[s.id, s.overlay.subtitleSize ?? 48] as const] : [])))("%s subtitle is >= %ipx in the 1920 px frame", (_id, size) => {
		expect(size).toBeGreaterThanOrEqual(minFont);
	});
});

describe("the vertical cut's overlay text stays inside the platform safe area at the legible size", () => {
	// Incident: raising the subtitles to the 80 px legibility floor made "your stack in the terminal" 880 px wide, 51 px
	// into the right-hand action rail (Reels/TikTok/Shorts reserve 14% of the width there). The lint measured that line:
	// 880 px for 26 glyphs at 80 px = 0.423 em per glyph (Archivo, proportional), so width ~ glyphs x size x 0.43.
	// The text is centred, so it must fit twice the wider margin of the safe area (left 6%, right 14%).
	const profile = PROFILES["social-vertical"]!;
	const vertical = film.cuts.find((c) => c.aspect === "9:16")!;
	const w = ASPECTS["9:16"].w;
	const room = w - 2 * Math.max(profile.safe!.left, profile.safe!.right) * w;
	const overlays = vertical.scenes.flatMap((s) => ("overlay" in s && s.overlay ? [[s.id, s.overlay] as const] : []));
	test.each(overlays.filter(([, o]) => o.subtitle))("%s subtitle fits the safe width", (_id, o) => {
		expect(o.subtitle!.length * (o.subtitleSize ?? 48) * 0.43).toBeLessThanOrEqual(room);
	});
});
