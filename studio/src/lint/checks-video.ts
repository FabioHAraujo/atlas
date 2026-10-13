// Video / audio / delivery checks. The decision logic is pure (feed it numbers); `lintVideo` in index.ts measures.

import type { Loud, MediaInfo, ClipRun } from "./media.ts";
import type { Diagnostic, Profile, TimeRange } from "./types.ts";

// ── flashing: ITU-R BT.1702 / Ofcom "Harding" (photosensitive epilepsy) ───────────────────────────────────────────

/**
 * A *flash* is a pair of opposing changes in relative luminance of at least `delta` (0.1 of the 0..1 range, the BT.1702
 * threshold of 20 cd/m2 on a 200 cd/m2 display) where the darker state is below 0.8 (160 cd/m2). More than 3 flashes in
 * any one-second window fails. `lum` is the mean relative luminance per frame (0..1) at `fps`.
 */
export function flashWindows(lum: number[], fps: number, delta = 0.1): TimeRange[] {
	// opposing changes of at least `delta` in relative luminance (darker state < 0.8); same-direction steps merge
	const events: Array<{ i: number; dir: 1 | -1 }> = [];
	let ref = lum[0] ?? 0;
	let dir: 0 | 1 | -1 = 0;
	for (let i = 1; i < lum.length; i++) {
		const d = lum[i]! - ref;
		if (Math.abs(d) >= delta && Math.min(lum[i]!, ref) < 0.8) {
			const nd = d > 0 ? 1 : -1;
			if (nd !== dir) events.push({ i, dir: nd });
			dir = nd;
			ref = lum[i]!;
		} else if ((dir === 1 && lum[i]! > ref) || (dir === -1 && lum[i]! < ref)) ref = lum[i]!;
	}
	// a flash is a PAIR of opposing transitions (BT.1702): the frame where the pair completes marks it
	const flashFrames: number[] = [];
	for (let k = 1; k < events.length; k += 2) flashFrames.push(events[k]!.i);
	const bad: TimeRange[] = [];
	for (let a = 0; a < flashFrames.length; a++) {
		const inWindow = flashFrames.filter((f) => f >= flashFrames[a]! && f < flashFrames[a]! + fps);
		if (inWindow.length > 3) {
			const r = { start: flashFrames[a]! / fps, end: (inWindow[inWindow.length - 1]! + 1) / fps };
			const last = bad[bad.length - 1];
			if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
			else bad.push(r);
		}
	}
	return bad;
}

export function checkFlashing(lum: number[], fps: number): Diagnostic[] {
	return flashWindows(lum, fps).map((range) => ({
		severity: "error" as const,
		code: "video/flashing",
		message: `more than 3 general flashes within one second between ${range.start.toFixed(2)}s and ${range.end.toFixed(2)}s (ITU-R BT.1702 / Harding): a photosensitive-epilepsy risk`,
		range,
		fix: { action: "reduce-flashing" as const, description: "slow the strobing below 3 flashes per second or lower the luminance swing under 10%" },
	}));
}

// ── black / frozen ────────────────────────────────────────────────────────────────────────────────────────────────

/** Black at the very start or end is a fade; anywhere else, or longer than `allowEdge`, it is an editing defect. */
export function checkBlack(ranges: TimeRange[], duration: number, allowEdge = 1.5, allowDip = 0.3): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const r of ranges) {
		const len = r.end - r.start;
		if (len <= allowDip) continue; // the film's own dip between scenes (0.25 s fade out + in), not an editing defect
		const atEdge = r.start < 0.05 || r.end > duration - 0.05;
		if (atEdge && len <= allowEdge) continue;
		out.push({
			severity: "error",
			code: "video/black-frames",
			message: `${len.toFixed(2)}s of black at ${r.start.toFixed(2)}s-${r.end.toFixed(2)}s${atEdge ? ` (longer than the ${allowEdge}s allowed at the edges)` : " in the middle of the film"}`,
			range: r,
			fix: { action: "remove-black", description: "cut the black segment or fill it with the next scene" },
		});
	}
	return out;
}

