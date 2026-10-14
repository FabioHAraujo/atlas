// @ts-nocheck bun test runtime types are not part of the app tsconfig
/**
 * Incident (Settings ▸ Editor ▸ Languages): `<Spinner size="sm" />` filled the whole dialog with one giant arc while the
 * language servers loaded. The kit's Spinner takes a number or a CSS length (`size={12}`, `"1rem"`) and writes it into
 * `width`/`height`; a size *name* such as "sm" is invalid CSS, so the SVG falls back to the size of its container.
 * This reads the real Settings sources, so a size name anywhere in them goes red.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lib = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["settings", "components/settings"].map((d) => join(lib, d));
const files = [
	...dirs.flatMap((d) =>
		readdirSync(d)
			.filter((f) => f.endsWith(".svelte"))
			.map((f) => join(d, f)),
	),
	join(lib, "components/ShellSettings.svelte"),
	join(lib, "components/SshSettings.svelte"),
];

/** A CSS length the Spinner can use: a number in braces, or a quoted value that starts with a digit. */
const OK = /^(\{\s*\d+(\.\d+)?\s*\}|"\d[^"]*"|\{\s*"\d[^"]*"\s*\})$/;

describe("Spinner sizes in Settings are numbers or CSS lengths, never size names", () => {
	test("there are Settings sources to check", () => {
		expect(files.length).toBeGreaterThan(10);
	});
	for (const f of files) {
		test(f.slice(lib.length + 1), () => {
			for (const m of readFileSync(f, "utf8").matchAll(/<Spinner\b[^>]*?\bsize=("[^"]*"|\{[^}]*\})/g)) {
				expect(OK.test(m[1]!), `<Spinner size=${m[1]}> is not a number or a CSS length`).toBe(true);
			}
		});
	}
});
