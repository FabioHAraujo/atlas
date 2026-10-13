// bun scripts/selection-bench.ts [--name N] [--spaces 13] [--rounds 40] [--warmup 4] [--save docs/perf/x.json] [--no-check] [--keep]
// bun scripts/selection-bench.ts --judge docs/perf/x.json [--warmup 4] [--no-check]    (re-judge a saved report, no app)
//
// What one space selection costs the main thread, in the real app: A→B→A over a scratch registry of ~13 projects
// (the user's shape), p50/p95/max of the synchronous flush, the longest main-thread stall, and how many DOM nodes
// the selection touched. Exits 1 when the budget in `apps/desktop/src/lib/debug/selectionBench.ts` is exceeded.
//
// It drives an agent instance (never the user's app): `bun run desktop:agent -- --name <N> --scratch` first, or let
// this script start (and stop) its own with `--name`. The fixtures are throwaway git repos under /tmp.
import { $ } from "bun";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BUDGET,
	check,
	summarize,
	type Sample,
} from "../apps/desktop/src/lib/debug/selectionBench.ts";

const arg = (k: string, d?: string) => {
	const i = process.argv.indexOf(`--${k}`);
	return i >= 0 ? process.argv[i + 1] : d;
};
const name = arg("name", "selbench")!;
const spaces = Number(arg("spaces", "13"));
const rounds = Number(arg("rounds", "40"));
const save = arg("save");
const warmup = Number(arg("warmup", "4"));
const keep = process.argv.includes("--keep");
const root = join(import.meta.dir, "..");
const atlas = join(root, "target/debug/atlas");
const sock = `/private/tmp/atlas-agent-${name}/debug.sock`;
const env = { ...process.env, ATLAS_DEBUG_SOCK: sock };

const debug = async (...a: string[]) =>
	(await $`${atlas} desktop debug ${a}`.env(env).quiet()).text();
const evalJs = async (js: string) => JSON.parse(await debug("eval", js));

/** `n` throwaway repos with an atlas.yaml: what `projects_add` needs. */
function fixtures(n: number): string[] {
	const base = "/private/tmp/selbench-fixtures";
	const dirs: string[] = [];
	for (let i = 0; i < n; i++) {
		const d = join(base, `space-${String(i).padStart(2, "0")}`);
		mkdirSync(join(d, "src"), { recursive: true });
		writeFileSync(
			join(d, "atlas.yaml"),
			`name: space-${i}\nservices:\n  web:\n    command: "sleep 100000"\n    port: ${20000 + i}\n  api:\n    command: "sleep 100000"\n    port: ${30000 + i}\n`,
		);
		writeFileSync(join(d, "src/index.ts"), `console.log(${i});\n`);
		dirs.push(d);
	}
	return dirs;
}

/** The summary a run reports: the first `warmup` selections pay for lazy chunks and cold caches, they are the app starting. */
function report(all: Sample[], layers: number, dom: number) {
	const samples = all.slice(warmup);
	return {
		when: new Date().toISOString(),
		spaces,
		rounds,
		warmup,
		layers,
		dom,
		budget: BUDGET,
		...summarize(samples),
		/** Every measured selection, warmup included: `--judge` re-applies `--warmup` to this list. */
		samples: all,
	};
}

/**
 * Exit 1 (message on stderr) when the budget is exceeded, unless `--no-check`.
 * `layers` is what the page had mounted: a crashed app ("Atlas hit an error") has none, touches no node and would otherwise
 * report a perfect run. A selection that changed nothing in the DOM did not happen.
 */
function verdict(samples: Sample[], layers?: number) {
	const bad = check(summarize(samples));
	if (layers !== undefined && layers < 2)
		bad.push(
			`the page has ${layers} space layers mounted (crashed or not on a worktree view?)`,
		);
	if (samples.length && samples.every((s) => s.records === 0))
		bad.push("every selection touched nothing: the page did not react");
	if (bad.length && !process.argv.includes("--no-check")) {
		console.error(`selection budget exceeded:\n  ${bad.join("\n  ")}`);
		process.exit(1);
	}
}

async function main() {
	const started = (await $`ls ${sock}`.quiet().nothrow()).exitCode === 0;
	if (!started)
		await $`bun run desktop:agent -- --name ${name} --scratch`
			.cwd(root)
			.quiet();
	try {
		for (const d of fixtures(spaces)) {
			await evalJs(
				`await window.__TAURI_INTERNALS__.invoke("projects_add", { root: ${JSON.stringify(d)} }); return 1`,
			);
		}
		await evalJs(
			`await window.__atlas.store.refresh(); return window.__atlas.store.projects.length`,
		);
		// the page-side bench is a module of the app (debug/selectionBench.ts); the agent exposes it next to __atlasDebug
		const kick = `window.__selBench = null; window.__atlasDebug.selectionBench({ rounds: ${rounds} }).then((r) => (window.__selBench = r), (e) => (window.__selBench = { error: String(e) })); return 1`;
		await evalJs(kick);
		let res: {
			samples: Sample[];
			layers: number;
			dom: number;
			error?: string;
		} | null = null;
		for (let i = 0; i < 600 && !res; i++) {
			await Bun.sleep(500);
			res = await evalJs(`return window.__selBench`);
		}
		if (!res)
			throw new Error("the selection bench did not finish in 5 minutes");
		if (res.error) throw new Error(res.error);
		// the first selections pay for lazy chunks and cold caches: they are the app starting, not a selection
		const out = report(res.samples, res.layers, res.dom);
		console.log(JSON.stringify({ ...out, samples: undefined }, null, 2));
		if (save)
			writeFileSync(join(root, save), `${JSON.stringify(out, null, 2)}\n`);
		verdict(res.samples.slice(warmup), res.layers);
	} finally {
		if (!started && !keep)
			await $`bun run desktop:agent -- --stop --name ${name}`
				.cwd(root)
				.quiet()
				.nothrow();
	}
}

const judging = arg("judge");
if (judging) {
	// a saved report holds every measured selection: warmup applies here too (`--warmup 0` judges all of them)
	const saved = JSON.parse(readFileSync(judging, "utf8")) as {
		samples: Sample[];
		layers?: number;
	};
	verdict(saved.samples.slice(warmup), saved.layers);
} else await main();
