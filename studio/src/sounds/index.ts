// bun studio sounds [generate|pick|list] — builds the Atlas earcons with the ElevenLabs Sound Effects API.
//
//   generate [id…] [--variants N] [--force]   request candidates (cached by prompt hash in .cache/sounds/raw)
//   pick [id…]                                trim, measure, gate by spec, normalise, encode the best per category to
//                                             apps/desktop/static/sounds, write the audition sheet + PROVENANCE.md
//   list                                      what each category asks for and what is on disk
//
// The key is read at run time only (ELEVENLABS_API_KEY, see lib/paths.ts) and is never printed or written.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ffmpeg } from "../lib/exec.ts";
import { CACHE, REPO, secret, StudioError } from "../lib/paths.ts";
import { parseArgs } from "../lib/films.ts";
import { alignDownbeat, analyze, findDownbeat, gainFor, leadingSilence, trimDecay } from "./dsp.ts";
import { capFade, decayDb, EARCONS, EARCON_LIST, FAMILY, MODEL, isCurrentTake, pickBest, promptFor, passes, takeName, type EarconId, type Stats } from "./spec.ts";

const RAW = join(CACHE, "sounds/raw");
const WORK = join(CACHE, "sounds/work");
const AUDITION = join(CACHE, "sounds/wav");
const OUT = join(REPO, "apps/desktop/static/sounds");
const SR = 48_000;
/** Target feel: RMS of the trimmed earcon, with the peak held under -3 dBFS. Quiet by design; the app scales further. */
const TARGET = { rmsDb: -22, peakCeilingDb: -3 };
/** The model and endpoint the files come from, recorded in PROVENANCE.md. */
const ENDPOINT = "POST https://api.elevenlabs.io/v1/sound-generation";
const MAX_BYTES = 20 * 1024;

const ids = (pos: string[]): EarconId[] => {
	const all = Object.keys(EARCONS) as EarconId[];
	const chosen = pos.length ? pos : all;
	for (const c of chosen) if (!all.includes(c as EarconId)) throw new StudioError(`unknown earcon "${c}"`, `known: ${all.join(", ")}`);
	return chosen as EarconId[];
};

async function generate(id: EarconId, variants: number, force: boolean): Promise<void> {
	mkdirSync(RAW, { recursive: true });
	for (let v = 0; v < variants; v++) {
		const file = join(RAW, takeName(id, v));
		if (existsSync(file) && !force) continue;
		const e = EARCONS[id];
		const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
			method: "POST",
			headers: { "Content-Type": "application/json", "xi-api-key": secret("ELEVENLABS_API_KEY") },
			// `prompt_influence` high: we want the written gesture followed, not the model's creativity.
			body: JSON.stringify({ text: promptFor(e), duration_seconds: e.requestSeconds, prompt_influence: 0.7 }),
		});
		if (!res.ok) throw new StudioError(`ElevenLabs ${res.status} generating "${id}" #${v}`, (await res.text()).slice(0, 300));
		await Bun.write(file, await res.arrayBuffer());
		console.log(`  ${id} #${v}  ${(statSync(file).size / 1024).toFixed(1)} KB`);
	}
}

/** Decode any file to 48 kHz mono float samples. */
async function decode(file: string): Promise<Float32Array> {
	const p = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { stdout: "pipe" });
	const buf = await new Response(p.stdout as ReadableStream).arrayBuffer();
	if ((await p.exited) !== 0) throw new StudioError(`ffmpeg could not decode ${file}`);
	return new Float32Array(buf);
}

/** Drop the lead-in silence (keeping 3 ms before the attack) and the padded tail (where the note has decayed DECAY_DB). */
function trim(x: Float32Array, db: number): { y: Float32Array; head: number } {
	const gate = 10 ** (-45 / 20);
	const first = x.findIndex((v) => Math.abs(v) >= gate);
	if (first < 0) return { y: new Float32Array(0), head: x.length / SR };
	const start = Math.max(0, first - Math.round(0.003 * SR));
	return { y: trimDecay(x.slice(start), SR, db), head: leadingSilence(x, SR) };
}

interface Candidate {
	id: string;
	file: string;
	stats: Stats;
	samples: Float32Array;
}

