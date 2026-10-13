// `bun studio run <recipe> [--force] [--only capture,render,lint,publish] [--dry-run]`: execute a recipe end to end.
//
// capture : one isolated Atlas Desktop for every missing capture; each script runs INSIDE the app (ScreenCaptureKit on
//           its own window, state driven through the app's stores), results land in the cache keyed by (script, app
//           build), assets are registered in the manifest. A re-run with nothing changed records nothing.
// render / lint / publish : the film's own commands, through the stable `bun studio` surface.

import { readFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { registerAsset } from "../lib/assets.ts";
import { run } from "../lib/exec.ts";
import { CACHE, REPO, STUDIO, StudioError } from "../lib/paths.ts";
import { parseTimeline } from "../../../apps/desktop/src/lib/capture/timeline.ts";
import { provenance, runScriptIn, withInstance } from "../capture/app.ts";
import { cachedKeys, entryDir, readEntry, writeEntry } from "./cache.ts";
import { explainCaptureFailure } from "./errors.ts";
import { type BuildId, type CaptureSpec, groupByInstance, parseRecipeV1, planRun, type PlanStep, type Recipe, type Stage } from "./recipe.ts";

const CAPTURES = join(CACHE, "captures");
/** A capture is retried once when the failure looks transient (instance start-up), never when the script itself is wrong. */
const RETRIES = 1;
const TRANSIENT = /did not answer|did not start|debug bridge|app stores|ScreenCaptureKit did not|timed out waiting for the/i;

export async function loadRecipeFile(file: string): Promise<Recipe> {
	if (!(await Bun.file(file).exists())) throw new StudioError(`recipe not found: ${file}`, "bun studio run <recipe.json|recipe.ts>");
	const ext = extname(file);
	if (ext === ".json") return parseRecipeV1(await Bun.file(file).json());
	if (ext === ".ts" || ext === ".js") {
		// the recipe path is the caller's argument, known only at run time, so a static import cannot name it
		const mod = (await import(file)) as { default?: unknown };
		if (mod.default === undefined) throw new StudioError(`${file} has no default export`, "export default <recipe>");
		return parseRecipeV1(mod.default);
	}
	throw new StudioError(`recipe must be .json or .ts, got ${ext || "no extension"}: ${file}`);
}

/** What the clips are recorded from: the app sources' git state and the CLI version. A new UI must be re-recorded. */
export async function buildId(): Promise<BuildId> {
	const { out: sha } = await run(["git", "rev-parse", "--short=12", "HEAD"], { cwd: REPO });
	// uncommitted changes under the app change what is on screen: fold their content into the id
	const { out: diff } = await run(["git", "diff", "HEAD", "--", "apps/desktop/src", "crates/atlas-desktop/src"], { cwd: REPO });
	const dirty = diff ? new Bun.CryptoHasher("sha256").update(diff).digest("hex").slice(0, 8) : "";
	const { out: ver } = await run([join(REPO, "target/debug/atlas"), "version"], { allowFail: true });
	return { app: dirty ? `${sha.trim()}+${dirty}` : sha.trim(), atlas: /atlas (\S+)/.exec(ver)?.[1] ?? "unknown" };
}

export interface RunOpts {
	force?: boolean;
	only?: Stage[];
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface RunReport {
	recipe: string;
	build: BuildId;
	plan: PlanStep[];
	captures: Record<string, { key: string; cached: boolean; video: string; timeline: string; shots: string[] }>;
}

export async function runRecipe(recipe: Recipe, opts: RunOpts = {}): Promise<RunReport> {
	const log = opts.log ?? ((l: string) => console.log(l));
	const build = await buildId();
	const plan = planRun(recipe, build, cachedKeys(CAPTURES, recipe.id), { force: opts.force, only: opts.only });
	const report: RunReport = { recipe: recipe.id, build, plan, captures: {} };
	for (const p of plan) log(`  ${p.action === "cached" ? "=" : "▶"} ${p.stage}${p.id ? ` ${p.id}` : ""}${p.action === "cached" ? "  (cached)" : ""}`);
	if (opts.dryRun) return report;

	const todo = plan.filter((p) => p.stage === "capture" && p.action === "run");
	if (todo.length > 0) await captureAll(recipe, todo, build, report, log);
	for (const p of plan.filter((p) => p.stage === "capture" && p.action === "cached")) {
		const c = recipe.captures.find((x) => x.id === p.id)!;
		const e = readEntry(CAPTURES, recipe.id, p.key!)!;
		report.captures[c.id] = { key: p.key!, cached: true, video: e.video, timeline: e.timeline, shots: e.shots };
	}
	for (const p of plan) if (p.stage !== "capture") await filmStage(p.stage, recipe, log);
	return report;
}

async function captureAll(recipe: Recipe, todo: PlanStep[], build: BuildId, report: RunReport, log: (l: string) => void) {
	try {
		// one app start per instance profile (empty first-run app, seeded demo app...), in recipe order
		const wanted = new Set(todo.map((p) => p.id));
		for (const group of groupByInstance(recipe.captures.filter((c) => wanted.has(c.id)))) {
			await withInstance(group.instance, async (env, _ctx, atlas) => {
				for (const spec of group.captures) {
					const key = todo.find((p) => p.id === spec.id)!.key!;
					log(`▶ capture ${spec.id}`);
					const t0 = Date.now();
					const dir = entryDir(CAPTURES, recipe.id, key);
					for (let attempt = 0; ; attempt++) {
						rmSync(dir, { recursive: true, force: true });
						try {
							await runScriptIn(env, spec.script, dir);
							break;
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							if (attempt < RETRIES && TRANSIENT.test(msg)) {
								log(`  ↻ transient failure, retrying: ${msg.split("\n")[0]}`);
								continue;
							}
							throw e;
						}
					}
					await finishCapture(recipe, spec, key, build, atlas, dir, report);
					log(`✓ ${spec.id}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
				}
			});
		}
	} catch (e) {
		if (e instanceof StudioError && e.hint) throw e;
		throw explainCaptureFailure(e instanceof Error ? e.message : String(e));
	}
}

async function finishCapture(recipe: Recipe, spec: CaptureSpec, key: string, build: BuildId, atlas: string, dir: string, report: RunReport) {
	const timeline = join(dir, "timeline.json");
	const parsed = parseTimeline(JSON.parse(readFileSync(timeline, "utf8")));
	if (!parsed.ok) throw new StudioError("the app wrote a timeline Studio cannot read", parsed.errors.join("\n"));
	const video = join(dir, "video.mov");
	const assetKey = `rec:${recipe.id}/${spec.id}`;
	await registerAsset(assetKey, "recording", video, `bun studio run ${recipe.id}`, await provenance(atlas, { recipe: recipe.id, capture: spec.id, key, build, video: parsed.timeline.video, steps: parsed.timeline.steps.length }));
	writeEntry(CAPTURES, recipe.id, key, { capture: spec.id, build, recordedAt: new Date().toISOString() });
	const e = readEntry(CAPTURES, recipe.id, key)!;
	report.captures[spec.id] = { key, cached: false, video: e.video, timeline: e.timeline, shots: e.shots };
}

/** Film stages go through the `bun studio` CLI: its surface is the contract, not the modules behind it. */
async function filmStage(stage: Exclude<Stage, "capture">, recipe: Recipe, log: (l: string) => void) {
	const film = recipe.film!;
	const args = ["bun", join(STUDIO, "src/cli.ts"), stage, film.id];
	if (stage === "render" && film.cut) args.push("--aspect", film.cut.replace("x", ":"));
	log(`▶ ${stage} ${film.id}`);
	await run(args, { cwd: STUDIO, live: true });
}