/** True when `t` falls within a scene dip (a black range, +-0.3 s): the picture is mid-fade and unfit for picture checks. */
export function isTransition(t: number, black: TimeRange[], margin = 0.3): boolean {
	return black.some((r) => t >= r.start - margin && t <= r.end + margin);
}

/** A frozen picture longer than `maxFreeze` s means a stalled recording. Static title cards are expected to hold: `holdOk` s. */
export function checkFrozen(ranges: TimeRange[], maxFreeze: number): Diagnostic[] {
	return ranges
		.filter((r) => r.end - r.start > maxFreeze)
		.map((range) => ({
			severity: "warning" as const,
			code: "video/frozen-frames",
			message: `the picture does not change for ${(range.end - range.start).toFixed(1)}s (${range.start.toFixed(1)}s-${range.end.toFixed(1)}s), longer than ${maxFreeze}s: a stalled recording or a missing animation`,
			range,
			limit: maxFreeze,
			measured: +(range.end - range.start).toFixed(2),
			fix: { action: "remove-freeze" as const, description: "trim the stalled part or add motion (push-in, cursor) to the held scene" },
		}));
}

// ── audio ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkLoudness(loud: Loud, profile: Profile): Diagnostic[] {
	const l = profile.loudness;
	if (!l) return [];
	const out: Diagnostic[] = [];
	const off = loud.lufs - l.target;
	if (Math.abs(off) > l.tolerance) {
		out.push({
			severity: "error",
			code: "audio/loudness",
			message: `integrated loudness ${loud.lufs.toFixed(1)} LUFS is ${Math.abs(off).toFixed(1)} LU ${off > 0 ? "above" : "below"} the ${profile.id} target ${l.target} LUFS (±${l.tolerance})`,
			measured: loud.lufs,
			limit: l.target,
			fix: { action: "normalize-loudness", description: `apply ${(-off).toFixed(1)} dB of gain (loudnorm I=${l.target}:TP=${l.truePeak})`, params: { gainDb: +(-off).toFixed(1), target: l.target } },
		});
	}
	if (loud.truePeak > l.truePeak) {
		out.push({
			severity: "error",
			code: "audio/true-peak",
			message: `peak ${loud.truePeak.toFixed(1)} dBFS is above the ${l.truePeak} dBTP ceiling: platform transcodes will distort`,
			measured: loud.truePeak,
			limit: l.truePeak,
			fix: { action: "limit-peaks", description: `limit the true peak to ${l.truePeak} dBTP` },
		});
	}
	return out;
}

export function checkClipping(runs: ClipRun[]): Diagnostic[] {
	return runs.map((r) => ({
		severity: "error" as const,
		code: "audio/clipping",
		message: `the audio clips (${r.samples} samples at full scale) between ${r.range.start.toFixed(2)}s and ${r.range.end.toFixed(2)}s`,
		range: r.range,
		fix: { action: "limit-peaks" as const, description: "lower the gain before the limiter or re-run the mix with a true-peak limiter" },
	}));
}

// ── delivery spec ─────────────────────────────────────────────────────────────────────────────────────────────────

