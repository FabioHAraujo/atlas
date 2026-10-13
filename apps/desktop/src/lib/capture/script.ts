/**
 * Capture scripts: a recipe for a recording, as plain data. Pure (no Tauri, no DOM, no Svelte) so the app's runner,
 * the CLI/ctl validation and Studio all use one definition.
 *
 * A script is executed through the app's own stores (never OS input) while the native recorder rolls; the runner
 * records exact step timings into a timeline (see timeline.ts). Steps are declarative on purpose: no arbitrary JS,
 * so a script is safe to hand to a release build over the ctl socket.
 *
 * `focus` is the one step that is only a statement of intent: it changes nothing in the app. It says "the viewer
 * must be able to READ `target` for `ms` here" (`label` = what they should see, `textPx` = CSS px of the smallest
 * text in it). The runner records the element's rect into the timeline's `focus` track and waits `ms`; Studio's
 * virtual camera later zooms to it so the text is legible on a phone-sized cut.
 */

export const SCRIPT_VERSION = 1;
export const FPS_CHOICES = [24, 30, 60] as const;
/** Upper bound for one step and for the whole script: a typo must not record for hours. */
export const MAX_STEP_MS = 10 * 60_000;
export const MAX_SCRIPT_MS = 30 * 60_000;
export const MIN_SIDE = 320;
export const MAX_SIDE = 7680;

export type Selector = string;

type Base = { id?: string; note?: string };
export type Step = Base &
	(
		| { do: "pause"; ms: number }
		| { do: "view"; view: "agents" | "dashboard" | "worktree" }
		| { do: "worktree"; project: string; name?: string }
		| { do: "tab"; kind: "services" | "logs" | "config" }
		| { do: "terminal"; argv: string[]; label?: string }
		| { do: "run"; command: string; typeDelayMs?: number }
		| { do: "type"; selector: Selector; text: string; delayMs?: number }
		| { do: "click"; selector?: Selector; text?: string }
		| { do: "key"; combo: string }
		| { do: "scroll"; selector: Selector; to: number; ms: number }
		| {
				do: "wait";
				selector?: Selector;
				text?: string;
				terminal?: { contains: string; timeoutMs?: number };
				timeoutMs?: number;
		  }
		| { do: "zoom"; target: Selector; scale: number; ms: number }
		| { do: "focus"; target: Selector; label?: string; ms: number; textPx?: number }
		| { do: "caption"; text: string; ms: number }
		| { do: "pointer"; target: Selector; ms: number }
		| { do: "mark"; name: string }
		| { do: "shot"; name: string }
	);
export type StepKind = Step["do"];

export interface Script {
	version: typeof SCRIPT_VERSION;
	/** Logical (CSS) size the window is set to before recording; pixels = size x display scale. */
	size: { width: number; height: number };
	fps: 24 | 30 | 60;
	/** Draw a cursor overlay (inside the page, so it is in the video) that follows `click`/`pointer` steps. */
	cursor: boolean;
	steps: Step[];
}

export interface ScriptError {
	path: string;
	message: string;
}
export type ParseResult = { ok: true; script: Script } | { ok: false; errors: ScriptError[] };

