// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { argsLine, atHits, completeAt, pushHistory, slashHits } from "./composer.ts";

const cmds = [{ name: "compact" }, { name: "model" }, { name: "context" }];

test("slashHits only offers commands for a bare /prefix", () => {
	expect(slashHits("/co", cmds).map((c) => c.name)).toEqual(["compact", "context"]);
	expect(slashHits("/compact now", cmds)).toEqual([]);
	expect(slashHits("hello", cmds)).toEqual([]);
});

test("atHits and completeAt work on the trailing @mention only", () => {
	const files = ["src/a.ts", "src/b.ts", "README.md"];
	expect(atHits("look at @src", files)).toEqual(["src/a.ts", "src/b.ts"]);
	expect(atHits("mail me@x", files)).toEqual([]);
	expect(atHits("no mention", files)).toEqual([]);
	expect(completeAt("look at @sr", "src/a.ts")).toBe("look at @src/a.ts ");
});

test("pushHistory moves a repeated prompt to the front and caps the list", () => {
	expect(pushHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
	const long = Array.from({ length: 60 }, (_, i) => `m${i}`);
	expect(pushHistory(long, "new").length).toBe(50);
});

test("argsLine prefers command, path, pattern, query, then the first question", () => {
	expect(argsLine({ command: "ls", path: "/x" })).toBe("ls");
	expect(argsLine({ questions: [{ question: "Sure?" }] })).toBe("Sure?");
	expect(argsLine({ foo: 1 })).toBe('{"foo":1}');
	expect(argsLine("x")).toBe("");
	expect(argsLine({ command: "x".repeat(300) }).length).toBe(160);
});
