// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARK, MARK_VIEW } from "./mark.ts";

const svg = readFileSync(join(import.meta.dir, "../../../../../../assets/logo.svg"), "utf8");

// Incident-in-waiting: mark.ts is generated from the logo by `bun run icons` (scripts/icons.ts). If the logo is redrawn
// and the generator is not re-run, the intro would animate the OLD mark. This pins the generated data to the real file.
test("the generated tiles are exactly the paths of assets/logo.svg, in order, with its viewBox", () => {
	const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
	expect(MARK.length).toBe(paths.length);
	MARK.forEach((m, i) => {
		expect(m.id).toBe(i);
		expect(m.d).toBe(paths[i]);
	});
	const v = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
	expect([MARK_VIEW.w, MARK_VIEW.h]).toEqual([Number(v[1]), Number(v[2])]);
});

test("every bounding box lies inside the viewBox", () => {
	for (const m of MARK) {
		expect(m.cx - m.w / 2).toBeGreaterThanOrEqual(-1);
		expect(m.cx + m.w / 2).toBeLessThanOrEqual(MARK_VIEW.w + 1);
		expect(m.cy - m.h / 2).toBeGreaterThanOrEqual(-1);
		expect(m.cy + m.h / 2).toBeLessThanOrEqual(MARK_VIEW.h + 1);
	}
});
