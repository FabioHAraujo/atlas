import { describe, expect, test } from "bun:test";
import { StudioError } from "../lib/paths.ts";
import { FIXTURES } from "../capture/fixtures.ts";
import { canonicalJson, captureKey, DEFAULT_INSTANCE, type FixtureName, groupByInstance, parseRecipeV1, planRun, RECIPE_SCHEMA } from "./recipe.ts";

const script = { version: 1, size: { width: 1280, height: 800 }, steps: [{ do: "pause", ms: 100 }, { do: "shot", name: "panel" }] };
const recipe = (over: Record<string, unknown> = {}) => ({
	schema: RECIPE_SCHEMA,
	id: "tour",
	title: "Product tour",
	captures: [{ id: "panel", script, shots: ["panel"] }],
	...over,
});

describe("parseRecipeV1", () => {
	test("a minimal recipe parses: schema, id, one capture with a script", () => {
		const r = parseRecipeV1(recipe());
		expect(r.id).toBe("tour");
		expect(r.captures[0]!.script.fps).toBe(60);
		expect(r.film).toBeUndefined();
	});

	test("the schema string is required and versioned: an unknown version is refused, not guessed", () => {
		expect(() => parseRecipeV1(recipe({ schema: "atlas.recipe/2" }))).toThrow(StudioError);
		expect(() => parseRecipeV1(recipe({ schema: undefined }))).toThrow(/schema/);
	});

	test("capture ids are unique slugs (they are asset keys and file names)", () => {
		const dup = recipe({ captures: [{ id: "a", script }, { id: "a", script }] });
		expect(() => parseRecipeV1(dup)).toThrow(/duplicate capture id "a"/);
		expect(() => parseRecipeV1(recipe({ captures: [{ id: "../x", script }] }))).toThrow(/capture id/);
	});

	test("every capture script error is reported with its capture id and path", () => {
		const bad = recipe({ captures: [{ id: "panel", script: { ...script, steps: [{ do: "teleport" }] } }] });
		expect(() => parseRecipeV1(bad)).toThrow(/panel[\s\S]*steps\[0\]\.do/);
	});

	test("`shots` lists must name shot steps that exist in the script (a typo would silently lose a screenshot)", () => {
		const s = { ...script, steps: [{ do: "shot", name: "panel" }] };
		expect(parseRecipeV1(recipe({ captures: [{ id: "c", script: s, shots: ["panel"] }] })).captures[0]!.shots).toEqual(["panel"]);
		expect(() => parseRecipeV1(recipe({ captures: [{ id: "c", script: s, shots: ["nope"] }] }))).toThrow(/shot "nope"/);
	});

	test("a film reference names the film id and the cut that consumes the captures", () => {
		const r = parseRecipeV1(recipe({ film: { id: "atlas-1-0", cut: "16x9" } }));
		expect(r.film).toEqual({ id: "atlas-1-0", cut: "16x9" });
		expect(() => parseRecipeV1(recipe({ film: { cut: "16x9" } }))).toThrow(/film\.id/);
	});

	test("stages default to capture only; unknown stages are refused", () => {
		expect(parseRecipeV1(recipe()).stages).toEqual(["capture"]);
		expect(parseRecipeV1(recipe({ stages: ["capture", "render", "lint"], film: { id: "f" } })).stages).toEqual(["capture", "render", "lint"]);
		expect(() => parseRecipeV1(recipe({ stages: ["capture", "upload"] }))).toThrow(/stage "upload"/);
	});

	test("render/lint/publish need a film to act on", () => {
		expect(() => parseRecipeV1(recipe({ stages: ["capture", "render"] }))).toThrow(/film/);
	});

	test("stages run in pipeline order whatever order the file lists them", () => {
		const r = parseRecipeV1(recipe({ stages: ["publish", "capture", "lint", "render"], film: { id: "f" } }));
		expect(r.stages).toEqual(["capture", "render", "lint", "publish"]);
	});

	test("unknown top-level keys are errors (a misspelled `captures:` must not run nothing)", () => {
		expect(() => parseRecipeV1(recipe({ capture: [] }))).toThrow(/capture/);
	});
});

