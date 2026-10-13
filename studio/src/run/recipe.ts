// Recipe v1: a versioned, typed, diffable description of how to PRODUCE media, end to end, without an agent:
// capture clips and stills of the real app (scripts executed inside Atlas Desktop), then optionally compose/render,
// lint and publish a film from them. `bun studio run <recipe>` executes it. An agent is needed to AUTHOR a recipe;
// re-running one is a command. Captures are cached by (script, app build), so a re-run records only what changed.
//
// Alignment with the film IR (local://av-architecture.md (a)): a capture is a `Shot.kind = "capture"` source whose
// Take is the recorded clip; its AssetRef provenance is the capture key + app build + script hash (see run.ts).

import { createHash } from "node:crypto";
import { parseScript, type Script } from "../../../apps/desktop/src/lib/capture/script.ts";
import { StudioError } from "../lib/paths.ts";

export const RECIPE_SCHEMA = "atlas.recipe/1";

/** Pipeline order; a recipe lists the stages it wants, they always run in this order. */
export const STAGES = ["capture", "render", "lint", "publish"] as const;
export type Stage = (typeof STAGES)[number];

/** What the isolated app starts with. */
export interface InstanceProfile {
	/** Seed and register the demo projects. `false` = an empty app (first run: nothing to show but the welcome). */
	projects: boolean;
	/** Keep the first-run flow (intro, discovery) instead of marking onboarding done. */
	onboarding: boolean;
}
export const DEFAULT_INSTANCE: InstanceProfile = { projects: true, onboarding: false };

export interface CaptureSpec {
	/** Slug: the asset key is `rec:<recipe>/<id>`, files are named after it. */
	id: string;
	script: Script;
	/** The state the app starts in (parsed: always complete); captures with equal profiles share one app instance. */
	instance: InstanceProfile;
	/** Names of `shot` steps whose PNGs the recipe promises (checked against the script). */
	shots?: string[];
}

/** What a recipe FILE may say: the instance profile can be partial or left out. */
export type RecipeInput = Omit<Recipe, "captures"> & { captures: (Omit<CaptureSpec, "instance"> & { instance?: Partial<InstanceProfile> })[] };