const KINDS: StepKind[] = [
	"pause",
	"view",
	"worktree",
	"tab",
	"terminal",
	"run",
	"type",
	"click",
	"key",
	"scroll",
	"wait",
	"zoom",
	"focus",
	"caption",
	"pointer",
	"mark",
	"shot",
];
const TOP_KEYS = new Set(["version", "size", "fps", "cursor", "steps"]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DEFAULT_TYPE_DELAY = 90;
const DEFAULT_RUN_DELAY = 45;

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a script (an object or its JSON text). Collects every error with a `steps[i].field` path. */
export function parseScript(input: unknown): ParseResult {
	let raw = input;
	if (typeof input === "string") {
		try {
			raw = JSON.parse(input);
		} catch (e) {
			return { ok: false, errors: [{ path: "", message: `not valid JSON: ${(e as Error).message}` }] };
		}
	}
	if (!isObj(raw)) return { ok: false, errors: [{ path: "", message: "a script is a JSON object" }] };
	const errors: ScriptError[] = [];
	const err = (path: string, message: string) => errors.push({ path, message });

	for (const k of Object.keys(raw))
		if (!TOP_KEYS.has(k)) err(k, `unknown key (allowed: ${[...TOP_KEYS].join(", ")})`);
	if (raw.version !== SCRIPT_VERSION) err("version", `must be ${SCRIPT_VERSION}`);

	const size = raw.size;
	let width = 0;
	let height = 0;
	if (!isObj(size)) err("size", "needs { width, height }");
	else {
		for (const side of ["width", "height"] as const) {
			const v = size[side];
			if (typeof v !== "number" || !Number.isInteger(v) || v < MIN_SIDE || v > MAX_SIDE || v % 2 !== 0) {
				err(
					`size.${side}`,
					`must be an even integer ${MIN_SIDE}..${MAX_SIDE} (video encoders reject odd sizes)`,
				);
			} else if (side === "width") width = v;
			else height = v;
		}
	}

	const fps = raw.fps === undefined ? 60 : raw.fps;
	if (!FPS_CHOICES.includes(fps as 24)) err("fps", `must be one of ${FPS_CHOICES.join(", ")}`);
	if (raw.cursor !== undefined && typeof raw.cursor !== "boolean") err("cursor", "must be a boolean");

	const steps: Step[] = [];
	if (!Array.isArray(raw.steps) || raw.steps.length === 0) err("steps", "needs at least one step");
	else {
		const ids = new Set<string>();
		const names = new Set<string>();
		raw.steps.forEach((s, i) => {
			const step = parseStep(s, i, err, ids, names);
			if (step) steps.push(step);
		});
	}

	if (errors.length) return { ok: false, errors };
	const script: Script = {
		version: SCRIPT_VERSION,
		size: { width, height },
		fps: fps as Script["fps"],
		cursor: raw.cursor === true,
		steps,
	};
	const total = scriptDurationMs(script);
	if (total > MAX_SCRIPT_MS)
		return {
			ok: false,
			errors: [{ path: "steps", message: `declared time ${total} ms exceeds the ${MAX_SCRIPT_MS} ms cap` }],
		};
	return { ok: true, script };
}

function parseStep(
	s: unknown,
	i: number,
	err: (p: string, m: string) => void,
	ids: Set<string>,
	names: Set<string>,
): Step | undefined {
	const at = `steps[${i}]`;
	if (!isObj(s)) {
		err(at, 'a step is an object like { do: "pause", ms: 500 }');
		return undefined;
	}
	const kind = s.do;
	if (typeof kind !== "string" || !KINDS.includes(kind as StepKind)) {
		err(`${at}.do`, `unknown step "${String(kind)}"; one of: ${KINDS.join(", ")}`);
		return undefined;
	}
	const before = ids.size + names.size;
	let bad = false;
	const e = (field: string, message: string) => {
		bad = true;
		err(`${at}.${field}`, message);
	};
	const str = (f: string, required = true): string | undefined => {
		const v = s[f];
		if (v === undefined && !required) return undefined;
		if (typeof v !== "string" || v === "") e(f, "must be a non-empty string");
		return typeof v === "string" ? v : undefined;
	};
	const num = (f: string, min: number, max: number, required = true): number | undefined => {
		const v = s[f];
		if (v === undefined && !required) return undefined;
		if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
			e(f, `must be a number ${min}..${max}`);
		return typeof v === "number" ? v : undefined;
	};
	const ms = (f: string, required = true) => num(f, 0, MAX_STEP_MS, required);
	const label = (f: string) => {
		const v = str(f);
		if (v !== undefined && !NAME.test(v))
			e(f, "use letters, digits, - and _ (max 64): it becomes a file name and a label");
		if (v !== undefined && names.has(`${kind}:${v}`)) e(f, `duplicate ${kind} name "${v}"`);
		if (v !== undefined) names.add(`${kind}:${v}`);
	};

	const id = s.id;
	if (id !== undefined) {
		if (typeof id !== "string" || !NAME.test(id)) e("id", "use letters, digits, - and _ (max 64)");
		else if (ids.has(id)) e("id", `duplicate id "${id}"`);
		else ids.add(id);
	}
	if (s.note !== undefined && typeof s.note !== "string") e("note", "must be a string");

	const known = new Set(["do", "id", "note"]);
	const field = (...f: string[]) => f.forEach((x) => known.add(x));
	switch (kind as StepKind) {
		case "pause":
			field("ms");
			ms("ms");
			break;
		case "view":
			field("view");
			if (!["agents", "dashboard", "worktree"].includes(String(s.view)))
				e("view", "agents | dashboard | worktree");
			break;
		case "worktree":
			field("project", "name");
			str("project");
			str("name", false);
			break;
		case "tab":
			field("kind");
			if (!["services", "logs", "config"].includes(String(s.kind))) e("kind", "services | logs | config");
			break;
		case "terminal":
			field("argv", "label");
			if (!Array.isArray(s.argv) || s.argv.some((a) => typeof a !== "string"))
				e("argv", "must be a list of strings ([] = login shell)");
			str("label", false);
			break;
		case "run":
			field("command", "typeDelayMs");
			str("command");
			num("typeDelayMs", 0, 2000, false);
			break;
		case "type":
			field("selector", "text", "delayMs");
			str("selector");
			if (typeof s.text !== "string") e("text", "must be a string");
			num("delayMs", 0, 2000, false);
			break;
		case "click":
			field("selector", "text");
			if ((s.selector === undefined) === (s.text === undefined))
				e("selector", "give exactly one of selector or text");
			else if (s.selector !== undefined) str("selector");
			else str("text");
			break;
		case "key":
			field("combo");
			str("combo");
			break;
		case "scroll":
			field("selector", "to", "ms");
			str("selector");
			num("to", 0, 10_000_000);
			ms("ms");
			break;
		case "wait": {
			field("selector", "text", "terminal", "timeoutMs");
			const given = ["selector", "text", "terminal"].filter((k) => s[k] !== undefined);
			if (given.length !== 1) e("selector", "give exactly one of selector, text or terminal");
			else if (given[0] === "terminal") {
				const t = s.terminal;
				if (!isObj(t) || typeof t.contains !== "string" || t.contains === "")
					e("terminal", "needs { contains: string, timeoutMs? }");
				else if (
					t.timeoutMs !== undefined &&
					(typeof t.timeoutMs !== "number" || !(t.timeoutMs >= 0 && t.timeoutMs <= MAX_STEP_MS))
				)
					e("terminal.timeoutMs", "invalid");
			} else str(given[0]!);
			ms("timeoutMs", false);
			break;
		}
		case "zoom":
			field("target", "scale", "ms");
			str("target");
			num("scale", 1, 4);
			ms("ms");
			break;
		case "caption":
			field("text", "ms");
			str("text");
			ms("ms");
			break;
		case "focus":
			field("target", "label", "ms", "textPx");
			str("target");
			str("label", false);
			ms("ms");
			num("textPx", 4, 200, false);
			break;
		case "pointer":
			field("target", "ms");
			str("target");
			ms("ms");
			break;
		case "mark":
		case "shot":
			field("name");
			label("name");
			break;
	}
	for (const k of Object.keys(s)) if (!known.has(k)) e(k, `unknown field for "${kind}"`);
	void before;
	return bad ? undefined : (s as unknown as Step);
}

/** Time the declared steps take when nothing waits: pauses, typing (one key per delay, Enter included for `run`), eased motion. */
export function scriptDurationMs(script: Script): number {
	let t = 0;
	for (const s of script.steps) {
		switch (s.do) {
			case "pause":
			case "scroll":
			case "zoom":
			case "focus":
			case "caption":
			case "pointer":
				t += s.ms;
				break;
			case "type":
				t += s.text.length * (s.delayMs ?? DEFAULT_TYPE_DELAY);
				break;
			case "run":
				t += (s.command.length + 1) * (s.typeDelayMs ?? DEFAULT_RUN_DELAY);
				break;
		}
	}
	return t;
}