describe("canonicalJson", () => {
	test("sorts keys at every depth so equal data hashes equally", () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
	});
	test("undefined fields are dropped, like JSON", () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
	});
});

describe("captureKey (the cache identity of one recorded clip)", () => {
	const r = parseRecipeV1(recipe());
	const cap = r.captures[0]!;
	const build = { app: "sha-aaa", atlas: "0.9.1" };

	test("is stable across calls and key order", () => {
		expect(captureKey(cap, build)).toBe(captureKey(structuredClone(cap), build));
	});

	test("changes when the script changes, or the app build changes (a new UI must be re-recorded)", () => {
		const k = captureKey(cap, build);
		const edited = parseRecipeV1(recipe({ captures: [{ id: "panel", script: { ...script, steps: [{ do: "pause", ms: 101 }, { do: "shot", name: "panel" }] }, shots: ["panel"] }] })).captures[0]!;
		expect(captureKey(edited, build)).not.toBe(k);
		expect(captureKey(cap, { ...build, app: "sha-bbb" })).not.toBe(k);
		expect(captureKey(cap, { ...build, atlas: "0.9.2" })).not.toBe(k);
	});

	test("does not depend on the capture id or title: renaming is not re-recording", () => {
		const renamed = { ...cap, id: "other" };
		expect(captureKey(renamed, build)).toBe(captureKey(cap, build));
	});

	test("is a short lowercase hex string usable in a file name", () => {
		expect(captureKey(cap, build)).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("planRun", () => {
	const r = parseRecipeV1(recipe({ captures: [{ id: "a", script }, { id: "b", script: { ...script, fps: 30 } }], stages: ["capture", "render"], film: { id: "f" } }));
	const build = { app: "x", atlas: "1" };

	test("with an empty cache every capture runs, then the film stages", () => {
		const p = planRun(r, build, new Set());
		expect(p.map((s) => `${s.stage}:${s.id ?? ""}:${s.action}`)).toEqual(["capture:a:run", "capture:b:run", "render:f:run"]);
	});

	test("a cached capture is skipped (idempotent re-run), the rest still run", () => {
		const keyA = captureKey(r.captures[0]!, build);
		const p = planRun(r, build, new Set([keyA]));
		expect(p.find((s) => s.id === "a")!.action).toBe("cached");
		expect(p.find((s) => s.id === "b")!.action).toBe("run");
	});

	test("--force reruns even cached captures", () => {
		const all = new Set(r.captures.map((c) => captureKey(c, build)));
		const p = planRun(r, build, all, { force: true });
		expect(p.filter((s) => s.stage === "capture").every((s) => s.action === "run")).toBe(true);
	});

	test("only: limits the plan to the named stages", () => {
		const p = planRun(r, build, new Set(), { only: ["capture"] });
		expect(p.every((s) => s.stage === "capture")).toBe(true);
	});

	test("the film stages run whenever any capture ran, and also when none did but --force or no output exists is left to the stage itself", () => {
		const all = new Set(r.captures.map((c) => captureKey(c, build)));
		const p = planRun(r, build, all);
		expect(p.filter((s) => s.stage === "capture").every((s) => s.action === "cached")).toBe(true);
		expect(p.find((s) => s.stage === "render")!.action).toBe("run");
	});
});

describe("instance profile (what the app starts with)", () => {
	test("defaults to the seeded demo projects with onboarding already done: every existing recipe keeps its behaviour", () => {
		expect(parseRecipeV1(recipe()).captures[0]!.instance).toEqual(DEFAULT_INSTANCE);
		expect(DEFAULT_INSTANCE).toEqual({ projects: true, onboarding: false });
	});

	test("a first-run capture asks for no projects and the onboarding flow", () => {
		const r = parseRecipeV1(recipe({ captures: [{ id: "intro", script, instance: { projects: false, onboarding: true } }] }));
		expect(r.captures[0]!.instance).toEqual({ projects: false, onboarding: true });
	});

	test("unknown profile keys and non-boolean values are refused (a typo must not silently record the wrong app state)", () => {
		expect(() => parseRecipeV1(recipe({ captures: [{ id: "a", script, instance: { project: false } }] }))).toThrow(/instance.*"project"/);
		expect(() => parseRecipeV1(recipe({ captures: [{ id: "a", script, instance: { projects: "no" } }] }))).toThrow(/instance\.projects/);
	});

	test("the profile is part of the cache key: a clip of the empty app is never served for the seeded one", () => {
		const build = { app: "a", atlas: "b" };
		const [seeded, first] = [
			parseRecipeV1(recipe()).captures[0]!,
			parseRecipeV1(recipe({ captures: [{ id: "panel", script, shots: ["panel"], instance: { projects: false, onboarding: true } }] })).captures[0]!,
		];
		expect(captureKey(seeded, build)).not.toBe(captureKey(first, build));
		// spelling out the default is the same clip as leaving it out
		const spelled = parseRecipeV1(recipe({ captures: [{ id: "panel", script, shots: ["panel"], instance: { projects: true, onboarding: false } }] })).captures[0]!;
		expect(captureKey(spelled, build)).toBe(captureKey(seeded, build));
	});
});

describe("groupByInstance", () => {
	test("captures with the same profile share one app instance, in recipe order; different profiles never do", () => {
		const r = parseRecipeV1(
			recipe({
				captures: [
					{ id: "a", script },
					{ id: "intro", script, instance: { projects: false, onboarding: true } },
					{ id: "b", script, instance: { projects: true, onboarding: false } },
				],
			}),
		);
		const groups = groupByInstance(r.captures);
		expect(groups.map((g) => [g.instance, g.captures.map((c) => c.id)])).toEqual([
			[{ projects: true, onboarding: false }, ["a", "b"]],
			[{ projects: false, onboarding: true }, ["intro"]],
		]);
	});
});

describe("fixture (the state a clip starts from: a stack running, worktrees with agents)", () => {
	// The script grammar drives the UI but cannot start a stack or launch the scripted agents; those are coded fixtures
	// (capture/fixtures.ts) run in the app BEFORE the recorder rolls. The 1.0 loops needed all of them.
	const build = { app: "x", atlas: "1" };
	const withFixture = (fixture: string) => parseRecipeV1(recipe({ captures: [{ id: "panel", script, shots: ["panel"], fixture }] })).captures[0]!;

	test("a fixture names one of the built-in setups; an unknown one lists the choices", () => {
		for (const f of Object.keys(FIXTURES) as FixtureName[]) expect(withFixture(f).fixture).toBe(f);
		expect(() => withFixture("nope")).toThrow(/unknown fixture "nope"/);
		try {
			withFixture("nope");
		} catch (e) {
			expect(e).toBeInstanceOf(StudioError);
			expect((e as StudioError).hint).toContain("orbit-agents");
		}
	});

	test("no fixture means none: the field stays absent", () => {
		expect(parseRecipeV1(recipe()).captures[0]!.fixture).toBeUndefined();
	});

	test("the fixture is part of the cache key: a clip of a running stack is never served for a stopped one", () => {
		const none = parseRecipeV1(recipe()).captures[0]!;
		expect(captureKey(withFixture("orbit-stack"), build)).not.toBe(captureKey(none, build));
		expect(captureKey(withFixture("orbit-stack"), build)).not.toBe(captureKey(withFixture("orbit-agents"), build));
	});

	test("a capture with a fixture gets its own app instance: its stack and agents must not leak into the next clip", () => {
		const r = parseRecipeV1(recipe({ captures: [{ id: "a", script, fixture: "orbit-stack" }, { id: "b", script, fixture: "orbit-agents" }, { id: "c", script }] }));
		expect(groupByInstance(r.captures).map((g) => g.captures.map((c) => c.id))).toEqual([["a"], ["b"], ["c"]]);
	});
});
