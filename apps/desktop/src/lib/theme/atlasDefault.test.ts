// @ts-nocheck bun test runtime types are not part of the app tsconfig
/**
 * Atlas Dark / Atlas Light are the default family, built from the maintainer's Ghostty "Tokyo Night" custom palette
 * (ghostty-tokyo-night-custom.json). The palette is the single source: chrome, editor syntax and the terminal's 16 ANSI
 * colours are all read from `themes/atlas.json`, and the GPU terminal gets exactly that table.
 */
import { describe, expect, test } from "bun:test";
import atlas from "../themes/atlas.json";
import dracula from "../themes/dracula.json";
import one from "../themes/one.json";
import { ansi16, cssVars, syntaxTokens, terminalColors } from "../theme.ts";
import { contrast, toOklch } from "./color.ts";
import { codeSurfaces, complete } from "./derive.ts";
import { DEFAULT_SELECTION, migrateSelection, parseFamily, resolveTheme } from "./schema.ts";

const themes = [atlas, dracula, one].flatMap((f) => parseFamily(f).themes);
const by = (n) => themes.find((t) => t.name === n);
const dark = by("Atlas Dark");
const light = by("Atlas Light");

/** The user's Ghostty palette, normal black..white then bright black..white. */
const TOKYO_ANSI = [
	"#15161e",
	"#f7768e",
	"#9ece6a",
	"#e0af68",
	"#7aa2f7",
	"#bb9af7",
	"#7dcfff",
	"#a9b1d6",
	"#414868",
	"#f7768e",
	"#9ece6a",
	"#e0af68",
	"#7aa2f7",
	"#bb9af7",
	"#7dcfff",
	"#c0caf5",
];

describe("the default selection is Atlas Dark / Atlas Light", () => {
	test("nothing stored → system mode, Atlas Light by day, Atlas Dark by night", () => {
		expect(DEFAULT_SELECTION).toEqual({
			v: 2,
			mode: "system",
			light: "Atlas Light",
			dark: "Atlas Dark",
			terminal: "app",
		});
		expect(migrateSelection(undefined)).toEqual({ selection: DEFAULT_SELECTION, explicit: false });
		expect(resolveTheme(themes, DEFAULT_SELECTION, true).name).toBe("Atlas Dark");
		expect(resolveTheme(themes, DEFAULT_SELECTION, false).name).toBe("Atlas Light");
	});

	test("a missing theme falls back to the new default of that appearance", () => {
		const sel = (o) => migrateSelection({ v: 2, ...o }).selection;
		expect(resolveTheme(themes, sel({ mode: "dark", dark: "Some Paid Theme" }), true).name).toBe(
			"Atlas Dark",
		);
		expect(resolveTheme(themes, sel({ mode: "light", light: "Gone" }), false).name).toBe("Atlas Light");
	});

	// Incident guard: the default moved from Dracula/Alucard back to Atlas. Whoever picked Dracula on purpose keeps it.
	test("a user who explicitly chose Dracula/Alucard stays on them", () => {
		const m = migrateSelection({ v: 2, mode: "system", light: "Alucard", dark: "Dracula", terminal: "app" });
		expect(m.explicit).toBe(true);
		expect(m.selection).toMatchObject({ light: "Alucard", dark: "Dracula" });
		expect(resolveTheme(themes, m.selection, true).name).toBe("Dracula");
		expect(resolveTheme(themes, m.selection, false).name).toBe("Alucard");
		const half = migrateSelection({ v: 2, dark: "Dracula" });
		expect(half.selection).toMatchObject({ dark: "Dracula", light: "Atlas Light" });
	});

	test("a pre-v2 file that named exactly the old Atlas default was never a choice", () => {
		const m = migrateSelection({ mode: "system", light: "Atlas Light", dark: "Atlas Dark" });
		expect(m).toEqual({ selection: DEFAULT_SELECTION, explicit: false });
	});
});

