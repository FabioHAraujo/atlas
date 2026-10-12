// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { flatRows, navKey } from "./rows.ts";

const hit = (line) => ({ line, start: 0, end: 1, text: "x" });
const files = [
	{ path: "a.ts", matches: [hit(1), hit(2)] },
	{ path: "b.ts", matches: [hit(3)] },
];
// rows: 0 a.ts, 1 a:1, 2 a:2, 3 b.ts, 4 b:3
const rows = flatRows(files, {});

describe("navKey", () => {
	test("up/down move; up from the top leaves to the query field", () => {
		expect(navKey("ArrowDown", rows, 1)).toEqual({ type: "move", to: 2 });
		expect(navKey("ArrowUp", rows, 2)).toEqual({ type: "move", to: 1 });
		expect(navKey("ArrowUp", rows, 0)).toEqual({ type: "leave" });
	});
	test("left/right fold a file row", () => {
		expect(navKey("ArrowLeft", rows, 0)).toEqual({ type: "fold", path: "a.ts", collapsed: true });
		expect(navKey("ArrowRight", rows, 3)).toEqual({ type: "fold", path: "b.ts", collapsed: false });
	});
	test("left on a match jumps to its file; right on a match is swallowed", () => {
		expect(navKey("ArrowLeft", rows, 2)).toEqual({ type: "move", to: 0 });
		expect(navKey("ArrowLeft", rows, 4)).toEqual({ type: "move", to: 3 });
		expect(navKey("ArrowRight", rows, 2)).toEqual({ type: "swallow" });
	});
	test("Enter opens; other keys are ignored", () => {
		expect(navKey("Enter", rows, 0)).toEqual({ type: "open" });
		expect(navKey("x", rows, 0)).toBeNull();
	});
});
