import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioError } from "../lib/paths.ts";
import { loadRecipeFile, runRecipe } from "./run.ts";
import { parseRecipeV1, RECIPE_SCHEMA } from "./recipe.ts";

const script = { version: 1, size: { width: 1280, height: 800 }, steps: [{ do: "pause", ms: 10 }] };
const tmp = () => mkdtempSync(join(tmpdir(), "studio-run-"));

describe("loadRecipeFile", () => {
	test("loads a .json recipe and a .ts recipe (default export) through the same validation", async () => {
		const d = tmp();
		const body = { schema: RECIPE_SCHEMA, id: "j", captures: [{ id: "c", script }] };
		writeFileSync(join(d, "r.json"), JSON.stringify(body));
		writeFileSync(join(d, "r.ts"), `export default ${JSON.stringify({ ...body, id: "t" })};\n`);
		expect((await loadRecipeFile(join(d, "r.json"))).id).toBe("j");
		expect((await loadRecipeFile(join(d, "r.ts"))).id).toBe("t");
	});

	test("a missing file, an unknown extension and a file without default export each say what to do", async () => {
		const d = tmp();
		await expect(loadRecipeFile(join(d, "none.json"))).rejects.toThrow(/not found/);
		writeFileSync(join(d, "r.yaml"), "a: 1");
		await expect(loadRecipeFile(join(d, "r.yaml"))).rejects.toThrow(/must be \.json or \.ts/);
		writeFileSync(join(d, "e.ts"), "export const x = 1;\n");
		await expect(loadRecipeFile(join(d, "e.ts"))).rejects.toThrow(/default export/);
	});

	test("an invalid recipe fails at load, before any app is started", async () => {
		const d = tmp();
		writeFileSync(join(d, "bad.json"), JSON.stringify({ schema: RECIPE_SCHEMA, id: "x", captures: [{ id: "c", script: { ...script, steps: [{ do: "nope" }] } }] }));
		await expect(loadRecipeFile(join(d, "bad.json"))).rejects.toBeInstanceOf(StudioError);
	});
});

describe("runRecipe --dry-run", () => {
	test("prints the plan and records nothing: no app is started, no cache entry written", async () => {
		const r = parseRecipeV1({ schema: RECIPE_SCHEMA, id: "dry-test-never-recorded", captures: [{ id: "c", script }] });
		const lines: string[] = [];
		const rep = await runRecipe(r, { dryRun: true, log: (l) => lines.push(l) });
		expect(rep.plan).toHaveLength(1);
		expect(rep.plan[0]).toMatchObject({ stage: "capture", id: "c", action: "run" });
		expect(rep.captures).toEqual({});
		expect(lines.join("\n")).toMatch(/capture c/);
	});

	test("the build id folds in the app's uncommitted changes, so editing the UI invalidates cached clips", async () => {
		const { buildId } = await import("./run.ts");
		const b = await buildId();
		expect(b.app).toMatch(/^[0-9a-f]{12}(\+[0-9a-f]{8})?$/);
		expect(b.atlas.length).toBeGreaterThan(0);
	});
});
