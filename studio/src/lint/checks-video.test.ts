import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBlack, checkClipping, checkFlashing, checkFrozen, checkLoudness, checkSpec, checkVmaf, flashWindows, parseVmaf } from "./checks-video.ts";
import { run } from "../lib/exec.ts";
import { detectBlack, detectClipping, detectFreeze, keyframeTimes, maxKeyframeGap, measureLoudness, parseBlack, parseClipping, parseEbur128, parseFreeze, probeMedia } from "./media.ts";
import { lintFile } from "./index.ts";
import { PROFILES } from "./profiles.ts";

const social = PROFILES["social-vertical"]!;
const siteFilm = PROFILES["site-film"]!;

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "studio-lint-"));
});
afterAll(() => {
	// only the mkdtemp dir created above
	if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
});

const ff = (args: string[]) => run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args]);

describe("flashing (ITU-R BT.1702 / Harding)", () => {
	const fps = 30;
	const strobe = (hz: number, seconds: number, lo = 0.05, hi = 0.6) => Array.from({ length: seconds * fps }, (_, i) => (Math.floor((i / fps) * hz * 2) % 2 === 0 ? lo : hi));

	test("a 6 Hz strobe (6 flashes per second) is an error with its time range", () => {
		const d = checkFlashing(strobe(6, 2), fps);
		expect(d.length).toBeGreaterThan(0);
		expect(d[0]!.severity).toBe("error");
		expect(d[0]!.code).toBe("video/flashing");
		expect(d[0]!.range!.start).toBeLessThan(1);
	});

	test("a 2 Hz blink (<= 3 flashes per second) is allowed", () => {
		expect(checkFlashing(strobe(2, 3), fps)).toEqual([]);
	});

	test("a luminance swing under 10% is not a flash even at 8 Hz", () => {
		expect(checkFlashing(strobe(8, 2, 0.3, 0.37), fps)).toEqual([]);
	});

	test("a swing between two bright states (both above 0.8) is not a flash", () => {
		expect(checkFlashing(strobe(8, 2, 0.82, 0.98), fps)).toEqual([]);
	});

	test("a single fade through black is not a flash", () => {
		const fade = Array.from({ length: 60 }, (_, i) => (i < 30 ? 0.6 - i * 0.02 : i * 0.02 - 0.6));
		expect(flashWindows(fade, fps)).toEqual([]);
	});

	test("a real strobing video is caught end to end", async () => {
		const f = join(dir, "strobe.mp4");
		await ff(["-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2,geq=lum='if(lt(mod(floor(T*12),2),1),20,200)':cb=128:cr=128", "-pix_fmt", "yuv420p", f]);
		const r = await lintFile(f, { profile: "social-landscape" });
		expect(r.diagnostics.map((d) => d.code)).toContain("video/flashing");
	});
});

describe("black and frozen frames", () => {
	test("black in the middle of a film is an error; a fade from black at the start is not", () => {
		expect(checkBlack([{ start: 0, end: 0.8 }], 30)).toEqual([]);
		const d = checkBlack([{ start: 12, end: 13.5 }], 30);
		expect(d).toHaveLength(1);
		expect(d[0]!.message).toContain("middle");
		expect(d[0]!.range).toEqual({ start: 12, end: 13.5 });
	});

	test("black at the very end longer than the allowed fade is an error", () => {
		expect(checkBlack([{ start: 27, end: 30 }], 30)).toHaveLength(1);
		expect(checkBlack([{ start: 29, end: 30 }], 30)).toEqual([]);
	});

	test("freezedetect output parses to ranges; an open-ended freeze gets the clip duration", () => {
		const err = "[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 4.5\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 3\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 7.5\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 9\n";
		const r = parseFreeze(err);
		expect(r[0]).toEqual({ start: 4.5, end: 7.5 });
		expect(r[1]!.end).toBe(Number.POSITIVE_INFINITY);
	});

	test("short holds (title cards) are fine, long ones warn", () => {
		expect(checkFrozen([{ start: 1, end: 5 }], 8)).toEqual([]);
		const d = checkFrozen([{ start: 1, end: 12 }], 8);
		expect(d[0]!.severity).toBe("warning");
		expect(d[0]!.code).toBe("video/frozen-frames");
	});

	test("real ffmpeg: a black gap in the middle of a video is found with its range", async () => {
		const f = join(dir, "gap.mp4");
		await ff(["-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=6", "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,3.5)'", "-pix_fmt", "yuv420p", f]);
		const ranges = await detectBlack(f);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBeCloseTo(2, 0);
		expect(ranges[0]!.end).toBeCloseTo(3.5, 0);
		expect(checkBlack(ranges, 6)).toHaveLength(1);
	});

	test("real ffmpeg: a stalled picture is detected as frozen", async () => {
		const f = join(dir, "freeze.mp4");
		await ff(["-f", "lavfi", "-i", "color=c=0x2030a0:s=320x180:r=30:d=10", "-pix_fmt", "yuv420p", f]);
		const ranges = await detectFreeze(f, 4);
		expect(ranges.length).toBeGreaterThan(0);
		expect(checkFrozen(ranges, 8)).toHaveLength(1);
	});
});

