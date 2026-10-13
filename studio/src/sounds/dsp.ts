// Measurements on decoded mono samples (Float32, -1..1). Done here rather than with ffmpeg filters so the numbers
// do not depend on the installed ffmpeg version and short clips (below ebur128's 400 ms gate) are measured exactly.

export interface Analysis {
	/** Seconds of the whole buffer. */
	duration: number;
	peakDb: number;
	/** RMS over the whole buffer; for a trimmed earcon this is the "how loud does it feel" number. */
	rmsDb: number;
	/** Magnitude-weighted mean frequency of the spectrum (brightness), 0 for silence. */
	centroidHz: number;
	/** A flat-topped run at the rail (distortion), not merely a loud peak. */
	clipped: boolean;
}

/** Floor for dB conversion so silence is a finite number. */
const FLOOR = 1e-9;
const toDb = (x: number) => 20 * Math.log10(Math.max(x, FLOOR));
/** A run of this many consecutive samples pinned at the rail is clipping distortion; one stray sample is not. */
const CLIP_RUN = 4;
const RAIL = 0.99;

/** True when `x` has a flat-topped run: CLIP_RUN consecutive samples at or beyond the rail with the same sign. */
function flatTopped(x: Float32Array): boolean {
	let run = 0;
	let sign = 0;
	for (const v of x) {
		const s = v >= RAIL ? 1 : v <= -RAIL ? -1 : 0;
		run = s !== 0 && s === sign ? run + 1 : s !== 0 ? 1 : 0;
		sign = s;
		if (run >= CLIP_RUN) return true;
	}
	return false;
}

export function sine(hz: number, amp: number, seconds: number, sr: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * sr));
	for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
	return out;
}

/** Largest power of two not above n. */
const pow2Floor = (n: number) => 2 ** Math.floor(Math.log2(Math.max(n, 1)));

/** In-place radix-2 FFT of (re, im); length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j]!, re[i]!];
			[im[i], im[j]] = [im[j]!, im[i]!];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		for (let i = 0; i < n; i += len) {
			for (let k = 0; k < len / 2; k++) {
				const c = Math.cos(ang * k);
				const s = Math.sin(ang * k);
				const a = i + k;
				const b = a + len / 2;
				const tr = re[b]! * c - im[b]! * s;
				const ti = re[b]! * s + im[b]! * c;
				re[b] = re[a]! - tr;
				im[b] = im[a]! - ti;
				re[a]! += tr;
				im[a]! += ti;
			}
		}
	}
}

/** Spectral centroid of the buffer (Hann-windowed, zero-padded to a power of two). */
function centroid(x: Float32Array, sr: number): number {
	const n = pow2Floor(x.length) * 2;
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	for (let i = 0; i < x.length; i++) re[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, x.length - 1)));
	fft(re, im);
	let num = 0;
	let den = 0;
	for (let k = 1; k < n / 2; k++) {
		const mag = Math.hypot(re[k]!, im[k]!);
		num += mag * ((k * sr) / n);
		den += mag;
	}
	return den < 1e-6 ? 0 : num / den;
}

export function analyze(x: Float32Array, sr: number): Analysis {
	let peak = 0;
	let sum = 0;
	for (const v of x) {
		peak = Math.max(peak, Math.abs(v));
		sum += v * v;
	}
	return {
		duration: x.length / sr,
		peakDb: toDb(peak),
		rmsDb: toDb(Math.sqrt(sum / Math.max(1, x.length))),
		centroidHz: centroid(x, sr),
		clipped: flatTopped(x),
	};
}

/** Threshold (linear) where a sound is considered to have started: -45 dBFS. */
const ATTACK = 10 ** (-45 / 20);

/** Seconds before the first sample above the attack threshold. */
export function leadingSilence(x: Float32Array, sr: number): number {
	const i = x.findIndex((v) => Math.abs(v) >= ATTACK);
	return (i < 0 ? x.length : i) / sr;
}

/** Linear gain that moves `have` to the target RMS but never lets the peak pass the ceiling. */
export function gainFor(
	have: { rmsDb: number; peakDb: number },
	want: { rmsDb: number; peakCeilingDb: number },
): number {
	const db = Math.min(want.rmsDb - have.rmsDb, want.peakCeilingDb - have.peakDb);
	return 10 ** (db / 20);
}

/**
 * Cut a take where it has decayed `db` below its own peak (measured on a 5 ms smoothed envelope so a zero crossing
 * is not mistaken for silence). The generator pads takes with a long barely-audible tail; this keeps the note and
 * drops the padding, whatever the take's level. Empty for silence.
 */
export function trimDecay(x: Float32Array, sr: number, db: number): Float32Array {
	const win = Math.max(1, Math.round(0.005 * sr));
	const env = new Float32Array(x.length);
	let peak = 0;
	for (let i = 0; i < x.length; i += win) {
		let m = 0;
		for (let j = i; j < Math.min(x.length, i + win); j++) m = Math.max(m, Math.abs(x[j]!));
		for (let j = i; j < Math.min(x.length, i + win); j++) env[j] = m;
		peak = Math.max(peak, m);
	}
	if (peak < 1e-6) return new Float32Array(0);
	const gate = peak * 10 ** (-db / 20);
	let last = x.length - 1;
	while (last > 0 && env[last]! < gate) last--;
	return x.slice(0, last + 1);
}

/**
 * Seconds to the strike: the first moment the 5 ms envelope is within 20 dB of the take's peak AND rose 12 dB or more
 * over the 50 ms before it (an onset, not the slow build of a swell). null for silence.
 */
export function findDownbeat(x: Float32Array, sr: number): number | null {
	const win = Math.max(1, Math.round(0.005 * sr));
	const blocks = Math.floor(x.length / win);
	if (!blocks) return null;
	const env = new Float64Array(blocks);
	let peak = 0;
	for (let b = 0; b < blocks; b++) {
		let m = 0;
		for (let i = b * win; i < (b + 1) * win; i++) m = Math.max(m, Math.abs(x[i]!));
		env[b] = m;
		peak = Math.max(peak, m);
	}
	if (peak < 1e-6) return null;
	const near = peak * 10 ** (-20 / 20);
	const back = 10; // 50 ms of blocks
	for (let b = 0; b < blocks; b++) {
		if (env[b]! < near) continue;
		let before = 0;
		for (let k = Math.max(0, b - back); k < b; k++) before = Math.max(before, env[k]!);
		if (b === 0 || before < 1e-6 || env[b]! / before >= 10 ** (12 / 20)) return (b * win) / sr;
	}
	return null;
}

/** The take shifted so its strike lands at `at` seconds: silence is added at the head, or the head is cut. */
export function alignDownbeat(x: Float32Array, sr: number, at: number): Float32Array {
	const d = findDownbeat(x, sr);
	if (d === null) return x;
	const shift = Math.round((at - d) * sr);
	if (shift >= 0) {
		const out = new Float32Array(x.length + shift);
		out.set(x, shift);
		return out;
	}
	return x.slice(-shift);
}
