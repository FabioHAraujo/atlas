import { ANSI_KEYS, type ImportResult } from "./color.ts";

interface ExportTheme {
	name: string;
	appearance: "dark" | "light";
	style: Record<string, unknown>;
	font?: ImportResult["font"];
}

/** Single-member Zed theme family JSON with `atlas.version: 1`, tab-indented like the bundled themes. */
export function exportAtlasJson(theme: ExportTheme): string {
	const atlas: Record<string, unknown> = { version: 1 };
	if (theme.font && Object.keys(theme.font).length) atlas.font = theme.font;
	const family = {
		$schema: "https://zed.dev/schema/themes/v0.2.0.json",
		name: theme.name,
		author: "exported from Atlas",
		themes: [{ name: theme.name, appearance: theme.appearance, atlas, style: theme.style }],
	};
	return `${JSON.stringify(family, null, "\t")}\n`;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** `#rrggbbaa` -> `#rrggbb`: Ghostty colors have no alpha. */
const rgb = (v: string) => v.slice(0, 7);

/** Round-trippable Ghostty `key = value` config. */
export function exportGhostty(theme: ExportTheme, terminal?: ImportResult["terminal"]): string {
	const lines = [`# ${theme.name.replace(/[\r\n]+/g, " ")} (exported from Atlas)`];
	ANSI_KEYS.forEach((key, i) => {
		const c = str(theme.style[key]);
		if (c) lines.push(`palette = ${i}=${rgb(c)}`);
	});
	const colors: [string, string][] = [
		["background", "terminal.background"],
		["foreground", "terminal.foreground"],
		["cursor-color", "terminal.cursor"],
		["cursor-text", "terminal.cursor_text"],
		["selection-background", "terminal.selection.background"],
		["selection-foreground", "terminal.selection.foreground"],
	];
	for (const [key, styleKey] of colors) {
		const c = str(theme.style[styleKey]);
		if (c) lines.push(`${key} = ${rgb(c)}`);
	}
	const { font } = theme;
	if (font?.family) lines.push(`font-family = ${font.family}`);
	if (font?.size !== undefined) lines.push(`font-size = ${font.size}`);
	if (font?.thicken !== undefined) lines.push(`font-thicken = ${font.thicken}`);
	if (terminal?.cursor_shape) {
		const shape = terminal.cursor_shape === "hollow" ? "block_hollow" : terminal.cursor_shape;
		lines.push(`cursor-style = ${shape}`);
	}
	if (terminal?.blinking !== undefined) lines.push(`cursor-style-blink = ${terminal.blinking}`);
	if (terminal?.padding_x !== undefined) lines.push(`window-padding-x = ${terminal.padding_x}`);
	if (terminal?.padding_y !== undefined) lines.push(`window-padding-y = ${terminal.padding_y}`);
	return `${lines.join("\n")}\n`;
}