describe("Atlas Dark is the Tokyo Night custom palette", () => {
	const s = dark.style;

	test("terminal: background, foreground, cursor, selection and the 16 ANSI colours are the Ghostty values", () => {
		expect(s["terminal.background"]).toBe("#131c2b");
		expect(s["terminal.foreground"]).toBe("#c0caf5");
		expect(s["terminal.cursor"]).toBe("#c0caf5");
		expect(s["terminal.cursor_text"]).toBe("#131c2b");
		expect(s["terminal.selection.background"]).toBe("#243a61");
		expect(s["terminal.selection.foreground"]).toBe("#c0caf5");
		expect(ansi16(s)).toEqual(TOKYO_ANSI);
	});

	test("what the GPU terminal receives (terminalColors) is that exact table, not a fallback", () => {
		const t = terminalColors(complete(s, "dark"));
		expect(t.ansi16).toEqual(TOKYO_ANSI);
		expect(t.ansi16.every((c) => c !== null)).toBe(true);
		expect(t.bg).toBe("#131c2b");
		expect(t.fg).toBe("#c0caf5");
		expect(t.cursor).toBe("#c0caf5");
		expect(t.selectionBg).toBe("#243a61");
	});

	test("service logs share it: --ansi-* vars carry the same 16 colours", () => {
		const v = cssVars(complete(s, "dark"));
		const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
		const vars = [...names, ...names.map((n) => `bright-${n}`)].map((n) => v[`--ansi-${n}`]);
		expect(vars).toEqual(TOKYO_ANSI);
	});

	test("chrome: three surfaces step up from the editor, accent is Tokyo blue", () => {
		expect(s["editor.background"]).toBe("#131c2b");
		expect(s.background).toBe("#0b1320");
		expect(s["surface.background"]).toBe("#1d2637");
		expect(s["elevated_surface.background"]).toBe("#273143");
		expect(s.text).toBe("#c0caf5");
		expect(s["border.selected"]).toBe("#7aa2f7");
		expect(s.players[0]).toEqual({ cursor: "#7aa2f7", selection: "#7aa2f747" });
		// sunken < editor < raised < overlay, strictly, by lightness
		const l = ["background", "editor.background", "surface.background", "elevated_surface.background"].map(
			(k) => toOklch(s[k]).l,
		);
		expect(l).toEqual([...l].sort((a, b) => a - b));
		expect(new Set(l).size).toBe(4);
	});

	// Dracula's rule: a role keeps ONE hue everywhere (keyword purple, function green, string amber, type cyan, constant
	// orange). The hues are the Ghostty palette's; lightness is fitted so the colour that ships is the colour that renders.
	test("editor syntax: one Tokyo hue per role, and the app applies exactly what the file ships", () => {
		const applied = syntaxTokens(complete(s, "dark"));
		const hueOf = (hex) => toOklch(hex).h;
		const near = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) < 12;
		const want = {
			keyword: "#bb9af7",
			function: "#9ece6a",
			type: "#7dcfff",
			string: "#e0af68",
			constant: "#f49168",
		};
		for (const [role, hex] of Object.entries(want))
			expect([role, near(hueOf(applied[role].color), hueOf(hex))]).toEqual([role, true]);
		for (const [role, v] of Object.entries(s.syntax))
			expect([role, applied[role].color]).toEqual([role, v.color]);
		expect(applied.comment.italic).toBe(true);
		expect(applied.keyword.color).toBe(applied.tag.color);
		expect(applied.type.color).toBe(applied.namespace.color);
		expect(applied.string.color).toBe(applied.regex?.color ?? applied.string.color);
	});

	// OLED: no pure black or near-black ground (smear/crush on scroll); IPS: enough luminance between levels that the
	// blue never reads grey; sRGB-safe chroma so nothing clips or shifts on a P3 panel; foreground below pure white.
	test("display design: blue hue ~262, 3-5% OKLCH lightness steps, low chroma on large areas, soft foreground", () => {
		const rungs = [
			"background",
			"editor.background",
			"surface.background",
			"elevated_surface.background",
		].map((k) => toOklch(s[k]));
		expect(rungs[0].l).toBeGreaterThan(0.17);
		for (const r of rungs) {
			expect(Math.abs(r.h - 262)).toBeLessThan(5);
			expect(r.c).toBeLessThan(0.04);
			expect(r.c).toBeGreaterThan(0.025);
		}
		for (let i = 1; i < rungs.length; i++) {
			const step = rungs[i].l - rungs[i - 1].l;
			expect([i, step >= 0.03 && step <= 0.05]).toEqual([i, true]);
		}
		const fg = toOklch(s.text);
		expect(fg.l).toBeLessThan(0.9);
		expect(fg.l).toBeGreaterThan(0.8);
		// accents share perceived lightness (L 0.75-0.80) and stay inside sRGB (round-trip keeps their chroma)
		for (const k of ["created", "warning", "info", "error"]) {
			const o = toOklch(s[k]);
			expect([k, o.l >= 0.74 && o.l <= 0.81, o.c <= 0.15]).toEqual([k, true, true]);
		}
	});

	test("Atlas Dark is not the old neutral grey: no leftover of the previous palette", () => {
		const json = JSON.stringify(dark.style).toLowerCase();
		for (const old of [
			"#0a0b0e",
			"#040507",
			"#e9ebef",
			"#2b80ff",
			"#cc6666",
			"#b5bd68",
			"#1a1b26",
			"#11121c",
		])
			expect(json).not.toContain(old);
	});
});

