// Shared helpers for the importers: color normalization, luminance and the ImportResult shape.

export interface ImportResult {
	name: string;
	appearance: "dark" | "light";
	style: Record<string, unknown>;
	font?: { family?: string; size?: number; thicken?: boolean };
	terminal?: {
		cursor_shape?: "block" | "bar" | "underline" | "hollow";
		blinking?: boolean;
		padding_x?: number;
		padding_y?: number;
		copy_on_select?: boolean;
		option_as_alt?: "both" | "left" | "right" | "none";
	};
	warnings: string[];
}

export const ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** Style keys `terminal.ansi.*` in palette order 0..15. */
export const ANSI_KEYS: string[] = [
	...ANSI_NAMES.map((n) => `terminal.ansi.${n}`),
	...ANSI_NAMES.map((n) => `terminal.ansi.bright_${n}`),
];

/** Minimal X11 / CSS common color set (as used by Ghostty configs). */
const NAMED: Record<string, string> = {
	black: "#000000",
	white: "#ffffff",
	red: "#ff0000",
	green: "#00ff00",
	blue: "#0000ff",
	yellow: "#ffff00",
	cyan: "#00ffff",
	aqua: "#00ffff",
	magenta: "#ff00ff",
	fuchsia: "#ff00ff",
	gray: "#bebebe",
	grey: "#bebebe",
	darkgray: "#a9a9a9",
	darkgrey: "#a9a9a9",
	lightgray: "#d3d3d3",
	lightgrey: "#d3d3d3",
	dimgray: "#696969",
	dimgrey: "#696969",
	orange: "#ffa500",
	purple: "#a020f0",
	pink: "#ffc0cb",
	brown: "#a52a2a",
	maroon: "#b03060",
	navy: "#000080",
	teal: "#008080",
	olive: "#808000",
	lime: "#00ff00",
	silver: "#c0c0c0",
	gold: "#ffd700",
	violet: "#ee82ee",
	indigo: "#4b0082",
	coral: "#ff7f50",
	salmon: "#fa8072",
	tomato: "#ff6347",
	crimson: "#dc143c",
	turquoise: "#40e0d0",
	skyblue: "#87ceeb",
	royalblue: "#4169e1",
	darkblue: "#00008b",
	darkgreen: "#006400",
	darkred: "#8b0000",
	darkcyan: "#008b8b",
	darkmagenta: "#8b008b",
	lightblue: "#add8e6",
	lightgreen: "#90ee90",
	lightyellow: "#ffffe0",
	lightcyan: "#e0ffff",
	lightpink: "#ffb6c1",
	forestgreen: "#228b22",
	firebrick: "#b22222",
	slategray: "#708090",
	slategrey: "#708090",
	beige: "#f5f5dc",
	ivory: "#fffff0",
	khaki: "#f0e68c",
	tan: "#d2b48c",
};

/** `#rgb`, `#rrggbb`, `#rrggbbaa` (with or without `#`) or a named color -> lowercase `#rrggbb[aa]`, else null. */
export function normalizeColor(raw: string, allowNames = false): string | null {
	const v = raw
		.trim()
		.replace(/^["']|["']$/g, "")
		.trim();
	const hex = v.startsWith("#") ? v.slice(1) : v;
	if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return `#${hex.toLowerCase()}`;
	if (/^[0-9a-fA-F]{3}$/.test(hex) && v.startsWith("#")) {
		return `#${[...hex]
			.map((c) => c + c)
			.join("")
			.toLowerCase()}`;
	}
	if (allowNames) {
		const n = NAMED[v.toLowerCase().replace(/[\s_-]+/g, "")];
		if (n) return n;
	}
	return null;
}

/** Floats 0-1 sRGB -> `#rrggbb`. */
export function rgbFloatToHex(r: number, g: number, b: number): string {
	const h = (x: number) =>
		Math.round(Math.min(1, Math.max(0, x)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance of `#rrggbb[aa]` (0..1). */
export function luminance(hex: string): number {
	const lin = (i: number) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}

export function appearanceOf(bg: string | undefined, fallback: "dark" | "light" = "dark"): "dark" | "light" {
	if (!bg) return fallback;
	return luminance(bg) < 0.4 ? "dark" : "light";
}

export interface SyntaxEntry {
	color?: string;
	font_style?: "italic" | null;
	font_weight?: number | null;
}

/** Writes `style.syntax[role]`, merging with an existing entry. */
export function putSyntax(style: Record<string, unknown>, role: string, entry: SyntaxEntry): void {
	const syntax = (style.syntax ??= {}) as Record<string, SyntaxEntry>;
	syntax[role] = { ...syntax[role], ...entry };
}

/** Writes `style.players[0][key]`. */
export function putPlayer(style: Record<string, unknown>, key: "cursor" | "selection", value: string): void {
	const players = (style.players ??= [{}]) as Record<string, string>[];
	players[0] = { ...players[0], [key]: value };
}
