// `bun studio run <recipe> [--force] [--only a,b] [--dry-run]`: the dispatcher calls `main(args)`.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { StudioError } from "../lib/paths.ts";
import { loadRecipeFile, runRecipe } from "./run.ts";
import { STAGES, type Stage } from "./recipe.ts";

const HELP = `bun studio run <recipe.ts|json> [--force] [--only capture,render,lint,publish] [--dry-run]

Executes a recipe (atlas.recipe/1) end to end, no agent needed:
  capture   one isolated Atlas Desktop; each script runs inside the app (no focus, no OS input); cached by
            (script, app build) so a re-run records only what changed
  render / lint / publish   the recipe's film, through the bun studio commands
--force re-records cached captures; --dry-run prints the plan. Output: studio/.cache/captures/<recipe>/<key>/
(video.mov, timeline.json, shots/*.png) and the manifest asset rec:<recipe>/<capture>.`;

export async function main(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { force: { type: "boolean" }, only: { type: "string" }, "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
	if (values.help || positionals.length === 0) {
		console.log(HELP);
		return;
	}
	const only = values.only?.split(",").map((s) => s.trim());
	for (const s of only ?? []) if (!(STAGES as readonly string[]).includes(s)) throw new StudioError(`unknown stage "${s}"`, `stages: ${STAGES.join(", ")}`);
	const recipe = await loadRecipeFile(resolve(positionals[0]!));
	console.log(`recipe ${recipe.id}${recipe.title ? ` · ${recipe.title}` : ""}`);
	const report = await runRecipe(recipe, { force: values.force, only: only as Stage[] | undefined, dryRun: values["dry-run"] });
	for (const [id, c] of Object.entries(report.captures)) {
		console.log(`  ${id}${c.cached ? " (cached)" : ""}  ${c.video}`);
		console.log(`    timeline ${c.timeline}`);
		for (const s of c.shots) console.log(`    shot     ${s}`);
	}
}
