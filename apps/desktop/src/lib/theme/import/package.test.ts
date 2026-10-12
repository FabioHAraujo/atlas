// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { groupKey, scanPackage } from "./package.ts";

const color = (r: number, g: number, b: number) => `<dict>
	<key>Blue Component</key><real>${b}</real>
	<key>Green Component</key><real>${g}</real>
	<key>Red Component</key><real>${r}</real>
</dict>`;

const iterm = (bg: [number, number, number], red: [number, number, number]) => `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>Background Color</key>${color(...bg)}
<key>Foreground Color</key>${color(0.88, 0.94, 1)}
<key>Ansi 1 Color</key>${color(...red)}
<key>Ansi 2 Color</key>${color(0.42, 1, 0.58)}
</dict></plist>`;

const vscode = (name: string, bg: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		name,
		colors: { "editor.background": bg, "editor.foreground": "#e0f0ff" },
		tokenColors: [{ scope: "keyword", settings: { foreground: "#ff6b6b" } }],
		...extra,
	});

const ghostty = (bg: string) => `background = ${bg}
foreground = #e0f0ff
palette = 1=#ff6b6b
palette = 2=#6bff95
palette = 4=#6b9bff
`;

/** Files of an invented package: path -> text. */
function pack(files: Record<string, string>) {
	return {
		files: Object.entries(files).map(([rel, text]) => ({ rel, size: text.length })),
		ctx: { read: async (rel: string) => files[rel] ?? null },
	};
}

describe("groupKey", () => {
	test("strips separators and the generic words only", () => {
		expect(groupKey("Night Owl Test")).toBe("nightowltest");
		expect(groupKey("night-owl-test")).toBe("nightowltest");
		expect(groupKey("Night Owl Test Theme")).toBe("nightowltest");
		expect(groupKey("Night Owl Test Colors")).toBe("nightowltest");
		expect(groupKey("Theme")).toBe("theme");
	});
});

