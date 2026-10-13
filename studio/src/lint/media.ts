// ffprobe/ffmpeg measurements the lint checks need. Parsers are exported pure functions so tests can feed them the
// real text ffmpeg prints (captured from a real run), not a hand-written imitation.

import { run } from "../lib/exec.ts";
import { StudioError } from "../lib/paths.ts";
import type { TimeRange } from "./types.ts";

export interface MediaInfo {
	kind: "image" | "video";
	w: number;
	h: number;
	duration?: number;
	fps?: number;
	vcodec?: string;
	acodec?: string;
	/** video stream bitrate, kb/s (falls back to the container bitrate) */
	videoKbps?: number;
	hasAudio: boolean;
	pixFmt?: string;
}

const IMAGE_CODECS: Record<string, true> = { mjpeg: true, png: true, webp: true, bmp: true, tiff: true };

export async function probeMedia(file: string): Promise<MediaInfo> {
	const { out } = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,pix_fmt,nb_frames", "-of", "json", file]);
	const j = JSON.parse(out) as {
		format: { duration?: string; bit_rate?: string };
		streams: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; bit_rate?: string; pix_fmt?: string; nb_frames?: string }>;
	};
	const v = j.streams.find((s) => s.codec_type === "video");
	if (!v?.width || !v.height) throw new StudioError(`${file} has no video stream`, "lint takes images and videos");
	const a = j.streams.find((s) => s.codec_type === "audio");
	const [n, d] = (v.r_frame_rate ?? "0/1").split("/").map(Number) as [number, number];
	const duration = Number(j.format.duration ?? 0);
	const isImage = (v.codec_name ?? "") in IMAGE_CODECS && !a && !/\.(mp4|webm|mov|mkv)$/i.test(file);
	const bps = Number(v.bit_rate ?? j.format.bit_rate ?? 0);
	return {
		kind: isImage ? "image" : "video",
		w: v.width,
		h: v.height,
		duration: isImage ? undefined : duration,
		fps: d ? n / d : undefined,
		vcodec: v.codec_name,
		acodec: a?.codec_name,
		videoKbps: bps ? bps / 1000 : undefined,
		hasAudio: Boolean(a),
		pixFmt: v.pix_fmt,
	};
}

export async function probeSize(file: string): Promise<{ w: number; h: number }> {
	const m = await probeMedia(file);
	return { w: m.w, h: m.h };
}

/** Timestamps (s) of keyframes of the first video stream. */
export async function keyframeTimes(file: string): Promise<number[]> {
	const { out } = await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file]);
	return out
		.split("\n")
		.map((l) => Number.parseFloat(l))
		.filter((t) => Number.isFinite(t));
}

/** Longest gap between consecutive keyframes (and from the last one to the end), seconds. */
export function maxKeyframeGap(times: number[], duration: number): number {
	let gap = 0;
	for (let i = 0; i < times.length; i++) gap = Math.max(gap, (times[i + 1] ?? duration) - times[i]!);
	return gap;
}

// ── black / freeze ────────────────────────────────────────────────────────────────────────────────────────────────

/** `blackdetect` prints `black_start:1.2 black_end:3.4 black_duration:2.2` on stderr. */
export function parseBlack(stderr: string): TimeRange[] {
	return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
}

/** `freezedetect` prints lavfi.freezedetect.freeze_start / freeze_end / freeze_duration lines. */
export function parseFreeze(stderr: string): TimeRange[] {
	const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
	const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
	return starts.map((start, i) => ({ start, end: ends[i] ?? Number.POSITIVE_INFINITY }));
}

export async function detectBlack(file: string): Promise<TimeRange[]> {
	const { err } = await run(["ffmpeg", "-nostats", "-hide_banner", "-i", file, "-vf", "blackdetect=d=0.2:pic_th=0.98:pix_th=0.10", "-an", "-f", "null", "-"], { allowFail: true });
	return parseBlack(err);
}

export async function detectFreeze(file: string, minSeconds: number): Promise<TimeRange[]> {
	const { err } = await run(["ffmpeg", "-nostats", "-hide_banner", "-i", file, "-vf", `freezedetect=n=-60dB:d=${minSeconds}`, "-an", "-f", "null", "-"], { allowFail: true });
	const ranges = parseFreeze(err);
	const dur = (await probeMedia(file)).duration ?? 0;
	return ranges.map((r) => ({ start: r.start, end: Math.min(r.end, dur) }));
}

// ── audio ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Loud {
	lufs: number;
	/** true peak, dBTP */
	truePeak: number;
	lra: number;
}

/** Summary block of `ebur128=peak=true`: `I: -14.2 LUFS`, `LRA: 5.1 LU`, `Peak: -1.0 dBFS`. */
export function parseEbur128(stderr: string): Loud | undefined {
	const sum = stderr.slice(stderr.lastIndexOf("Summary:"));
	const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1];
	const lra = /LRA:\s+(-?[\d.]+) LU/.exec(sum)?.[1];
	const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1];
	if (lufs === undefined) return undefined;
	return { lufs: Number(lufs), truePeak: Number(peak ?? "0"), lra: Number(lra ?? "0") };
}

export async function measureLoudness(file: string): Promise<Loud | undefined> {
	const { err } = await run(["ffmpeg", "-nostats", "-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { allowFail: true });
	return parseEbur128(err);
}

/** Seconds of audio where consecutive samples sit at full scale (hard clipping), from `astats` per-frame peak counts. */
export interface ClipRun {
	range: TimeRange;
	samples: number;
}

/**
 * `ametadata=mode=print` prints, per 100 ms frame: `frame:0 pts:0 pts_time:0.1`, then
 * `lavfi.astats.Overall.Peak_level=-0.001856` (dBFS) and `lavfi.astats.Overall.Peak_count=52`. Clipping is a peak at
 * digital full scale (>= -0.1 dBFS) reached by several samples in one frame: a clean loud sine peaks once per cycle,
 * but at a level below full scale, and Peak_count alone is high for any clean tone.
 */
export function parseClipping(text: string, ceilingDb = -0.1, minCount = 3): ClipRun[] {
	const runs: ClipRun[] = [];
	let t = 0;
	let peak = Number.NEGATIVE_INFINITY;
	for (const line of text.split("\n")) {
		const pt = /pts_time:([\d.]+)/.exec(line)?.[1];
		if (pt) {
			t = Number(pt);
			peak = Number.NEGATIVE_INFINITY;
		}
		const pl = /lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+|-inf)/.exec(line)?.[1];
		if (pl) peak = pl === "-inf" ? Number.NEGATIVE_INFINITY : Number(pl);
		const pc = /lavfi\.astats\.Overall\.Peak_count=([\d.]+)/.exec(line)?.[1];
		if (pc && peak >= ceilingDb && Number(pc) >= minCount) runs.push({ range: { start: t, end: t + 0.1 }, samples: Number(pc) });
	}
	const merged: ClipRun[] = [];
	for (const r of runs) {
		const last = merged[merged.length - 1];
		if (last && r.range.start - last.range.end < 0.05) {
			last.range.end = r.range.end;
			last.samples += r.samples;
		} else merged.push({ range: { ...r.range }, samples: r.samples });
	}
	return merged;
}

export async function detectClipping(file: string): Promise<ClipRun[]> {
	const { out } = await run(
		["ffmpeg", "-nostats", "-hide_banner", "-i", file, "-vn", "-af", "asetnsamples=n=4800,astats=metadata=1:reset=1,ametadata=mode=print:file=/dev/stdout", "-f", "null", "-"],
		{ allowFail: true }
	);
	return parseClipping(out);
}
