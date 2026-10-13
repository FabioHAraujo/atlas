// Delivery profiles: the numbers every check compares against. Safe areas are the conservative union of the public
// UI overlay guidance of each platform (top bar / search, bottom caption + CTA strip, right action rail):
//   Instagram Reels  1080x1920: ~14% top, ~20% bottom (caption + audio), ~12% right (like/comment/share rail)
//   TikTok           1080x1920: ~13% top (Following/For You), ~25% bottom (caption + music), ~14% right
//   YouTube Shorts   1080x1920: ~10% top, ~22% bottom (title + subscribe), ~12% right
// Loudness: social platforms normalise to about -14 LUFS integrated, true peak <= -1 dBTP; the site player is -16.

import { StudioError } from "../lib/paths.ts";
import type { Profile } from "./types.ts";

const SOCIAL_VERTICAL_SAFE = { top: 0.14, bottom: 0.25, left: 0.06, right: 0.14 };

export const PROFILES: Record<string, Profile> = {
	site: {
		id: "site",
		description: "the website: film player, posters, README hero",
		aspect: { ratio: 16 / 9, tolerance: 0.02 },
		minShortSide: 1080,
		loudness: { target: -16, tolerance: 1.5, truePeak: -1 },
		minTextPx: 14,
		displayHeight: 720,
		codecs: ["h264", "vp9", "av1"],
		maxVideoKbps: 12_000,
		maxKeyframeSec: 10,
		headroom: 0.03,
	},
	// What the site/README actually serve today: the film is -14 LUFS (documented in site/public/media/README.md).
	"site-film": {
		id: "site-film",
		description: "the site film as published: -14 LUFS, 16:9, 1080p",
		aspect: { ratio: 16 / 9, tolerance: 0.02 },
		minShortSide: 1080,
		loudness: { target: -14, tolerance: 0.7, truePeak: -1 },
		minTextPx: 14,
		displayHeight: 720,
		codecs: ["h264", "vp9"],
		maxVideoKbps: 12_000,
		maxKeyframeSec: 10,
		headroom: 0.03,
	},
	// silent 16:10 loops embedded in the site's pages
	"site-loop": {
		id: "site-loop",
		description: "silent 16:10 feature loops on the site",
		captured: true,
		aspect: { ratio: 1.6, tolerance: 0.02 },
		minShortSide: 720,
		minTextPx: 11,
		displayHeight: 506,
		codecs: ["h264", "vp9"],
		maxVideoKbps: 4000,
		headroom: 0.03,
	},
	// the webm next to a published mp4: same picture for browsers that prefer VP9; the upload rules belong to the mp4
	"site-sibling": {
		id: "site-sibling",
		description: "VP9/WebM sibling of a published mp4 (site player)",
		captured: true,
		minShortSide: 720,
		loudness: { target: -14, tolerance: 1, truePeak: -0.5 },
		minTextPx: 14,
		displayHeight: 720,
		codecs: ["vp9", "av1"],
		maxVideoKbps: 12_000,
		headroom: 0.03,
	},
	"social-vertical": {
		id: "social-vertical",
		description: "Instagram Reels / TikTok / YouTube Shorts: 9:16, 1080x1920",
		aspect: { ratio: 9 / 16, tolerance: 0.01 },
		minShortSide: 1080,
		maxDuration: 90,
		minDuration: 3,
		loudness: { target: -14, tolerance: 1, truePeak: -1 },
		safe: SOCIAL_VERTICAL_SAFE,
		minTextPx: 28,
		displayHeight: 844,
		codecs: ["h264", "hevc"],
		maxVideoKbps: 12_000,
		maxKeyframeSec: 3,
		headroom: 0.03,
	},
	"social-square": {
		id: "social-square",
		description: "Instagram / LinkedIn feed: 1:1, 1080x1080",
		aspect: { ratio: 1, tolerance: 0.01 },
		minShortSide: 1080,
		maxDuration: 60,
		minDuration: 3,
		loudness: { target: -14, tolerance: 1, truePeak: -1 },
		safe: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
		minTextPx: 24,
		displayHeight: 540,
		codecs: ["h264", "hevc"],
		maxVideoKbps: 12_000,
		maxKeyframeSec: 3,
		headroom: 0.03,
	},
	"social-landscape": {
		id: "social-landscape",
		description: "YouTube / X / LinkedIn landscape: 16:9, 1920x1080",
		aspect: { ratio: 16 / 9, tolerance: 0.02 },
		minShortSide: 1080,
		maxDuration: 600,
		loudness: { target: -14, tolerance: 1, truePeak: -1 },
		minTextPx: 14,
		displayHeight: 720,
		codecs: ["h264", "hevc", "vp9"],
		maxVideoKbps: 20_000,
		maxKeyframeSec: 5,
		headroom: 0.03,
	},
	// README / docs stills: no audio, no platform UI. Shown at ~ 900 px wide on GitHub.
	still: {
		id: "still",
		description: "README / docs / site stills (images)",
		minShortSide: 720,
		minTextPx: 11,
		displayHeight: 506,
		headroom: 0.03,
	},
	// A screenshot of Atlas Desktop (shot-*.jpg) or the poster of an app loop: the picture IS the product, so its UI
	// text is the app's own typography at the app's size, exactly like the loop videos (`site-loop`). Framing is still judged.
	"site-shot": {
		id: "site-shot",
		description: "screenshots and loop posters of the real app (site)",
		captured: true,
		minShortSide: 720,
		minTextPx: 11,
		displayHeight: 506,
		headroom: 0.03,
	},
};

export const profileFor = (id: string): Profile => {
	const p = PROFILES[id];
	if (!p) throw new StudioError(`unknown profile "${id}"`, `profiles: ${Object.keys(PROFILES).join(", ")}`);
	return p;
};

/** The profile a cut should be linted against, by its aspect ratio. */
export function profileForAspect(aspect: "16:9" | "9:16" | "1:1"): string {
	return aspect === "9:16" ? "social-vertical" : aspect === "1:1" ? "social-square" : "site-film";
}
