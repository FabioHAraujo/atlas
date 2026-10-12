// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { formatArgs, parseArgs } from "./args.ts";

const ok = (text: string) => {
	const r = parseArgs(text);
	if (!r.ok) throw new Error(r.error);
	return r.args;
};

describe("parseArgs", () => {
	test("splits on whitespace and ignores extra spaces", () => {
		expect(ok("")).toEqual([]);
		expect(ok("   ")).toEqual([]);
		expect(ok("--stdio")).toEqual(["--stdio"]);
		expect(ok("  --stdio \t --log=debug\n-v ")).toEqual(["--stdio", "--log=debug", "-v"]);
	});

	test("quotes keep spaces; single quotes are literal", () => {
		expect(ok('--root "My Projects/app"')).toEqual(["--root", "My Projects/app"]);
		expect(ok("--root 'My Projects/app'")).toEqual(["--root", "My Projects/app"]);
		expect(ok(`'a "b" \\n'`)).toEqual(['a "b" \\n']);
		expect(ok(`"it's"`)).toEqual(["it's"]);
	});

	test("quotes join with adjacent text and empty quotes make an empty argument", () => {
		expect(ok('--name="a b"')).toEqual(["--name=a b"]);
		expect(ok("a''b")).toEqual(["ab"]);
		expect(ok('"" x')).toEqual(["", "x"]);
		expect(ok("''")).toEqual([""]);
	});

	test("backslash escapes the next character, and only quotes and backslash inside double quotes", () => {
		expect(ok("a\\ b c")).toEqual(["a b", "c"]);
		expect(ok('"a \\"b\\" \\\\ \\n"')).toEqual(['a "b" \\ \\n']);
		expect(ok("\\'x\\'")).toEqual(["'x'"]);
	});

	test("unterminated input explains what is missing", () => {
		expect(parseArgs('--a "b')).toEqual({ ok: false, error: "Missing closing double quote." });
		expect(parseArgs("--a 'b")).toEqual({ ok: false, error: "Missing closing single quote." });
		expect(parseArgs("a\\")).toEqual({ ok: false, error: "A backslash at the end has nothing to escape." });
	});

	test("does not expand variables or globs", () => {
		expect(ok("$HOME ~/x *.ts")).toEqual(["$HOME", "~/x", "*.ts"]);
	});
});

describe("formatArgs", () => {
	test("plain arguments stay bare", () => {
		expect(formatArgs(["--stdio", "--log=debug"])).toBe("--stdio --log=debug");
		expect(formatArgs([])).toBe("");
	});

	test("arguments with spaces, quotes, backslashes or nothing are quoted", () => {
		expect(formatArgs(["a b"])).toBe('"a b"');
		expect(formatArgs([""])).toBe('""');
		expect(formatArgs(['say "hi"'])).toBe('"say \\"hi\\""');
		expect(formatArgs(["c:\\x"])).toBe('"c:\\\\x"');
		expect(formatArgs(["it's"])).toBe('"it\'s"');
	});

	test("round trips through parseArgs", () => {
		const cases = [
			["--stdio"],
			["a b", "", 'q"uote', "back\\slash", "it's", "tab\there", "new\nline", "--x=y z"],
			[],
		];
		for (const args of cases) expect(ok(formatArgs(args))).toEqual(args);
	});
});
