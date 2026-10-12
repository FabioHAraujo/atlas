// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { ThemeImportError } from "./errors.ts";
import { parseVscodeTheme } from "./vscode.ts";

const THEME = `{
	// JSONC comment
	"name": "Night Owl-ish",
	"type": "dark",
	/* block */
	"colors": {
		"editor.background": "#011627",
		"editor.foreground": "#D6DEEB",
		"editorCursor.foreground": "#80A4C2",
		"editor.selectionBackground": "#1D3B53",
		"editorLineNumber.foreground": "#4B6479",
		"sideBar.background": "#010E1A",
		"activityBar.background": "#010E1A",
		"titleBar.activeBackground": "#FF0000",
		"terminal.ansiBlack": "#011627",
		"terminal.ansiBrightWhite": "#FFFFFF",
		"terminal.ansiRed": "not-a-color",
		"focusBorder": "#5F7E97",
		"errorForeground": "#EF5350",
		"editorError.foreground": "#FF2222",
	},
	"tokenColors": [
		{ "include": "./other.json" },
		{ "scope": "comment", "settings": { "foreground": "#637777", "fontStyle": "italic" } },
		{ "scope": ["string", "constant.other.symbol"], "settings": { "foreground": "#ECC48D" } },
		{ "scope": "string.regexp", "settings": { "foreground": "#5CA7E4" } },
		{ "scope": "keyword, storage.type", "settings": { "foreground": "#C792EA", "fontStyle": "bold italic" } },
		{ "scope": "entity.name.function", "settings": { "foreground": "#82AAFF" } },
		{ "scope": "keyword.operator", "settings": { "foreground": "#7FDBCA" } },
		{ "scope": "weird.unmapped", "settings": { "foreground": "#123456" } },
	],
}`;

describe("parseVscodeTheme", () => {
	const r = parseVscodeTheme(THEME);

	test("name, appearance, UI and terminal colors", () => {
		expect(r.name).toBe("Night Owl-ish");
		expect(r.appearance).toBe("dark");
		expect(r.style["editor.background"]).toBe("#011627");
		expect(r.style.text).toBe("#d6deeb");
		expect(r.style.players[0]).toEqual({ cursor: "#80a4c2", selection: "#1d3b53" });
		expect(r.style["editor.line_number"]).toBe("#4b6479");
		expect(r.style["surface.background"]).toBe("#010e1a");
		// activityBar wins over titleBar for `background`.
		expect(r.style.background).toBe("#010e1a");
		expect(r.style["terminal.ansi.black"]).toBe("#011627");
		expect(r.style["terminal.ansi.bright_white"]).toBe("#ffffff");
		expect(r.style["terminal.ansi.red"]).toBeUndefined();
		expect(r.style["border.focused"]).toBe("#5f7e97");
		// editorError.foreground wins over errorForeground.
		expect(r.style.error).toBe("#ff2222");
	});

	test("syntax roles, longest scope wins, fontStyle", () => {
		expect(r.style.syntax.comment).toEqual({ color: "#637777", font_style: "italic", font_weight: null });
		expect(r.style.syntax.string).toEqual({ color: "#ecc48d", font_style: null, font_weight: null });
		expect(r.style.syntax["string.regex"].color).toBe("#5ca7e4");
		expect(r.style.syntax.keyword).toEqual({ color: "#c792ea", font_style: "italic", font_weight: 700 });
		expect(r.style.syntax.function.color).toBe("#82aaff");
		// `keyword.operator` is more specific than `keyword`.
		expect(r.style.syntax.operator.color).toBe("#7fdbca");
		expect(Object.values(r.style.syntax).some((s) => s.color === "#123456")).toBe(false);
	});

	test("warnings: include and bad color", () => {
		expect(r.warnings).toContain("tokenColors include ignored: ./other.json");
		expect(r.warnings.some((w) => w.includes("terminal.ansiRed"))).toBe(true);
	});

	test("type light / hc / missing, fallback name", () => {
		const base = '{"colors":{"editor.background":"#ffffff"}';
		expect(parseVscodeTheme(`${base},"type":"light"}`).appearance).toBe("light");
		expect(parseVscodeTheme(`${base},"type":"hc"}`).appearance).toBe("dark");
		const inferred = parseVscodeTheme(`${base}}`, "Fallback");
		expect(inferred.appearance).toBe("light");
		expect(inferred.name).toBe("Fallback");
	});

	test("invalid input throws", () => {
		expect(() => parseVscodeTheme("{nope")).toThrow(ThemeImportError);
		expect(() => parseVscodeTheme("[]")).toThrow(ThemeImportError);
		expect(() => parseVscodeTheme('{"colors":{}}')).toThrow(ThemeImportError);
	});

	test("comment markers inside strings survive", () => {
		const t = parseVscodeTheme('{"name":"a // b","colors":{"editor.background":"#000000"}}');
		expect(t.name).toBe("a // b");
	});
});
