import { describe, expect, test } from "bun:test";
import { alignDownbeat, analyze, findDownbeat, gainFor, leadingSilence, sine, trimDecay } from "./dsp.ts";

const SR = 48_000;

describe("analyze", () => {
	test("a 1 kHz sine at 0.5 has peak -6 dBFS, rms -9 dBFS, centroid near 1 kHz", () => {
		const a = analyze(sine(1000, 0.5, 0.3, SR), SR);
		expect(a.peakDb).toBeCloseTo(-6.02, 1);
		expect(a.rmsDb).toBeCloseTo(-9.03, 1);
		expect(a.centroidHz).toBeGreaterThan(900);
		expect(a.centroidHz).toBeLessThan(1150);
		expect(a.clipped).toBe(false);
		expect(a.duration).toBeCloseTo(0.3, 2);
	});

	test("a higher tone has a higher centroid (brightness orders correctly)", () => {
		const lo = analyze(sine(500, 0.5, 0.2, SR), SR).centroidHz;
		const hi = analyze(sine(4000, 0.5, 0.2, SR), SR).centroidHz;
		expect(hi).toBeGreaterThan(lo * 4);
	});

	test("samples at full scale are reported as clipped", () => {
		const x = sine(1000, 1.2, 0.1, SR).map((v) => Math.max(-1, Math.min(1, v)));
		expect(analyze(x, SR).clipped).toBe(true);
	});

	test("silence has no usable level and zero centroid instead of NaN", () => {
		const a = analyze(new Float32Array(SR / 10), SR);
		expect(a.centroidHz).toBe(0);
		expect(Number.isFinite(a.rmsDb)).toBe(true);
	});
});

describe("leadingSilence", () => {
	test("measures the lag before the attack", () => {
		const pad = new Float32Array(Math.round(0.08 * SR));
		const tone = sine(1000, 0.5, 0.2, SR);
		const x = new Float32Array(pad.length + tone.length);
		x.set(pad);
		x.set(tone, pad.length);
		expect(leadingSilence(x, SR)).toBeCloseTo(0.08, 2);
	});
	test("a take that starts at once has none", () => expect(leadingSilence(sine(1000, 0.5, 0.1, SR), SR)).toBeLessThan(0.002));
});

describe("gainFor", () => {
	test("brings the RMS to the target without pushing the peak past the ceiling", () => {
		// quiet and spiky: +20 dB of RMS gain would put the peak at +10 dBFS, so the -3 dBFS ceiling (+7 dB) wins
		const g = gainFor({ rmsDb: -40, peakDb: -10 }, { rmsDb: -20, peakCeilingDb: -3 });
		expect(20 * Math.log10(g)).toBeCloseTo(7, 3);
	});
	test("plain RMS match when the peak has room", () => {
		const g = gainFor({ rmsDb: -26, peakDb: -15 }, { rmsDb: -20, peakCeilingDb: -3 });
		expect(20 * Math.log10(g)).toBeCloseTo(6, 3);
	});
	test("a loud take is turned down", () => {
		expect(gainFor({ rmsDb: -10, peakDb: -1 }, { rmsDb: -20, peakCeilingDb: -3 })).toBeLessThan(1);
	});
});

describe("trimDecay", () => {
	// A mallet note: instant attack, exponential decay. The tail below -30 dB of its own peak is noise, not sound.
	const note = (seconds: number) => {
		const x = sine(800, 1, seconds, SR);
		for (let i = 0; i < x.length; i++) x[i]! *= Math.exp(-i / (0.08 * SR));
		return x;
	};

	test("cuts a long quiet tail where the note has decayed 30 dB below its own peak", () => {
		const y = trimDecay(note(0.8), SR, 30);
		// 30 dB = ln(31.6) * 0.08 s = 0.276 s
		expect(y.length / SR).toBeGreaterThan(0.25);
		expect(y.length / SR).toBeLessThan(0.31);
	});

	test("the threshold follows the take's own peak, so a quiet take is trimmed like a loud one", () => {
		const loud = trimDecay(note(0.8), SR, 30).length;
		const quiet = trimDecay(note(0.8).map((v) => v * 0.01), SR, 30).length;
		expect(Math.abs(loud - quiet)).toBeLessThan(SR * 0.002);
	});

	test("a take shorter than its decay is returned whole", () => {
		expect(trimDecay(note(0.1), SR, 30).length).toBe(note(0.1).length);
	});

	test("silence stays empty instead of throwing", () => {
		expect(trimDecay(new Float32Array(1000), SR, 30).length).toBe(0);
	});
});

describe("analyze.clipped means flat-topped, not merely loud", () => {
	// Incident: `clipped` was "any sample >= full scale", so the decoded mp3 of a hot but clean take (a 1-sample
	// overshoot) was rejected. Distortion is a RUN of samples stuck at the rail.
	test("a lone overshoot sample is not clipping", () => {
		const x = sine(300, 0.9, 0.2, SR);
		x[1000] = 1.02;
		expect(analyze(x, SR).clipped).toBe(false);
	});
	test("a run of rail-pinned samples is clipping", () => {
		const x = sine(300, 1.5, 0.2, SR).map((v) => Math.max(-1, Math.min(1, v)));
		expect(analyze(x, SR).clipped).toBe(true);
	});
});

describe("downbeat: the strike a signature's picture is cut to", () => {
	const SR2 = 48_000;
	// A quiet swell for 0.6 s, then a struck note: the downbeat is the strike, not the start of the swell.
	const takeWithStrike = (swell: number) => {
		const total = Math.round((swell + 0.8) * SR2);
		const x = new Float32Array(total);
		const sw = Math.round(swell * SR2);
		for (let i = 0; i < sw; i++) x[i] = 0.05 * (i / sw) * Math.sin((2 * Math.PI * 200 * i) / SR2);
		for (let i = sw; i < total; i++) x[i] = 0.9 * Math.exp(-(i - sw) / (0.2 * SR2)) * Math.sin((2 * Math.PI * 880 * i) / SR2);
		return x;
	};
	test("finds the strike after a quiet swell", () => {
		expect(findDownbeat(takeWithStrike(0.6), SR2)).toBeCloseTo(0.6, 2);
	});
	test("a take that starts with the strike has its downbeat at 0", () => {
		expect(findDownbeat(takeWithStrike(0), SR2)).toBeLessThan(0.01);
	});
	test("silence has no downbeat (null), never NaN", () => {
		expect(findDownbeat(new Float32Array(SR2), SR2)).toBeNull();
	});
	test("alignDownbeat shifts the take so the strike lands at the requested time, padding or trimming the head", () => {
		const x = takeWithStrike(0.9);
		const early = alignDownbeat(x, SR2, 0.55);
		expect(findDownbeat(early, SR2)).toBeCloseTo(0.55, 2);
		const x2 = takeWithStrike(0.2);
		const late = alignDownbeat(x2, SR2, 0.55);
		expect(findDownbeat(late, SR2)).toBeCloseTo(0.55, 2);
	});
});