export interface Recipe {
	schema: typeof RECIPE_SCHEMA;
	id: string;
	title?: string;
	captures: CaptureSpec[];
	/** The film (studio/films/<id>) that consumes the captures; required by the render/lint/publish stages. */
	film?: { id: string; cut?: string };
	stages: Stage[];
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOP = new Set(["schema", "id", "title", "captures", "film", "stages"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseRecipeV1(input: unknown): Recipe {
	if (!isObj(input)) throw new StudioError("a recipe is a JSON object");
	if (input.schema !== RECIPE_SCHEMA) throw new StudioError(`recipe schema must be "${RECIPE_SCHEMA}", got ${JSON.stringify(input.schema)}`, "set `schema` to the version this studio understands");
	for (const k of Object.keys(input)) if (!TOP.has(k)) throw new StudioError(`unknown recipe key "${k}"`, `allowed: ${[...TOP].join(", ")}`);
	if (typeof input.id !== "string" || !SLUG.test(input.id)) throw new StudioError(`recipe id ${JSON.stringify(input.id)} is not a slug`, "lowercase letters, digits, - and _ (max 64)");
	if (!Array.isArray(input.captures) || input.captures.length === 0) throw new StudioError("`captures` needs at least one capture");

	const ids = new Set<string>();
	const captures = input.captures.map((c, i): CaptureSpec => {
		if (!isObj(c)) throw new StudioError(`captures[${i}] must be an object { id, script, shots? }`);
		if (typeof c.id !== "string" || !SLUG.test(c.id)) throw new StudioError(`capture id ${JSON.stringify(c.id)} (captures[${i}]) is not a slug`, "lowercase letters, digits, - and _ (max 64)");
		if (ids.has(c.id)) throw new StudioError(`duplicate capture id "${c.id}"`);
		ids.add(c.id);
		const parsed = parseScript(c.script);
		if (!parsed.ok) throw new StudioError(`capture "${c.id}" has an invalid script:\n${parsed.errors.map((e) => `  ${e.path || "(script)"}: ${e.message}`).join("\n")}`, "the grammar is apps/desktop/src/lib/capture/script.ts");
		const shots = c.shots === undefined ? undefined : stringList(c.shots, `capture "${c.id}" shots`);
		if (shots) {
			const have = new Set(parsed.script.steps.flatMap((s) => (s.do === "shot" ? [s.name] : [])));
			for (const s of shots) if (!have.has(s)) throw new StudioError(`capture "${c.id}" promises shot "${s}" but its script has no such shot step`, `shot steps: ${[...have].join(", ") || "(none)"}`);
		}
		return { id: c.id, script: parsed.script, instance: instanceProfile(c.instance, c.id), ...(shots ? { shots } : {}) };
	});

	let film: Recipe["film"];
	if (input.film !== undefined) {
		if (!isObj(input.film) || typeof input.film.id !== "string" || !input.film.id) throw new StudioError("film.id is required (a studio/films/<id> name)");
		film = { id: input.film.id, ...(typeof input.film.cut === "string" ? { cut: input.film.cut } : {}) };
	}

	const asked = input.stages === undefined ? ["capture"] : stringList(input.stages, "stages");
	for (const s of asked) if (!(STAGES as readonly string[]).includes(s)) throw new StudioError(`unknown stage "${s}"`, `stages: ${STAGES.join(", ")}`);
	const stages = STAGES.filter((s) => asked.includes(s));
	if (!film && stages.some((s) => s !== "capture")) throw new StudioError("render, lint and publish need a film to act on", 'add `film: { id: "<film id>" }`');

	return { schema: RECIPE_SCHEMA, id: input.id, ...(typeof input.title === "string" ? { title: input.title } : {}), captures, ...(film ? { film } : {}), stages };
}

function instanceProfile(v: unknown, id: string): InstanceProfile {
	if (v === undefined) return { ...DEFAULT_INSTANCE };
	if (!isObj(v)) throw new StudioError(`capture "${id}" instance must be an object { projects?, onboarding? }`);
	for (const k of Object.keys(v)) if (k !== "projects" && k !== "onboarding") throw new StudioError(`capture "${id}": unknown instance key "${k}"`, "allowed: projects, onboarding");
	const out = { ...DEFAULT_INSTANCE };
	for (const k of ["projects", "onboarding"] as const) {
		const x = v[k];
		if (x === undefined) continue;
		if (typeof x !== "boolean") throw new StudioError(`capture "${id}": instance.${k} must be true or false, got ${JSON.stringify(x)}`);
		out[k] = x;
	}
	return out;
}

function stringList(v: unknown, what: string): string[] {
	if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new StudioError(`${what} must be a list of strings`);
	return v as string[];
}

/** JSON with every object's keys sorted: equal data, equal text, equal hash. Undefined fields are dropped like JSON does. */
export function canonicalJson(v: unknown): string {
	return JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** What identifies the app a clip was recorded from: re-record when either changes. */
export interface BuildId {
	app: string;
	atlas: string;
}

/** Cache identity of one recorded clip: the script (what happens) and the build (what it happens in). Not the id or title. */
export function captureKey(c: CaptureSpec, build: BuildId): string {
	return createHash("sha256").update(canonicalJson({ script: c.script, shots: c.shots ?? [], instance: c.instance, build })).digest("hex").slice(0, 16);
}

/** Captures grouped by instance profile, first-seen order: one app start per group. */
export function groupByInstance(captures: CaptureSpec[]): { instance: InstanceProfile; captures: CaptureSpec[] }[] {
	const groups = new Map<string, { instance: InstanceProfile; captures: CaptureSpec[] }>();
	for (const c of captures) {
		const k = canonicalJson(c.instance);
		const g = groups.get(k) ?? { instance: c.instance, captures: [] };
		g.captures.push(c);
		groups.set(k, g);
	}
	return [...groups.values()];
}

export interface PlanStep {
	stage: Stage;
	/** Capture id or film id. */
	id?: string;
	action: "run" | "cached";
	key?: string;
}

/** The ordered steps of a run. A capture whose key is in `cached` is skipped unless forced; film stages always run (they have their own caches). */
export function planRun(r: Recipe, build: BuildId, cached: ReadonlySet<string>, o: { force?: boolean; only?: Stage[] } = {}): PlanStep[] {
	const plan: PlanStep[] = [];
	for (const stage of r.stages) {
		if (o.only && !o.only.includes(stage)) continue;
		if (stage === "capture") {
			for (const c of r.captures) {
				const key = captureKey(c, build);
				plan.push({ stage, id: c.id, key, action: !o.force && cached.has(key) ? "cached" : "run" });
			}
		} else plan.push({ stage, id: r.film?.id, action: "run" });
	}
	return plan;
}
