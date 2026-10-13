// @ts-nocheck bun test runtime types are not part of the app tsconfig
// Incident (contrast audit): the menu-bar popover's "dev" chip painted `color: #b45309` on `rgb(245 158 11 / .18)`
// whatever the theme: ~4.0:1 on a light popover and unreadable on a dark one. A text colour that is not a theme token
// cannot be guaranteed by `derive.ts`; every `color:` in the app's own CSS must come from a token (`var(--…)`,
// `currentColor`, `inherit`, a `color-mix()` of tokens). Backgrounds/gradients of brand art are exempt.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");
const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory()
			? f === "icon-data"
				? []
				: files(p)
			: /\.(svelte|css)$/.test(f)
				? [p]
				: [];
	});

test("no `color:` declaration paints a raw hex/rgb/hsl/named colour: text colours come from theme tokens", () => {
	const bad: string[] = [];
	for (const f of files(SRC))
		readFileSync(f, "utf8")
			.split("\n")
			.forEach((line, i) => {
				const m = /(?:^|[\s;{"'])color\s*:\s*([^;}"']+)/.exec(line);
				if (!m) return;
				const v = m[1].trim();
				if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|white\b|black\b)/i.test(v))
					bad.push(`${f.slice(SRC.length + 1)}:${i + 1}  color: ${v}`);
			});
	expect(bad).toEqual([]);
});

// Incident (audit): `.tag.ok` ("In Atlas") set `color: var(--dot-ok)` on its own 14% tint: 4.14:1. `--dot-*` are the
// INDICATOR colours (dots, rings, bars: 3:1 against the fills next to them); text takes `--ca-semantic-*` (4.5, also on
// its own 10/14% tint: theme/derive.ts).
test("no `color:` reads a `--dot-*` indicator colour: text uses the --ca-semantic-* tokens", () => {
	const bad: string[] = [];
	for (const f of files(SRC))
		readFileSync(f, "utf8")
			.split("\n")
			.forEach((line, i) => {
				if (/(?:^|[\s;{])color\s*:\s*var\(--dot-/.test(line))
					bad.push(`${f.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`);
			});
	expect(bad).toEqual([]);
});
