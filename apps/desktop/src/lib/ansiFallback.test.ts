// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import atlas from "./themes/atlas.json";
import { ANSI_VARS } from "./ansi.ts";
import { ansi16 } from "./theme.ts";

// The `.dark` block of app.css is what service logs paint with before the theme store writes the active theme's
// palette (first paint, a theme with no palette). It is Atlas Dark's table, not a third copy of some other dark theme.
test("app.css .dark --ansi-* fallbacks are exactly Atlas Dark's 16 colours", () => {
	const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
	const block = css.slice(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));
	const fallback = ANSI_VARS.map((v) =>
		block.match(new RegExp(`${v}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase(),
	);
	expect(fallback).toEqual(ansi16(atlas.themes.find((t) => t.name === "Atlas Dark").style));
});