export function checkSpec(info: MediaInfo, profile: Profile, keyGap?: number): Diagnostic[] {
	const out: Diagnostic[] = [];
	if (profile.aspect) {
		const ratio = info.w / info.h;
		if (Math.abs(ratio - profile.aspect.ratio) / profile.aspect.ratio > profile.aspect.tolerance) {
			out.push({
				severity: "error",
				code: "spec/aspect",
				message: `${info.w}x${info.h} is ${ratio.toFixed(3)}:1, ${profile.id} needs ${profile.aspect.ratio.toFixed(3)}:1`,
				measured: +ratio.toFixed(3),
				limit: +profile.aspect.ratio.toFixed(3),
				fix: { action: "change-resolution", description: "render the matching cut (--aspect) instead of cropping this one" },
			});
		}
	}
	if (profile.minShortSide && Math.min(info.w, info.h) < profile.minShortSide) {
		out.push({
			severity: "warning",
			code: "spec/resolution",
			message: `short side ${Math.min(info.w, info.h)}px is below ${profile.minShortSide}px for ${profile.id}: it will look soft`,
			measured: Math.min(info.w, info.h),
			limit: profile.minShortSide,
			fix: { action: "change-resolution", description: `render at >= ${profile.minShortSide}px on the short side` },
		});
	}
	if (info.kind === "image") return out;
	const dur = info.duration ?? 0;
	if (profile.maxDuration && dur > profile.maxDuration) {
		out.push({ severity: "error", code: "spec/duration", message: `${dur.toFixed(1)}s is longer than the ${profile.maxDuration}s ${profile.id} limit`, measured: +dur.toFixed(1), limit: profile.maxDuration, fix: { action: "trim", description: `cut to <= ${profile.maxDuration}s` } });
	}
	if (profile.minDuration && dur < profile.minDuration) {
		out.push({ severity: "error", code: "spec/duration", message: `${dur.toFixed(1)}s is shorter than the ${profile.minDuration}s ${profile.id} minimum`, measured: +dur.toFixed(1), limit: profile.minDuration, fix: { action: "trim", description: `at least ${profile.minDuration}s` } });
	}
	if (profile.codecs && info.vcodec && !profile.codecs.includes(info.vcodec)) {
		out.push({ severity: "error", code: "spec/codec", message: `video codec ${info.vcodec} is not accepted for ${profile.id} (${profile.codecs.join(", ")})`, fix: { action: "re-encode", description: `encode as ${profile.codecs[0]}` } });
	}
	if (profile.maxVideoKbps && info.videoKbps && info.videoKbps > profile.maxVideoKbps) {
		out.push({ severity: "warning", code: "spec/bitrate", message: `video bitrate ${Math.round(info.videoKbps)} kb/s exceeds ${profile.maxVideoKbps} kb/s: the platform will re-encode it`, measured: Math.round(info.videoKbps), limit: profile.maxVideoKbps, fix: { action: "lower-bitrate", description: `encode at <= ${profile.maxVideoKbps} kb/s (raise CRF)` } });
	}
	if (profile.maxKeyframeSec && keyGap !== undefined && keyGap > profile.maxKeyframeSec) {
		out.push({ severity: "warning", code: "spec/keyframe-interval", message: `longest keyframe gap is ${keyGap.toFixed(1)}s (max ${profile.maxKeyframeSec}s): seeking and platform transcodes degrade`, measured: +keyGap.toFixed(1), limit: profile.maxKeyframeSec, fix: { action: "set-keyframe-interval", description: `x264 -g ${Math.round(profile.maxKeyframeSec * (info.fps ?? 30))}` } });
	}
	if (!info.hasAudio && profile.loudness && profile.id !== "site-sibling") {
		out.push({ severity: "info", code: "audio/missing", message: `${profile.id} expects audio but the file has none` });
	}
	return out;
}

// ── VMAF vs a reference ───────────────────────────────────────────────────────────────────────────────────────────

/** `libvmaf` prints `VMAF score: 93.12`. Below 90 on a re-encode is visibly worse than the reference. */
export function parseVmaf(stderr: string): number | undefined {
	const m = /VMAF score:\s*([\d.]+)/.exec(stderr);
	return m ? Number(m[1]) : undefined;
}

export function checkVmaf(score: number, min = 90): Diagnostic[] {
	if (score >= min) return [];
	return [
		{
			severity: score < min - 10 ? "error" : "warning",
			code: "quality/vmaf",
			message: `VMAF ${score.toFixed(1)} against the reference is below ${min}: the re-encode is visibly softer`,
			measured: score,
			limit: min,
			fix: { action: "lower-bitrate", description: "lower the CRF (higher quality) or use a slower preset" },
		},
	];
}
