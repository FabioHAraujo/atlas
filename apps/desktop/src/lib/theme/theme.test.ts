// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import atlas from "../themes/atlas.json";
import dracula from "../themes/dracula.json";
import one from "../themes/one.json";
import { ansi16, cssVars, syntaxTokens, terminalColors } from "../theme.ts";
import { contrast, ensureContrast, fromOklch, toOklch } from "./color.ts";
import { complete } from "./derive.ts";
import {
	DEFAULT_SELECTION,
	migrateSelection,
	parseFamily,
	resolveTerminalTheme,
	resolveTheme,
	validateStyle,
} from "./schema.ts";
import {
	ANSI_KEYS,
	EDITOR_TOKENS,
	PLAYER_TOKENS,
	SYNTAX_ROLES,
	TERMINAL_KEYS,
	UI_TOKENS,
	allVars,
	synVar,
} from "./tokens.ts";

const families = { atlas, one, dracula };
const bundled = Object.values(families).flatMap((f) => parseFamily(f).themes);
const by = (name) => bundled.find((t) => t.name === name);

describe("color math", () => {
	test("OKLCH round-trips sRGB hex", () => {
		for (const hex of ["#282a36", "#f8f8f2", "#bd93f9", "#ff5555", "#fffbeb", "#000000", "#ffffff"])
			expect(fromOklch(toOklch(hex))).toBe(hex);
	});

	test("WCAG contrast matches known pairs", () => {
		expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
		expect(contrast("#f8f8f2", "#282a36")).toBeCloseTo(13.36, 1);
		expect(contrast("#6272a4", "#282a36")).toBeCloseTo(3.03, 1);
	});

	test("ensureContrast lifts toward the readable side and keeps passing colors", () => {
		expect(ensureContrast("#f8f8f2", "#282a36", 4.5)).toBe("#f8f8f2");
		expect(contrast(ensureContrast("#6272a4", "#282a36", 4.5), "#282a36")).toBeGreaterThanOrEqual(4.5);
		expect(contrast(ensureContrast("#a0a0a0", "#fffbeb", 4.5), "#fffbeb")).toBeGreaterThanOrEqual(4.5);
	});
});

describe("validation", () => {
	test("bundled families parse without a single issue", () => {
		for (const [name, f] of Object.entries(families))
			expect([name, parseFamily(f).issues]).toEqual([name, []]);
	});

	test("errors name the JSON path", () => {
		const r = parseFamily({
			themes: [
				{ name: "A", appearance: "sepia", style: {} },
				{ name: "B", appearance: "dark" },
			],
		});
		expect(r.themes).toEqual([]);
		expect(r.issues.map((i) => i.path)).toEqual(["$.themes[0].appearance", "$.themes[1].style"]);
	});

	test("bad colors, roles and unknown keys are warnings, not failures", () => {
		const issues = validateStyle(
			{ text: "red", "made.up": "#ffffff", syntax: { nope: { color: "#ffffff" }, keyword: { color: "x" } } },
			"s",
		);
		expect(issues.every((i) => i.level === "warn")).toBe(true);
		expect(issues.map((i) => i.path).sort()).toEqual([
			"s.made.up",
			"s.syntax.keyword.color",
			"s.syntax.nope",
			"s.text",
		]);
	});

	test("a newer file version warns, a font block is validated", () => {
		const r = parseFamily({
			themes: [
				{
					name: "A",
					appearance: "dark",
					style: {},
					atlas: { version: 9, font: { family: "Fira Code", size: 99 } },
				},
			],
		});
		expect(r.themes[0].font).toEqual({ family: "Fira Code" });
		expect(r.issues.map((i) => i.path)).toEqual(["$.themes[0].atlas.version", "$.themes[0].atlas.font.size"]);
	});
});

