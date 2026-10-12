// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { isHtml, originOf, rightNeighbor } from "./preview.ts";

const leaf = (group) => ({ type: "leaf", group });
const split = (first, second) => ({ type: "split", dir: "h", first, second, ratio: 0.5 });

test("only .html/.htm files offer a preview", () => {
	expect(isHtml("web/index.html")).toBe(true);
	expect(isHtml("A.HTM")).toBe(true);
	expect(isHtml("a.html.txt")).toBe(false);
	expect(isHtml("page.xhtml")).toBe(false);
	expect(isHtml(undefined)).toBe(false);
});

test("originOf keeps host:port of http(s) URLs only", () => {
	expect(originOf("http://127.0.0.1:5173/a.html")).toBe("127.0.0.1:5173");
	expect(originOf("file:///a.html")).toBeNull();
	expect(originOf("nope")).toBeNull();
	expect(originOf(undefined)).toBeNull();
});

test("preview reuses the group to the right, else asks for a split", () => {
	const l = split(leaf("a"), split(leaf("b"), leaf("c")));
	expect(rightNeighbor(l, "a", () => false)).toBe("b");
	expect(rightNeighbor(l, "b", () => false)).toBe("c");
	expect(rightNeighbor(l, "c", () => false)).toBeNull();
	expect(rightNeighbor(l, "a", (g) => g === "b")).toBe("c");
	expect(rightNeighbor(leaf("a"), "a", () => false)).toBeNull();
	expect(rightNeighbor(l, "zzz", () => false)).toBeNull();
});