describe("Atlas Light is the matching Tokyo Night Day counterpart", () => {
	const s = light.style;

	test("same family: paired appearance, full 16-colour table, hues follow the dark ANSI hues", () => {
		expect(light.appearance).toBe("light");
		expect(light.family).toBe(dark.family);
		const a = ansi16(s);
		expect(a.every((c) => c !== null)).toBe(true);
		// slot by slot the hue stays within 30° of the dark theme's (red/green/yellow/blue/magenta/cyan)
		for (const i of [1, 2, 3, 4, 5, 6]) {
			const d = Math.abs(toOklch(a[i]).h - toOklch(TOKYO_ANSI[i]).h);
			expect([i, Math.min(d, 360 - d) < 30]).toEqual([i, true]);
		}
	});

	// Tokyo Night Day's own #3760bf reads 3.99:1 on its sunken chrome, so the terminal keeps the Day foreground
	// (4.52 on the Day ground) while the UI text is the deeper navy of the same hue.
	test("Tokyo Night Day ground: Day editor/terminal, Day foreground in the terminal, deeper navy UI text", () => {
		expect(s["editor.background"]).toBe("#e1e2e7");
		expect(s["terminal.background"]).toBe("#e1e2e7");
		expect(s["terminal.foreground"]).toBe("#3760bf");
		expect(contrast(s["terminal.foreground"], s["terminal.background"])).toBeGreaterThanOrEqual(4.5);
		expect(s.text).toBe("#273469");
	});

	test("every ANSI colour stays AA-readable as text on the terminal background", () => {
		const bg = s["terminal.background"];
		// the terminal's own minimum-contrast rule lifts the rest; the table itself must be near AA
		for (const [i, c] of ansi16(s).entries())
			if (i !== 0 && i !== 8 && i !== 7) expect([i, contrast(c, bg) >= 3]).toEqual([i, true]);
	});
});

describe("both themes pass WCAG AA where the theme guarantees it", () => {
	for (const t of [dark, light]) {
		test(`${t.name}: text tokens and every syntax role on every code surface`, () => {
			const c = complete(t.style, t.appearance);
			const rgb = (h) => h.slice(0, 7);
			const fails = [];
			for (const surf of [
				"background",
				"editor.background",
				"surface.background",
				"elevated_surface.background",
			])
				for (const k of ["text", "text.muted", "text.accent", "created", "warning", "info", "error"])
					if (contrast(rgb(c[k]), rgb(c[surf])) < 4.5) fails.push(`${k} on ${surf}`);
			const tokens = syntaxTokens(c);
			for (const [role, tok] of Object.entries(tokens))
				for (const surf of codeSurfaces(c))
					if (tok.color && contrast(tok.color, surf) < 4.5) fails.push(`syntax ${role} on ${surf}`);
			expect(fails).toEqual([]);
		});
	}
});