describe("completeness: every token the app reads exists in every theme", () => {
	const required = [...Object.keys(UI_TOKENS), ...Object.keys(EDITOR_TOKENS), ...TERMINAL_KEYS, ...ANSI_KEYS];

	for (const t of bundled)
		test(`${t.name}: all registry tokens resolve after complete()`, () => {
			const s = complete(t.style, t.appearance);
			const missing = required.filter((k) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s[k] ?? ""));
			expect(missing).toEqual([]);
			for (const k of Object.keys(PLAYER_TOKENS)) expect(s.players[0][k]).toMatch(/^#/);
			for (const r of SYNTAX_ROLES) expect([r, s.syntax[r]?.color]).toEqual([r, expect.stringMatching(/^#/)]);
			const vars = cssVars(s);
			expect(
				allVars().filter((v) => !v.endsWith("-italic") && !v.endsWith("-weight") && !(v in vars)),
			).toEqual([]);
		});

	test("a theme with only three colors becomes complete", () => {
		const s = complete(
			{ "terminal.background": "#101820", "terminal.foreground": "#dddddd", "text.accent": "#ff8800" },
			"dark",
		);
		for (const k of required) expect([k, typeof s[k]]).toEqual([k, "string"]);
		expect(s["editor.background"]).toBe("#101820");
		expect(s["text.accent"]).toBe("#ff8800");
	});

	test("an empty light theme is derived light, with AA text", () => {
		const s = complete({}, "light");
		expect(s["editor.background"]).toBe("#ffffff");
		for (const k of ["text", "text.muted", "text.accent", "created", "warning", "info", "error"])
			expect([k, contrast(s[k].slice(0, 7), s["elevated_surface.background"])]).toEqual([
				k,
				expect.any(Number),
			]);
		expect(contrast(s.text, s["editor.background"])).toBeGreaterThanOrEqual(7);
		expect(contrast(s["text.muted"], s["elevated_surface.background"])).toBeGreaterThanOrEqual(4.5);
	});

	test("explicit values are never overwritten", () => {
		const s = complete(
			{ text: "#123456", syntax: { keyword: { color: "#abcdef", font_style: "italic" } } },
			"dark",
		);
		expect(s.text).toBe("#123456");
		expect(s.syntax.keyword).toMatchObject({ color: "#abcdef", font_style: "italic" });
	});

	test("syntax derived from an ANSI-only palette follows the classic mapping", () => {
		const s = complete(
			{
				"terminal.background": "#000000",
				"terminal.ansi.magenta": "#ff00ff",
				"terminal.ansi.green": "#00ff00",
				"terminal.ansi.yellow": "#ffff00",
				"terminal.ansi.cyan": "#00ffff",
			},
			"dark",
		);
		expect(s.syntax.keyword.color).toBe("#ff00ff");
		expect(s.syntax.function.color).toBe("#00ff00");
		expect(s.syntax.string.color).toBe("#ffff00");
		expect(s.syntax.type.color).toBe("#00ffff");
	});
});

/** The official spec: https://draculatheme.com/spec */
describe("Dracula spec", () => {
	const d = by("Dracula").style;
	const a = by("Alucard").style;

	test("palette tokens (Dracula Classic)", () => {
		expect(d["editor.background"]).toBe("#282a36");
		expect(d["terminal.background"]).toBe("#282a36");
		expect(d["text"]).toBe("#f8f8f2");
		expect(d["terminal.selection.background"]).toBe("#44475a");
		expect(d["editor.line_number"]).toBe("#6272a4");
		expect(d["background"]).toBe("#21222c");
		expect(d["surface.background"]).toBe("#343746");
		expect(d.players[0].selection).toBe("#44475a");
	});

	test("ANSI table (Dracula Classic)", () => {
		expect(ansi16(d)).toEqual([
			"#21222c",
			"#ff5555",
			"#50fa7b",
			"#f1fa8c",
			"#bd93f9",
			"#ff79c6",
			"#8be9fd",
			"#f8f8f2",
			"#6272a4",
			"#ff6e6e",
			"#69ff94",
			"#ffffa5",
			"#d6acff",
			"#ff92df",
			"#a4ffff",
			"#ffffff",
		]);
	});

	test("syntax roles follow the spec scope mapping", () => {
		const t = syntaxTokens(d);
		expect(t.keyword.color).toBe("#ff79c6");
		expect(t.function.color).toBe("#50fa7b");
		expect(t.string.color).toBe("#f1fa8c");
		expect(t.number.color).toBe("#bd93f9");
		expect(t.boolean.color).toBe("#bd93f9");
		expect(t.comment).toMatchObject({ color: "#6272a4", italic: true });
		expect(t.type).toMatchObject({ color: "#8be9fd", italic: true });
		expect(t["variable.parameter"]).toMatchObject({ color: "#ffb86c", italic: true });
		expect(t["variable.special"]).toMatchObject({ color: "#bd93f9", italic: true });
		expect(t["type.parameter"]).toMatchObject({ color: "#ffb86c", italic: true });
		expect(t.tag.color).toBe("#ff79c6");
		expect(t.attribute.color).toBe("#50fa7b");
		expect(t.variable.color).toBe("#f8f8f2");
	});

	test("palette semantics: errors red, warnings orange, success green, info cyan", () => {
		expect(d.created).toBe("#50fa7b");
		expect(d.warning).toBe("#ffb86c");
		expect(d.info).toBe("#8be9fd");
		// UI text token is the spec red lifted to AA on the chrome surfaces; terminal/editor keep the spec red.
		expect(d["terminal.ansi.red"]).toBe("#ff5555");
		expect(contrast(d.error, d["surface.background"])).toBeGreaterThanOrEqual(4.5);
	});

	test("palette tokens (Alucard Classic)", () => {
		expect(a["editor.background"]).toBe("#fffbeb");
		expect(a.text).toBe("#1f1f1f");
		expect(a["terminal.selection.background"]).toBe("#cfcfde");
		expect(a["editor.line_number"]).toBe("#6c664b");
		expect(ansi16(a)).toEqual([
			"#fffbeb",
			"#cb3a2a",
			"#14710a",
			"#846e15",
			"#644ac9",
			"#a3144d",
			"#036a96",
			"#1f1f1f",
			"#6c664b",
			"#d74c3d",
			"#198d0c",
			"#9e841a",
			"#7862d0",
			"#bf185a",
			"#047fb4",
			"#2c2b31",
		]);
		const t = syntaxTokens(a);
		expect(t.keyword.color).toBe("#a3144d");
		expect(t.function.color).toBe("#14710a");
		expect(t.string.color).toBe("#846e15");
		expect(t.number.color).toBe("#644ac9");
		expect(t.type.color).toBe("#036a96");
		expect(t.comment.color).toBe("#6c664b");
	});

	test("both themes carry the spec URL and MIT attribution", () => {
		expect(dracula.author).toContain("https://draculatheme.com/spec");
		expect(dracula.author).toContain("MIT");
		expect(dracula.$comment).toContain("https://draculatheme.com/spec");
	});

	test("body text and labels reach WCAG AA on the editor and chrome surfaces", () => {
		for (const t of [by("Dracula"), by("Alucard")]) {
			const s = complete(t.style, t.appearance);
			for (const surface of ["editor.background", "background", "surface.background"])
				for (const k of ["text", "text.muted", "text.accent", "created", "warning", "info", "error"])
					expect([t.name, k, surface, contrast(s[k].slice(0, 7), s[surface].slice(0, 7)) >= 4.5]).toEqual([
						t.name,
						k,
						surface,
						true,
					]);
		}
	});
});

describe("default-selection migration", () => {
	test("nothing stored → defaults, not explicit", () => {
		expect(migrateSelection(undefined)).toEqual({ selection: DEFAULT_SELECTION, explicit: false });
		expect(migrateSelection("junk").explicit).toBe(false);
	});

	test("the pre-Dracula default (never chosen on purpose) moves to Dracula/Alucard", () => {
		const m = migrateSelection({ mode: "system", light: "Atlas Light", dark: "Atlas Dark" });
		expect(m.explicit).toBe(false);
		expect(m.selection).toMatchObject({ light: "Alucard", dark: "Dracula", mode: "system" });
	});

	test("a legacy selection that differs in any field is the user's choice and is kept", () => {
		const m = migrateSelection({ mode: "system", light: "Atlas Light", dark: "One Dark" });
		expect(m).toMatchObject({ explicit: true });
		expect(m.selection).toMatchObject({ dark: "One Dark", light: "Atlas Light" });
		expect(migrateSelection({ mode: "dark", light: "Atlas Light", dark: "Atlas Dark" }).explicit).toBe(true);
	});

	test("a partial legacy selection keeps the old default for the missing slot", () => {
		const m = migrateSelection({ dark: "One Dark" });
		expect(m.explicit).toBe(true);
		expect(m.selection).toMatchObject({ dark: "One Dark", light: "Atlas Light", mode: "system" });
	});

	test("a v2 selection is always explicit, even when it names Atlas", () => {
		const m = migrateSelection({
			v: 2,
			mode: "system",
			light: "Atlas Light",
			dark: "Atlas Dark",
			terminal: "My Terminal Theme",
		});
		expect(m.explicit).toBe(true);
		expect(m.selection).toMatchObject({ dark: "Atlas Dark", terminal: "My Terminal Theme" });
	});

	test("synVar maps dotted roles to dashed vars", () => {
		expect(synVar("variable.parameter")).toBe("--cm-syn-variable-parameter");
	});
});

describe("a stored theme that no longer exists", () => {
	const themes = bundled;
	const sel = (o) => migrateSelection({ v: 2, ...o }).selection;

	test("a missing app theme resolves to the default of that appearance, silently", () => {
		expect(resolveTheme(themes, sel({ mode: "dark", dark: "Some Paid Theme" }), true).name).toBe("Dracula");
		expect(resolveTheme(themes, sel({ mode: "light", light: "Some Paid Theme" }), false).name).toBe(
			"Alucard",
		);
		expect(resolveTheme(themes, sel({ mode: "system", dark: "Gone" }), true).name).toBe("Dracula");
	});

	test("a missing terminal theme means the app theme", () => {
		const app = by("Dracula");
		expect(resolveTerminalTheme(themes, "Some Paid Theme", app)).toBe(app);
		expect(resolveTerminalTheme(themes, "app", app)).toBe(app);
		expect(resolveTerminalTheme(themes, "One Dark", app).name).toBe("One Dark");
	});
});