describe("loudness and clipping", () => {
	test("-9 LUFS against the -14 social target is an error with the exact gain to apply", () => {
		const d = checkLoudness({ lufs: -9, truePeak: -3, lra: 4 }, social);
		expect(d).toHaveLength(1);
		expect(d[0]!.code).toBe("audio/loudness");
		expect(d[0]!.fix?.params?.gainDb).toBe(-5);
	});

	test("inside the tolerance passes, the site profile has its own target", () => {
		expect(checkLoudness({ lufs: -14.4, truePeak: -2, lra: 4 }, social)).toEqual([]);
		expect(checkLoudness({ lufs: -14.4, truePeak: -2, lra: 4 }, PROFILES.site!)).toHaveLength(1); // site is -16 +-1.5
	});

	test("a true peak above the ceiling is its own error", () => {
		const d = checkLoudness({ lufs: -14, truePeak: 0.4, lra: 4 }, social);
		expect(d.map((x) => x.code)).toEqual(["audio/true-peak"]);
	});

	test("ebur128 summary text from real ffmpeg parses", () => {
		const summary = "[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.3 LUFS\n\n  Loudness range:\n    LRA:         5.1 LU\n\n  True peak:\n    Peak:       -1.3 dBFS\n";
		expect(parseEbur128(summary)).toEqual({ lufs: -14.2, truePeak: -1.3, lra: 5.1 });
		expect(parseEbur128("nothing here")).toBeUndefined();
	});

	test("real ffmpeg: a loud sine is measured and fails the -14 target; a quiet one is fixed by the suggested gain", async () => {
		const loud = join(dir, "loud.wav");
		await ff(["-f", "lavfi", "-i", "sine=f=1000:d=4,volume=0.9,aformat=sample_fmts=s16,volume=3,alimiter=limit=0.95", loud]);
		const m = (await measureLoudness(loud))!;
		expect(m.lufs).toBeGreaterThan(-14 + 1);
		const d = checkLoudness(m, social);
		expect(d.map((x) => x.code)).toContain("audio/loudness");
		const gain = d.find((x) => x.code === "audio/loudness")!.fix!.params!.gainDb as number;
		const fixed = join(dir, "fixed.wav");
		await ff(["-i", loud, "-af", `volume=${gain}dB`, fixed]);
		expect(Math.abs((await measureLoudness(fixed))!.lufs - -14)).toBeLessThan(0.6);
	});

	test("real ffmpeg: hard clipping is detected with its time, clean audio is not", async () => {
		const clipped = join(dir, "clipped.wav");
		await ff(["-f", "lavfi", "-i", "sine=f=220:d=3", "-af", "volume=8,aformat=sample_fmts=s16", clipped]);
		const runs = await detectClipping(clipped);
		expect(runs.length).toBeGreaterThan(0);
		expect(checkClipping(runs)[0]!.code).toBe("audio/clipping");
		const clean = join(dir, "clean.wav");
		await ff(["-f", "lavfi", "-i", "sine=f=220:d=3,volume=0.3", clean]);
		expect(await detectClipping(clean)).toEqual([]);
	});

	test("clip frames merge into runs; a high Peak_count below full scale is NOT clipping", () => {
		// the exact line shapes ffmpeg's ametadata prints
		const frame = (t: number, peak: number, count: number) => [`frame:0 pts:0 pts_time:${t}`, `lavfi.astats.Overall.Peak_level=${peak}`, `lavfi.astats.Overall.Peak_count=${count}.000000`].join("\n");
		const text = [frame(1, -0.001856, 20), frame(1.1, -0.001856, 30), frame(3, -10.5, 91), frame(5, -0.001856, 1), frame(7, -0.05, 9)].join("\n");
		const r = parseClipping(text);
		expect(r).toHaveLength(2);
		expect(r[0]!.range.start).toBe(1);
		expect(r[0]!.range.end).toBeCloseTo(1.2, 5);
		expect(r[1]!.range.start).toBe(7);
	});
});

