// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { ThemeImportError } from "./errors.ts";
import { detectFormat, importAny } from "./detect.ts";
import { exportAtlasJson, exportGhostty } from "./export.ts";
import { parseGhosttyConfig } from "./ghostty.ts";

const theme = {
	name: "Mine",
	appearance: "dark",
	style: {
		"terminal.background": "#101820",
		"terminal.foreground": "#f8f8f2",
		"terminal.cursor": "#f8f8f2",
		"terminal.cursor_text": "#101820",
		"terminal.selection.background": "#304050cc",
		"terminal.ansi.black": "#101820",
		"terminal.ansi.bright_white": "#ffffff",
	},
	font: { family: "Fira Code", size: 14, thicken: true },
};

describe("exportAtlasJson", () => {
	test("valid single-member Zed family, tab indented, atlas.version 1", () => {
		const text = exportAtlasJson(theme);
		expect(text.startsWith('{\n\t"$schema": "https://zed.dev/schema/themes/v0.2.0.json",')).toBe(true);
		const j = JSON.parse(text);
		expect(j.name).toBe("Mine");
		expect(j.author).toBe("exported from Atlas");
		expect(j.themes).toHaveLength(1);
		expect(j.themes[0].atlas).toEqual({ version: 1, font: theme.font });
		expect(j.themes[0].appearance).toBe("dark");
		expect(j.themes[0].style).toEqual(theme.style);
		expect(detectFormat("mine.json", text)).toBe("atlas");
	});

	test("omits font when unknown", () => {
		const j = JSON.parse(exportAtlasJson({ ...theme, font: undefined }));
		expect(j.themes[0].atlas).toEqual({ version: 1 });
	});
});

describe("exportGhostty", () => {
	test("emits known keys, drops alpha, header comment", () => {
		const text = exportGhostty(theme, { cursor_shape: "hollow", blinking: true, padding_x: 8, padding_y: 4 });
		const lines = text.trim().split("\n");
		expect(lines[0]).toBe("# Mine (exported from Atlas)");
		expect(lines).toContain("palette = 0=#101820");
		expect(lines).toContain("palette = 15=#ffffff");
		expect(lines).not.toContain("palette = 1=undefined");
		expect(lines).toContain("selection-background = #304050");
		expect(lines).toContain("font-family = Fira Code");
		expect(lines).toContain("font-size = 14");
		expect(lines).toContain("font-thicken = true");
		expect(lines).toContain("cursor-style = block_hollow");
		expect(lines).toContain("cursor-style-blink = true");
		expect(lines).toContain("window-padding-x = 8");
		expect(lines).toContain("window-padding-y = 4");
	});

	test("round-trips through the Ghostty parser", async () => {
		const ctx = { home: "/h", themeDirs: [], readFile: async () => null };
		const r = await parseGhosttyConfig(exportGhostty(theme, { cursor_shape: "bar" }), ctx);
		expect(r.style["terminal.background"]).toBe("#101820");
		expect(r.style["terminal.ansi.bright_white"]).toBe("#ffffff");
		expect(r.font).toEqual(theme.font);
		expect(r.terminal).toEqual({ cursor_shape: "bar" });
	});
});

describe("detectFormat / importAny", () => {
	const ctx = { home: "/h", themeDirs: [], readFile: async () => null };

	test("detects by extension and content", () => {
		expect(detectFormat("x.itermcolors", "<plist/>")).toBe("iterm");
		expect(
			detectFormat("x", '<?xml version="1.0"?><plist><dict><key>Ansi 0 Color</key></dict></plist>'),
		).toBe("iterm");
		expect(detectFormat("x.yaml", "base00: 000000")).toBe("base16");
		expect(detectFormat("x", "base00: 000000\nbase05: ffffff")).toBe("base16");
		expect(detectFormat("t.json", '{"colors":{}, // c\n}')).toBe("vscode");
		expect(detectFormat("t.json", '{"themes":[{"name":"a","style":{}}]}')).toBe("zed");
		expect(detectFormat("t.json", '{"themes":[{"name":"a","atlas":{"version":1},"style":{}}]}')).toBe(
			"atlas",
		);
		expect(detectFormat("config", "palette = 0=#000000\n")).toBe("ghostty");
		expect(detectFormat("t.json", '{"hello":1}')).toBeNull();
		expect(detectFormat("notes.txt", "hello world")).toBeNull();
	});

	test("dispatches and passes zed/atlas through unconverted", async () => {
		const g = await importAny("config", "background = #000000\n", ctx);
		expect(g.kind).toBe("ghostty");
		expect(g.result.style["terminal.background"]).toBe("#000000");
		const v = await importAny("/x/Cool Theme.json", '{"colors":{"editor.background":"#000000"}}');
		expect(v.kind).toBe("vscode");
		expect(v.result.name).toBe("Cool Theme");
		const z = await importAny("z.json", '{"themes":[]}');
		expect(z).toEqual({ kind: "zed" });
	});

	test("unknown format and ghostty without context throw", async () => {
		await expect(importAny("a.txt", "nothing here")).rejects.toBeInstanceOf(ThemeImportError);
		await expect(importAny("config", "background = #000000")).rejects.toBeInstanceOf(ThemeImportError);
	});
});
