// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { editorConfigDirs, matchesGlob, parseEditorConfig, resolveEditorConfig } from "./editorconfig.ts";

describe("parseEditorConfig", () => {
	test("root, sections, comments, case and spacing", () => {
		const p = parseEditorConfig(
			[
				"# top comment",
				"root = TRUE",
				"",
				"[*]",
				"Indent_Style = space  ",
				"; another comment",
				"indent_size=2",
				"[*.md]",
				"trim_trailing_whitespace = false",
			].join("\r\n"),
		);
		expect(p.root).toBe(true);
		expect(p.sections).toEqual([
			{ glob: "*", props: { indent_style: "space", indent_size: "2" } },
			{ glob: "*.md", props: { trim_trailing_whitespace: "false" } },
		]);
	});

	test("root only counts in the preamble; junk lines are skipped", () => {
		const p = parseEditorConfig("garbage\n[*]\nroot = true\n=novalue\n[broken\nindent_size = 3");
		expect(p.root).toBe(false);
		expect(p.sections).toEqual([{ glob: "*", props: { root: "true", indent_size: "3" } }]);
	});

	test("empty text", () => {
		expect(parseEditorConfig("")).toEqual({ root: false, sections: [] });
	});
});

describe("glob matching", () => {
	const yes = (g: string, p: string) => expect(matchesGlob(g, p), `${g} ~ ${p}`).toBe(true);
	const no = (g: string, p: string) => expect(matchesGlob(g, p), `${g} !~ ${p}`).toBe(false);

	test("* matches a file name at any depth, not across slashes when anchored", () => {
		yes("*", "a.ts");
		yes("*", "src/deep/a.ts");
		yes("*.ts", "src/a.ts");
		no("*.ts", "a.tsx");
		yes("src/*.ts", "src/a.ts");
		no("src/*.ts", "src/deep/a.ts");
	});

	test("** crosses directories", () => {
		yes("src/**", "src/a/b/c.ts");
		yes("**.ts", "a/b/c.ts");
		yes("src/**/x.ts", "src/a/b/x.ts");
		no("src/**", "lib/a.ts");
	});

	test("bare names match at any depth, anchored paths only at the config dir", () => {
		yes("Makefile", "Makefile");
		yes("Makefile", "sub/Makefile");
		no("Makefile", "Makefile.bak");
		yes("/Makefile", "Makefile");
		no("/Makefile", "sub/Makefile");
		yes("lib/a.ts", "lib/a.ts");
		no("lib/a.ts", "x/lib/a.ts");
	});

	test("braces: alternation, nesting, single literal", () => {
		yes("*.{ts,tsx}", "a.tsx");
		yes("*.{ts,tsx}", "a.ts");
		no("*.{ts,tsx}", "a.js");
		yes("{a,b}.txt", "b.txt");
		no("{a,b}.txt", "c.txt");
		yes("*.{js,{ts,tsx}}", "a.tsx");
		yes("{single}", "{single}");
		no("{single}", "single");
		yes("a{,b}c", "ac");
		yes("a{,b}c", "abc");
	});

	test("numeric ranges", () => {
		yes("file{1..3}.txt", "file1.txt");
		yes("file{1..3}.txt", "file3.txt");
		no("file{1..3}.txt", "file4.txt");
		yes("n{-1..1}", "n-1");
		yes("n{3..1}", "n2");
	});

	test("? and character classes", () => {
		yes("?.ts", "a.ts");
		no("?.ts", "ab.ts");
		no("a?b", "a/b");
		yes("[abc].txt", "b.txt");
		no("[abc].txt", "d.txt");
		yes("[!abc].txt", "d.txt");
		no("[!abc].txt", "a.txt");
		yes("a[", "a["); // unterminated class is literal
	});

	test("escapes and regex metacharacters are literal", () => {
		yes("a.b", "a.b");
		no("a.b", "axb");
		yes("a\\*b", "a*b");
		no("a\\*b", "axb");
		yes("f(1)+.txt", "f(1)+.txt");
		yes("a{", "a{"); // unbalanced brace is literal
	});

	test("a huge numeric range does not explode", () => {
		yes("f{1..99999999}", "f12345");
	});
});