describe("scanPackage", () => {
	test("merges the same variant across vscode, iterm and ghostty", async () => {
		const { files, ctx } = pack({
			"themes/Night Owl Test.json": vscode("Night Owl Test", "#101820"),
			"iterm/Night Owl Test.itermcolors": iterm([0.063, 0.094, 0.125], [1, 0.2, 0.2]),
			"ghostty/night-owl-test": ghostty("#101820"),
			"themes/Dawn Test.json": vscode("Dawn Test", "#faf4e8", { type: "light" }),
			"iterm/Dawn Test.itermcolors": iterm([0.98, 0.96, 0.91], [0.7, 0.2, 0.2]),
			"README.md": "# docs",
			LICENSE: "invented license",
			"preview.png": "x",
		});
		const r = await scanPackage(files, ctx);
		expect(r.warnings).toEqual([]);
		expect(r.themes.map((t) => t.name)).toEqual(["Night Owl Test", "Dawn Test"]);
		const [night, dawn] = r.themes;
		expect(night.appearance).toBe("dark");
		expect(night.format).toBe("vscode");
		expect(night.sources).toEqual([
			"themes/Night Owl Test.json",
			"iterm/Night Owl Test.itermcolors",
			"ghostty/night-owl-test",
		]);
		// VS Code is the base; the ANSI palette is filled in from iTerm (first merged) and Ghostty.
		expect(night.result.style["editor.background"]).toBe("#101820");
		expect(night.result.style["terminal.ansi.red"]).toBe("#ff3333");
		expect(night.result.style["terminal.ansi.blue"]).toBe("#6b9bff");
		expect(night.result.style.syntax.keyword.color).toBe("#ff6b6b");
		expect(night.swatches).toHaveLength(8);
		expect(night.swatches.every((s) => /^#[0-9a-f]{6}$/.test(s))).toBe(true);
		expect(dawn.appearance).toBe("light");
		expect(dawn.sources).toHaveLength(2);
		expect(night.id).not.toBe(dawn.id);
	});

	test("vsix layout: package.json contributes.themes names and classifies themes", async () => {
		const bare = JSON.stringify({
			colors: { "editor.background": "#111122", "editor.foreground": "#eeeeff" },
		});
		const { files, ctx } = pack({
			"extension/package.json": JSON.stringify({
				contributes: {
					themes: [
						{ label: "Dusk Test", uiTheme: "vs-dark", path: "./themes/dusk.json" },
						{ label: "Noon Test", uiTheme: "vs", path: "./themes/noon.json" },
					],
				},
			}),
			"extension/themes/dusk.json": bare,
			// No `type`, a bright background that would be inferred light anyway: uiTheme must win.
			"extension/themes/noon.json": JSON.stringify({ colors: { "editor.background": "#202020" } }),
			"extension/extension.vsixmanifest": "<xml/>",
			"extension/readme.md": "x",
		});
		const r = await scanPackage(files, ctx);
		expect(r.warnings).toEqual([]);
		expect(r.themes.map((t) => [t.name, t.appearance])).toEqual([
			["Dusk Test", "dark"],
			["Noon Test", "light"],
		]);
	});

	test("alacritty toml and yml are found and merge with the vscode variant by name", async () => {
		const toml = `[colors.primary]\nbackground = "#101820"\nforeground = "#e0f0ff"\n[colors.normal]\nred = "#ff6b6b"\ncyan = "#6bf0ff"\n`;
		const yml = `colors:\n  primary:\n    background: '0xfaf4e8'\n    foreground: '#2a2418'\n  normal:\n    red: '#b03030'\n`;
		const { files, ctx } = pack({
			"alacritty/dusk-test.toml": toml,
			"alacritty/dawn-test.yml": yml,
			"vscode/Dusk Test.json": vscode("Dusk Test", "#101820"),
			"alacritty/config.toml": `[font]\nsize = 12\n`,
		});
		const r = await scanPackage(files, ctx);
		expect(r.warnings).toEqual([]);
		expect(r.skipped).toEqual([]);
		const dusk = r.themes.find((t) => t.name === "Dusk Test");
		expect(dusk.sources).toEqual(["vscode/Dusk Test.json", "alacritty/dusk-test.toml"]);
		expect(dusk.result.style["terminal.ansi.cyan"]).toBe("#6bf0ff");
		const dawn = r.themes.find((t) => t.appearance === "light");
		expect(dawn.format).toBe("alacritty");
		expect(dawn.name).toBe("dawn-test");
		expect(dawn.result.style["terminal.background"]).toBe("#faf4e8");
		expect(r.themes).toHaveLength(2);
	});

	test("base16 yaml and zed/atlas family json are included", async () => {
		const base16 = Array.from(
			{ length: 16 },
			(_, i) => `base0${i.toString(16).toUpperCase()}: "${(0x112233 + i * 0x101010).toString(16)}"`,
		).join("\n");
		const family = JSON.stringify({
			name: "Fam",
			themes: [{ name: "Family Dark", appearance: "dark", style: { "terminal.background": "#101820" } }],
		});
		const { files, ctx } = pack({
			"b16/ember-test.yaml": `scheme: "Ember Test"\n${base16}\n`,
			"zed/fam.json": family,
		});
		const r = await scanPackage(files, ctx);
		expect(r.warnings).toEqual([]);
		expect(r.themes.map((t) => [t.name, t.format]).sort()).toEqual([
			["Ember Test", "base16"],
			["Family Dark", "zed"],
		]);
	});

	test("a non-theme file is ignored silently; a broken theme is reported, never thrown", async () => {
		const { files, ctx } = pack({
			"tsconfig.json": JSON.stringify({ compilerOptions: {} }),
			"notes/data.yml": "just: data\n",
			"themes/Broken.json": `{ "colors": { "editor.background": "#10`,
			"themes/Empty.json": JSON.stringify({ colors: {} }),
			"themes/Good Test.json": vscode("Good Test", "#101820"),
		});
		files.push({ rel: "themes/Missing.json", size: 10 });
		const r = await scanPackage(files, ctx);
		expect(r.themes.map((t) => t.name)).toEqual(["Good Test"]);
		expect(r.skipped.sort()).toEqual(["themes/Broken.json", "themes/Empty.json", "themes/Missing.json"]);
		expect(r.warnings).toHaveLength(3);
		expect(r.warnings.some((w) => w.startsWith("themes/Broken.json:"))).toBe(true);
		expect(r.warnings).toContain("themes/Missing.json: could not be read");
	});

	test("duplicate names across folders collapse; light/dark inferred; dark sorts first", async () => {
		const { files, ctx } = pack({
			"a/Zeta Test.json": vscode("Zeta Test", "#101820"),
			"b/Zeta Test.json": vscode("Zeta Test", "#101820"),
			"b/Zeta Test.itermcolors": iterm([0.063, 0.094, 0.125], [1, 0.2, 0.2]),
			"a/Alpha Test.json": vscode("Alpha Test", "#f8f8f0"),
			"a/Beta Test.json": vscode("Beta Test", "#102030"),
			"__MACOSX/a/._Beta Test.json": "garbage",
		});
		const r = await scanPackage(files, ctx);
		expect(r.themes.map((t) => [t.name, t.appearance])).toEqual([
			["Beta Test", "dark"],
			["Zeta Test", "dark"],
			["Alpha Test", "light"],
		]);
		expect(r.themes[1].sources).toHaveLength(3);
		expect(r.warnings).toEqual([]);
	});
});

describe("variants that share a name but not an appearance", () => {
	test("a dark and a light 'Twilight Test' are two themes; terminals are never mixed across them", async () => {
		const { files, ctx } = pack({
			"themes/Twilight Test.json": vscode("Twilight Test", "#101820"),
			"light/Twilight Test.itermcolors": iterm([0.98, 0.96, 0.91], [0.7, 0.2, 0.2]),
		});
		const r = await scanPackage(files, ctx);
		expect(r.themes.map((t) => [t.name, t.appearance, t.sources.length])).toEqual([
			["Twilight Test", "dark", 1],
			["Twilight Test", "light", 1],
		]);
		const dark = r.themes[0];
		expect(dark.result.style["terminal.ansi.red"]).toBeUndefined();
		expect(new Set(r.themes.map((t) => t.id)).size).toBe(2);
	});
});
