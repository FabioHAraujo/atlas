// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { clampRatio, leaves, removeLeaf, splitAt, splitLeaf } from "./layout.ts";

const leaf = (group) => ({ type: "leaf", group });

test("splitLeaf puts the new group second and leaves() lists visual order", () => {
	const l = splitLeaf(splitLeaf(leaf("a"), "a", "b", "h"), "b", "c", "v");
	expect(leaves(l)).toEqual(["a", "b", "c"]);
	expect(l.dir).toBe("h");
	expect(l.second.dir).toBe("v");
	expect(l.ratio).toBe(0.5);
});

test("removeLeaf collapses the parent split; the last leaf yields null", () => {
	const l = splitLeaf(leaf("a"), "a", "b", "h");
	expect(removeLeaf(l, "a")).toEqual(leaf("b"));
	expect(removeLeaf(leaf("a"), "a")).toBeNull();
});

test("splitAt follows first/second steps and rejects leaves", () => {
	const l = splitLeaf(splitLeaf(leaf("a"), "a", "b", "h"), "b", "c", "v");
	expect(splitAt(l, [])).toBe(l);
	expect(splitAt(l, [1])).toBe(l.second);
	expect(splitAt(l, [0])).toBeNull();
	expect(splitAt(l, [0, 0])).toBeNull();
});

test("clampRatio keeps dividers inside 10–90%", () => {
	expect([clampRatio(-1), clampRatio(0.4), clampRatio(2)]).toEqual([0.1, 0.4, 0.9]);
});