describe("delivery spec per target", () => {
	const base = { kind: "video" as const, w: 1080, h: 1920, duration: 30, fps: 30, vcodec: "h264", acodec: "aac", videoKbps: 3000, hasAudio: true };

	test("a 16:9 file against the vertical social profile is an aspect error", () => {
		const d = checkSpec({ ...base, w: 1920, h: 1080 }, social);
		expect(d.map((x) => x.code)).toContain("spec/aspect");
	});

	test("under the minimum short side warns; exact spec passes", () => {
		expect(checkSpec({ ...base, w: 720, h: 1280 }, social).map((x) => x.code)).toContain("spec/resolution");
		expect(checkSpec(base, social, 2)).toEqual([]);
	});

	test("duration over the Reels cap is an error, under the minimum too", () => {
		expect(checkSpec({ ...base, duration: 120 }, social).map((x) => x.code)).toContain("spec/duration");
		expect(checkSpec({ ...base, duration: 1.5 }, social).map((x) => x.code)).toContain("spec/duration");
	});

	test("a codec outside the profile is rejected", () => {
		expect(checkSpec({ ...base, vcodec: "vp9" }, social).map((x) => x.code)).toContain("spec/codec");
		expect(checkSpec({ ...base, vcodec: "vp9", w: 1920, h: 1080 }, siteFilm).map((x) => x.code)).not.toContain("spec/codec");
	});

	test("bitrate and keyframe interval are warnings with the measured number", () => {
		const d = checkSpec({ ...base, videoKbps: 40_000 }, social, 9);
		expect(d.find((x) => x.code === "spec/bitrate")?.measured).toBe(40_000);
		expect(d.find((x) => x.code === "spec/keyframe-interval")?.fix?.params).toBeUndefined();
		expect(d.find((x) => x.code === "spec/keyframe-interval")?.measured).toBe(9);
	});

	test("real ffmpeg: ffprobe facts and the longest keyframe gap are measured from the file", async () => {
		const f = join(dir, "gop.mp4");
		await ff(["-f", "lavfi", "-i", "testsrc=s=1080x1920:r=30:d=8", "-c:v", "libx264", "-g", "120", "-keyint_min", "120", "-sc_threshold", "0", "-pix_fmt", "yuv420p", f]);
		const info = await probeMedia(f);
		expect([info.w, info.h, info.vcodec, info.kind]).toEqual([1080, 1920, "h264", "video"]);
		const gap = maxKeyframeGap(await keyframeTimes(f), info.duration!);
		expect(gap).toBeGreaterThan(3.5);
		const r = await lintFile(f, { profile: "social-vertical", fast: true });
		expect(r.diagnostics.map((x) => x.code)).toContain("spec/keyframe-interval");
	});

	test("an image is probed as an image and gets no video rules", async () => {
		const f = join(dir, "still.png");
		await ff(["-f", "lavfi", "-i", "color=c=blue:s=1280x720", "-frames:v", "1", f]);
		expect((await probeMedia(f)).kind).toBe("image");
	});
});

describe("VMAF against a reference", () => {
	test("parses the score and flags re-encodes below 90", () => {
		expect(parseVmaf("[Parsed_libvmaf_0 @ 0x1] VMAF score: 93.121")).toBe(93.121);
		expect(parseVmaf("no score")).toBeUndefined();
		expect(checkVmaf(95)).toEqual([]);
		expect(checkVmaf(85)[0]!.severity).toBe("warning");
		expect(checkVmaf(60)[0]!.severity).toBe("error");
	});

	test("real ffmpeg: a heavy re-encode of a reference scores lower than a light one", async () => {
		const ref = join(dir, "ref.mp4");
		await ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", ref]);
		const bad = join(dir, "bad.mp4");
		await ff(["-i", ref, "-c:v", "libx264", "-crf", "45", "-pix_fmt", "yuv420p", bad]);
		const r = await lintFile(bad, { profile: "social-landscape", ref, fast: true });
		const v = r.diagnostics.find((d) => d.code === "quality/vmaf");
		expect(v, JSON.stringify(r.skipped)).toBeDefined();
		expect(v!.measured).toBeLessThan(90);
	});
});

import { isTransition } from "./checks-video.ts";

describe("sampling frames for the picture checks", () => {
	test("a sample inside a scene dip (within 0.3 s of a black range) is a transition, not a frame to judge", () => {
		const black = [{ start: 14.8, end: 15.05 }];
		expect(isTransition(15, black)).toBe(true);
		expect(isTransition(14.6, black)).toBe(true);
		expect(isTransition(16, black)).toBe(false);
		expect(isTransition(15, [])).toBe(false);
	});

	test("a silent video does not get 'audio missing' when the profile is a silent sibling or loop", () => {
		const silent = { kind: "video" as const, w: 1280, h: 800, duration: 10, fps: 30, vcodec: "vp9", hasAudio: false, videoKbps: 300 };
		expect(checkSpec(silent, PROFILES["site-sibling"]!).map((x) => x.code)).not.toContain("audio/missing");
	});
});