describe("resolveEditorConfig", () => {
	const root = "/w";

	test("typed properties from a single file", () => {
		const text = `root = true
[*]
indent_style = tab
end_of_line = crlf
charset = UTF-8
trim_trailing_whitespace = true
insert_final_newline = false
max_line_length = 100`;
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text }])).toEqual({
			indent_style: "tab",
			indent_size: "tab",
			end_of_line: "crlf",
			charset: "utf-8",
			trim_trailing_whitespace: true,
			insert_final_newline: false,
			max_line_length: 100,
		});
	});

	test("last matching section wins within a file", () => {
		const text = "[*]\nindent_size = 2\n[*.ts]\nindent_size = 4\n[*.md]\nindent_size = 8";
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text }]).indent_size).toBe(4);
		expect(resolveEditorConfig("/w/a.md", [{ dir: root, text }]).indent_size).toBe(8);
		expect(resolveEditorConfig("/w/a.rs", [{ dir: root, text }]).indent_size).toBe(2);
		const reversed = "[*.ts]\nindent_size = 4\n[*]\nindent_size = 2";
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text: reversed }]).indent_size).toBe(2);
	});

	test("nearest directory wins regardless of the order files are passed", () => {
		const files = [
			{ dir: "/w/src", text: "[*.ts]\nindent_size = 4" },
			{ dir: "/w", text: "[*]\nindent_size = 2\nindent_style = space" },
		];
		const props = resolveEditorConfig("/w/src/a.ts", files);
		expect(props.indent_size).toBe(4);
		expect(props.indent_style).toBe("space");
		expect(resolveEditorConfig("/w/src/a.ts", [...files].reverse())).toEqual(props);
	});

	test("root = true stops the search: files above are ignored", () => {
		const files = [
			{ dir: "/w", text: "[*]\nindent_size = 2\nend_of_line = crlf" },
			{ dir: "/w/pkg", text: "root = true\n[*]\nindent_size = 8" },
		];
		const props = resolveEditorConfig("/w/pkg/a.ts", files);
		expect(props.indent_size).toBe(8);
		expect(props.end_of_line).toBeUndefined();
		// a file outside pkg still sees the outer config
		expect(resolveEditorConfig("/w/other/a.ts", files).indent_size).toBe(2);
	});

	test("files in directories that are not ancestors are ignored", () => {
		const files = [{ dir: "/w/other", text: "[*]\nindent_size = 9" }];
		expect(resolveEditorConfig("/w/src/a.ts", files)).toEqual({});
	});

	test("section globs are relative to the config's directory", () => {
		const files = [{ dir: "/w/src", text: "[lib/*.ts]\nindent_size = 3\n[/top.ts]\nindent_size = 5" }];
		expect(resolveEditorConfig("/w/src/lib/a.ts", files).indent_size).toBe(3);
		expect(resolveEditorConfig("/w/src/a/lib/a.ts", files).indent_size).toBeUndefined();
		expect(resolveEditorConfig("/w/src/top.ts", files).indent_size).toBe(5);
		expect(resolveEditorConfig("/w/src/x/top.ts", files).indent_size).toBeUndefined();
	});

	test("tab_width defaults from a numeric indent_size", () => {
		expect(resolveEditorConfig("/w/a", [{ dir: root, text: "[*]\nindent_size = 2" }])).toEqual({
			indent_size: 2,
			tab_width: 2,
		});
		expect(resolveEditorConfig("/w/a", [{ dir: root, text: "[*]\nindent_size = 2\ntab_width = 8" }])).toEqual(
			{
				indent_size: 2,
				tab_width: 8,
			},
		);
	});

	test("indent_size = tab takes tab_width; tab style without size means tab", () => {
		expect(
			resolveEditorConfig("/w/a", [{ dir: root, text: "[*]\nindent_size = tab\ntab_width = 4" }]),
		).toEqual({
			indent_size: 4,
			tab_width: 4,
		});
		expect(resolveEditorConfig("/w/a", [{ dir: root, text: "[*]\nindent_size = tab" }]).indent_size).toBe(
			"tab",
		);
		expect(
			resolveEditorConfig("/w/a", [{ dir: root, text: "[*]\nindent_style = tab\ntab_width = 3" }]),
		).toEqual({
			indent_style: "tab",
			indent_size: 3,
			tab_width: 3,
		});
	});

	test("unset removes an inherited or earlier value", () => {
		const files = [
			{ dir: "/w", text: "[*]\nindent_size = 2\nindent_style = space\nmax_line_length = 80" },
			{ dir: "/w/src", text: "[*.ts]\nindent_size = unset\nmax_line_length = off" },
		];
		expect(resolveEditorConfig("/w/src/a.ts", files)).toEqual({ indent_style: "space" });
		const same = "[*]\nindent_size = 2\n[*.ts]\nindent_size = UNSET";
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text: same }])).toEqual({});
	});

	test("invalid values are ignored and keep the earlier value", () => {
		const text =
			"[*]\nindent_size = 4\n[*.ts]\nindent_size = lots\nindent_style = mixed\nend_of_line = vt\ntab_width = 0\ninsert_final_newline = maybe";
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text }])).toEqual({ indent_size: 4, tab_width: 4 });
	});

	test("no files, no match", () => {
		expect(resolveEditorConfig("/w/a.ts", [])).toEqual({});
		expect(resolveEditorConfig("/w/a.ts", [{ dir: root, text: "[*.rs]\nindent_size = 4" }])).toEqual({});
	});

	test("trailing slashes on dirs are tolerated and braces apply end to end", () => {
		const text = "[*.{ts,tsx}]\nindent_size = 2\n[{Makefile,*.mk}]\nindent_style = tab";
		const files = [{ dir: "/w/", text }];
		expect(resolveEditorConfig("/w/x/a.tsx", files).indent_size).toBe(2);
		expect(resolveEditorConfig("/w/Makefile", files).indent_style).toBe("tab");
		expect(resolveEditorConfig("/w/x/rules.mk", files).indent_style).toBe("tab");
	});

	test("relative paths and an empty root dir", () => {
		const files = [{ dir: "", text: "[*.ts]\nindent_size = 2" }];
		expect(resolveEditorConfig("src/a.ts", files).indent_size).toBe(2);
		const nested = [{ dir: "src", text: "[*.ts]\nindent_size = 4" }, ...files];
		expect(resolveEditorConfig("src/a.ts", nested).indent_size).toBe(4);
	});
});

describe("editorConfigDirs", () => {
	test("nearest first up to the root, inclusive", () => {
		expect(editorConfigDirs("/w/src/lib/a.ts", "/w")).toEqual(["/w/src/lib", "/w/src", "/w"]);
		expect(editorConfigDirs("/w/a.ts", "/w/")).toEqual(["/w"]);
	});

	test("paths outside the root yield nothing", () => {
		expect(editorConfigDirs("/other/a.ts", "/w")).toEqual([]);
		expect(editorConfigDirs("/wx/a.ts", "/w")).toEqual([]);
	});

	test("worktree-relative paths with an empty root", () => {
		expect(editorConfigDirs("src/lib/a.ts", "")).toEqual(["src/lib", "src", ""]);
		expect(editorConfigDirs("a.ts", "")).toEqual([""]);
	});

	test("the output feeds resolveEditorConfig", () => {
		const dirs = editorConfigDirs("/w/src/a.ts", "/w");
		const files = dirs.map((dir) => ({
			dir,
			text: dir === "/w" ? "[*]\nindent_size = 2" : "[*]\nindent_style = tab",
		}));
		expect(resolveEditorConfig("/w/src/a.ts", files)).toMatchObject({ indent_style: "tab", indent_size: 2 });
	});
});