async function measure(id: EarconId): Promise<Candidate[]> {
	const out: Candidate[] = [];
	for (const f of readdirSync(RAW).filter((n) => isCurrentTake(id, n)).sort()) {
		const trimmed = trim(await decode(join(RAW, f)), decayDb(EARCON_LIST[id]));
		const { head } = trimmed;
		// A signature is cut to the picture: shift it so its strike lands where the intro's hit does.
		const at = EARCON_LIST[id].downbeatSeconds;
		const y = at !== undefined && findDownbeat(trimmed.y, SR) !== null ? alignDownbeat(trimmed.y, SR, at) : trimmed.y;
		if (at !== undefined && findDownbeat(trimmed.y, SR) === null) continue;
		const a = analyze(y, SR);
		const cap = Math.round(EARCONS[id].maxSeconds * SR);
		out.push({
			id: f.replace(/\.mp3$/, ""),
			file: join(RAW, f),
			samples: y,
			stats: { duration: a.duration, peakDb: a.peakDb, rmsDb: a.rmsDb, centroidHz: a.centroidHz, clipped: a.clipped, silentHead: head, ...(y.length > cap ? { levelAtCapDb: levelBefore(y, cap) } : {}) },
		});
	}
	return out;
}

/** Level (dB re the take's peak) of the 5 ms just before sample `at`. */
function levelBefore(y: Float32Array, at: number): number {
	let peak = 0;
	for (const v of y) peak = Math.max(peak, Math.abs(v));
	let m = 0;
	for (let i = Math.max(0, at - Math.round(0.005 * SR)); i < at; i++) m = Math.max(m, Math.abs(y[i]!));
	return 20 * Math.log10(Math.max(m, 1e-9) / Math.max(peak, 1e-9));
}

const f32 = (x: Float32Array) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);

/** Write the finished earcon: gain-matched, 5 ms fades, mono 48 kHz, shipped as .m4a (AAC); a .wav copy for auditioning stays in the gitignored cache. */
async function render(id: EarconId, c: Candidate): Promise<{ m4a: number; wav: string; rmsDb: number; peakDb: number }> {
	mkdirSync(WORK, { recursive: true });
	mkdirSync(AUDITION, { recursive: true });
	mkdirSync(OUT, { recursive: true });
	// Over its cap: end the note at the cap with a short fade (the picker only accepts takes that are quiet there).
	const cap = Math.round(EARCONS[id].maxSeconds * SR);
	const body = c.samples.length > cap ? c.samples.slice(0, cap) : c.samples;
	const trimmed = analyze(body, SR);
	const g = gainFor({ rmsDb: trimmed.rmsDb, peakDb: trimmed.peakDb }, TARGET);
	const y = Float32Array.from(body, (v) => v * g);
	const fadeIn = Math.round(0.005 * SR);
	const fadeOut = Math.round((c.samples.length > cap ? capFade(EARCONS[id].maxSeconds) : 0.005) * SR);
	for (let i = 0; i < fadeIn && i < y.length; i++) y[i]! *= i / fadeIn;
	for (let i = 0; i < fadeOut && i < y.length; i++) y[y.length - 1 - i]! *= i / fadeOut;
	const raw = join(WORK, `${id}.f32`);
	await Bun.write(raw, f32(y));
	const input = ["-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", raw];
	const wav = join(AUDITION, `${id}.wav`);
	await ffmpeg([...input, "-c:a", "pcm_s16le", wav]);
	await ffmpeg([...input, "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", join(OUT, `${id}.m4a`)]);
	rmSync(raw);
	const after = analyze(y, SR);
	return { m4a: statSync(join(OUT, `${id}.m4a`)).size, wav, rmsDb: after.rmsDb, peakDb: after.peakDb };
}

async function wavePng(id: EarconId, wav: string): Promise<void> {
	const dir = join(CACHE, "sounds/sheet");
	mkdirSync(dir, { recursive: true });
	await ffmpeg(["-i", wav, "-filter_complex", "showwavespic=s=640x120:colors=#7aa2ff", "-frames:v", "1", join(dir, `${id}.png`)]);
}

async function pick(chosen: EarconId[]): Promise<void> {
	const rows: string[] = [];
	const failures: string[] = [];
	const date = new Date().toISOString().slice(0, 10);
	for (const id of chosen) {
		const cands = await measure(id);
		if (!cands.length) {
			failures.push(`${id}: no takes (run: bun studio sounds generate ${id})`);
			continue;
		}
		const best = pickBest(EARCONS[id], cands);
		if (!best) {
			const why = cands
				.map((c) => {
					const v = passes(EARCONS[id], c.stats);
					return `${c.id.split(".")[1]}:${v.ok ? "ok" : v.why}`;
				})
				.join(" ");
			failures.push(`${id}: no candidate meets the spec (${why}); generate more with --variants or edit the gesture in spec.ts`);
			continue;
		}
		const r = await render(id, best);
		const finished = Math.min(best.stats.duration, EARCONS[id].maxSeconds);
		await wavePng(id, r.wav);
		if (r.m4a > MAX_BYTES) failures.push(`${id}: ${r.m4a} B exceeds the ${MAX_BYTES} B budget`);
		const take = best.id.split(".")[1];
		const ms = Math.round(finished * 1000);
		console.log(`  ${id.padEnd(16)} take ${take}  ${String(ms).padStart(4)} ms  rms ${r.rmsDb.toFixed(1)} dBFS  peak ${r.peakDb.toFixed(1)} dBFS  centroid ${Math.round(best.stats.centroidHz)} Hz  m4a ${r.m4a} B`);
		rows.push(`| \`${id}\` | ${EARCONS[id].meaning} | ${ms} ms | ${r.rmsDb.toFixed(1)} | ${r.peakDb.toFixed(1)} | ${Math.round(best.stats.centroidHz)} | ${r.m4a} | take ${take}, ${best.id.split(".")[2]} |`);
	}
	if (rows.length === Object.keys(EARCONS).length) writeProvenance(rows, date);
	if (failures.length) throw new StudioError("some earcons could not be finished", failures.join("\n"));
}

function writeProvenance(rows: string[], date: string): void {
	const prompts = (Object.keys(EARCONS) as EarconId[]).map((id) => `- \`${id}\`: ${promptFor(EARCONS[id])}`).join("\n");
	writeFileSync(
		join(OUT, "README.md"),
		`# Atlas earcons: provenance

Generated ${date} with the ElevenLabs Sound Effects (text-to-sound) API: \`${ENDPOINT}\`, model \`${MODEL}\`,
\`prompt_influence\` 0.7, then trimmed, gain-matched and encoded by \`bun studio sounds pick\` (studio/src/sounds).
Nothing here was taken from another sound library or the internet.

**License.** The files are output of the ElevenLabs API produced under the maintainers' paid account. Per ElevenLabs'
terms (https://elevenlabs.io/terms-of-use) generated output may be used commercially on paid plans; this was
generated while the account was on the plan the maintainers hold, and the terms at that date apply. If the account
plan changes, re-check the terms before redistributing the files outside Atlas.

Post-processing: leading/trailing silence cut at -45 dBFS (3 ms kept before the attack), gain set so the RMS of the
finished file is ${TARGET.rmsDb} dBFS with the peak under ${TARGET.peakCeilingDb} dBFS, 5 ms fade in and out,
mono, 48 kHz, AAC 48 kb/s in an .m4a container (WebKit decodes it natively; only the .m4a files ship).

| id | meaning | length | RMS dBFS | peak dBFS | centroid Hz | .m4a bytes | take |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Prompts

Every prompt carries the same timbre sentence ("${FAMILY}") so the set reads as one brand.

${prompts}

## Regenerating

\`bun studio sounds generate [id…] --variants 4\` then \`bun studio sounds pick [id…]\`. The ElevenLabs key is read from the
environment or \`ATLAS_STUDIO_ENV\` at run time only. Takes are cached (gitignored) in studio/.cache/sounds.
`,
	);
}

function list(): void {
	for (const id of Object.keys(EARCONS) as EarconId[]) {
		const e = EARCONS[id];
		const have = existsSync(join(OUT, `${id}.m4a`)) ? `${statSync(join(OUT, `${id}.m4a`)).size} B` : "-";
		console.log(`${id.padEnd(16)} ${e.kind.padEnd(9)} <=${Math.round(e.maxSeconds * 1000)} ms  on disk: ${have}\n    ${e.meaning}\n    ${promptFor(e)}`);
	}
}

export async function main(argv: string[]): Promise<void> {
	const [sub = "list", ...rest] = argv;
	const { pos, flags } = parseArgs(rest);
	if (sub === "list") return list();
	if (sub === "generate") {
		const variants = flags.variants === undefined || flags.variants === true ? 4 : Number(flags.variants);
		if (!Number.isInteger(variants) || variants < 1 || variants > 12) throw new StudioError("--variants must be 1..12");
		for (const id of ids(pos)) {
			console.log(id);
			await generate(id, variants, flags.force === true);
		}
		return;
	}
	if (sub === "pick") return pick(ids(pos));
	throw new StudioError(`unknown sounds command "${sub}"`, "bun studio sounds list|generate|pick");
}
