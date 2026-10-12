// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { diffEnv, parseEnv, looksSecret } from "./env.ts";
import { parseJustfile, parseMakefile } from "./makefile.ts";
import { analyzeDockerfile, expandArgs, parseDockerfile, parseImage } from "./dockerfile.ts";
import { composeModel } from "./compose.ts";
import { compareCells, detectHeader, parseCsv, readTable, sniffDelimiter } from "./csv.ts";
import { workflowModel } from "./workflow.ts";
import { formatOf, parseData, stripJsonc } from "./data.ts";
import { detectPackageManager, goMod, manifestFor, npmManifest, pepDep, runScriptArgv } from "./manifest.ts";
import { detectLicense, ignoreSections, parseCodeowners, parseEditorconfig, parseProcfile } from "./misc.ts";
import { extendsCandidates, resolveTsconfig } from "./tsconfig.ts";
import { readNotebook } from "./notebook.ts";
import { formatJson, formatText } from "../format.ts";
import { matchesGlob, resolveEditorConfig } from "#lib/editor/editorconfig.ts";

test("env: export prefix, quotes, inline comments, empty values", () => {
	const d = parseEnv(`# db\nexport A=1\nB="two words" # note\nC='raw $x'\nD=\nE=a b c  # trailing\n`);
	const vars = d.entries.filter((e) => e.kind === "var");
	expect(vars.map((v) => [v.key, v.value])).toEqual([
		["A", "1"],
		["B", "two words"],
		["C", "raw $x"],
		["D", ""],
		["E", "a b c"],
	]);
	expect(vars[0].exported).toBe(true);
	expect(vars[1].comment).toBe("note");
	expect(vars[4].comment).toBe("trailing");
	expect(d.entries[0]).toMatchObject({ kind: "comment", text: "db" });
});

test("env: multiline quoted values, escapes, CRLF", () => {
	const d = parseEnv('KEY="line1\nline2"\r\nESC="a\\nb\\"c"\r\nNEXT=1');
	const vars = d.entries.filter((e) => e.kind === "var");
	expect(vars[0]).toMatchObject({ key: "KEY", value: "line1\nline2", line: 1, end: 2 });
	expect(vars[1].value).toBe('a\nb"c');
	expect(vars[2]).toMatchObject({ key: "NEXT", line: 4 });
});

test("env: duplicates and invalid lines are flagged", () => {
	const d = parseEnv('A=1\nB=2\nA=3\nnot a pair\n9BAD=1\nOPEN="never closed\nx=y');
	expect([...d.duplicates]).toEqual([["A", [1, 3]]]);
	const bad = d.entries.filter((e) => e.kind === "invalid");
	expect(bad.map((b) => b.line)).toEqual([4, 5, 6]);
	expect(bad[2].reason).toMatch(/Unterminated/);
});

test("env: diff against example and secret heuristics", () => {
	const diff = diffEnv(parseEnv("A=1\nC=3"), parseEnv("A=\nB=\n"));
	expect(diff).toEqual({ missing: ["B"], extra: ["C"] });
	expect(looksSecret("STRIPE_SECRET_KEY")).toBe(true);
	expect(looksSecret("PORT")).toBe(false);
});

test("makefile: targets, deps, ## docs, .PHONY, tab recipes, continuations", () => {
	const d = parseMakefile(
		`CC := gcc\n.PHONY: build clean\n\n## Build everything\nbuild: deps ## compile it\n\t$(CC) -o out \\\n\t  main.c\n\nclean:\n\trm -rf out\n\n%.o: %.c\n\t$(CC) -c $<\n`,
	);
	expect(d.variables[0]).toMatchObject({ name: "CC", value: "gcc" });
	const build = d.targets.find((t) => t.name === "build");
	expect(build).toMatchObject({ deps: ["deps"], phony: true, doc: "compile it" });
	expect(build.recipe).toEqual(["$(CC) -o out  main.c"]);
	expect(d.targets.find((t) => t.name === "clean")).toMatchObject({ phony: true, recipe: ["rm -rf out"] });
	expect(d.targets.find((t) => t.name === "%.o").runnable).toBe(false);
	expect(d.defaultTarget).toBe("build");
});

test("makefile: doc comments above a target and spaces are not recipes", () => {
	const d = parseMakefile(
		"## Run tests\n## fast\ntest:\n\tgo test ./...\n\nINCLUDE = x\n-include other.mk\n",
	);
	expect(d.targets[0].doc).toBe("Run tests fast");
	expect(d.includes).toEqual(["other.mk"]);
});

test("justfile: recipes, parameters, docs, set/alias", () => {
	const d = parseJustfile(
		`set shell := ["bash", "-c"]\nname := "x"\n\n# Build it\nbuild target='debug': fmt\n    cargo build --{{target}}\n\n@fmt:\n    cargo fmt\n`,
	);
	expect(d.variables[0].name).toBe("name");
	expect(d.targets.map((t) => t.name)).toEqual(["build", "fmt"]);
	expect(d.targets[0]).toMatchObject({ doc: "Build it", deps: ["fmt"], params: ["target='debug'"] });
	expect(d.targets[0].recipe).toEqual(["cargo build --{{target}}"]);
});

test("dockerfile: continuations, comments inside them, heredocs", () => {
	const { instructions } = parseDockerfile(
		`FROM node:20 AS build\nRUN apt-get update \\\n  # comment\n  && apt-get install -y curl\nRUN <<EOF\necho hi\nFROM fake\nEOF\nCOPY . .\n`,
	);
	expect(instructions.map((i) => i.op)).toEqual(["FROM", "RUN", "RUN", "COPY"]);
	expect(instructions[1].args).toContain("apt-get install -y curl");
	expect(instructions[2].args).toContain("FROM fake");
});

test("dockerfile: stages, ports and warnings", () => {
	const d = analyzeDockerfile(
		`ARG V=1\nFROM node:latest AS build\nRUN apt-get install -y git\nFROM nginx\nEXPOSE 80 443/tcp\nUSER root\n`,
	);
	expect(d.globalArgs).toHaveLength(1);
	expect(d.stages.map((s) => [s.name, s.image])).toEqual([
		["build", "node:latest"],
		[null, "nginx"],
	]);
	expect(d.ports).toEqual([
		{ port: "80", stage: 1 },
		{ port: "443/tcp", stage: 1 },
	]);
	const msgs = d.warnings.map((w) => w.message).join("\n");
	expect(msgs).toMatch(/:latest/);
	expect(msgs).toMatch(/no tag/);
	expect(msgs).toMatch(/no-install-recommends/);
	expect(msgs).toMatch(/runs as root/);
});

test("dockerfile: clean file has no warnings, stage refs are not images", () => {
	const d = analyzeDockerfile(
		`FROM node:20-alpine AS b\nFROM b\nRUN apt-get install --no-install-recommends -y x && rm -rf /var/lib/apt/lists/*\nUSER app\n`,
	);
	expect(d.warnings).toEqual([]);
});

test("image refs: registry, tag, digest and links", () => {
	expect(parseImage("node:20")).toMatchObject({
		registry: null,
		repo: "node",
		tag: "20",
		url: "https://hub.docker.com/_/node",
	});
	expect(parseImage("ghcr.io/o/r/app:1@sha256:abc")).toMatchObject({
		registry: "ghcr.io",
		repo: "o/r/app",
		tag: "1",
		digest: "sha256:abc",
	});
	expect(parseImage("localhost:5000/x")).toMatchObject({ registry: "localhost:5000", repo: "x", tag: null });
	expect(parseImage("bitnami/redis").url).toBe("https://hub.docker.com/r/bitnami/redis");
});

test("compose: services, ports (long syntax), env as list/map, depends_on", () => {
	const v = parseData(
		`name: shop\nservices:\n  web:\n    build: ./web\n    ports: ["3000:3000", {target: 80, published: 8080}]\n    environment:\n      A: 1\n      B:\n    depends_on:\n      db: {condition: service_healthy}\n  db:\n    image: postgres:16\n    environment: ["X=1"]\n    volumes: [data:/var/lib/postgresql]\n  cache:\n    image: redis\n    depends_on: [ghost]\nvolumes:\n  data:\n`,
		"yaml",
	).value;
	const m = composeModel(v);
	expect(m.name).toBe("shop");
	expect(m.services[0]).toMatchObject({
		name: "web",
		build: "./web",
		ports: ["3000:3000", "8080:80"],
		env: ["A=1", "B"],
	});
	expect(m.services[0].dependsOn).toEqual([{ name: "db", condition: "service_healthy" }]);
	expect(m.unknownDeps).toEqual([{ service: "cache", dep: "ghost" }]);
	expect(m.order.indexOf("db")).toBeLessThan(m.order.indexOf("web"));
	expect(m.volumes).toEqual(["data"]);
});

test("compose: dependency cycles do not hang", () => {
	const m = composeModel({ services: { a: { depends_on: ["b"] }, b: { depends_on: ["a"] } } });
	expect(m.order.sort()).toEqual(["a", "b"]);
});

test("csv: quotes, escaped quotes, embedded newlines, CRLF, BOM, trailing line", () => {
	const rows = parseCsv('\ufeffa,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n', ",");
	expect(rows).toEqual([
		["a", "b"],
		["x, y", 'say "hi"'],
		["multi\nline", "z"],
	]);
	expect(parseCsv("a,b\n,\n", ",")).toEqual([
		["a", "b"],
		["", ""],
	]);
});

test("csv: delimiter sniffing and header detection", () => {
	expect(sniffDelimiter("a;b;c\n1;2;3\n")).toBe(";");
	expect(sniffDelimiter("a\tb\n1\t2\n")).toBe("\t");
	expect(sniffDelimiter("one column\nanother\n")).toBe(",");
	expect(
		detectHeader([
			["id", "name"],
			["1", "x"],
		]),
	).toBe(true);
	expect(
		detectHeader([
			["1", "2"],
			["3", "4"],
		]),
	).toBe(false);
	const t = readTable("id,name\n1,a\n2\n");
	expect(t.header).toEqual(["id", "name"]);
	expect(t.ragged).toBe(1);
});

test("csv: numeric-aware sort", () => {
	expect(["10", "9", "2"].sort(compareCells)).toEqual(["2", "9", "10"]);
	expect(["b", "a", "B"].sort(compareCells)).toEqual(["a", "b", "B"]);
});

test("workflow: triggers, needs graph, matrix, unpinned actions", () => {
	const v = parseData(
		`name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: \${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu, macos]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: foo/bar@main\n      - run: bun test\n  deploy:\n    needs: [test, ghost]\n    runs-on: ubuntu-latest\n    steps:\n      - name: Ship\n        run: echo ship\n`,
		"yaml",
	).value;
	const w = workflowModel(v);
	expect(w.name).toBe("CI");
	expect(w.triggers).toEqual([
		{ event: "push", detail: "branches main" },
		{ event: "pull_request", detail: "" },
	]);
	expect(w.jobs.map((j) => [j.id, j.level])).toEqual([
		["test", 0],
		["deploy", 1],
	]);
	expect(w.jobs[0].matrix).toEqual({ os: ["ubuntu", "macos"] });
	expect(w.jobs[0].steps[2].name).toBe("bun test");
	expect(w.unknownNeeds).toEqual([{ job: "deploy", need: "ghost" }]);
	expect(w.unpinned).toEqual([{ job: "test", uses: "foo/bar@main" }]);
});

test("data: jsonc comments and trailing commas, yaml/toml errors carry a message", () => {
	expect(parseData('{ // c\n "a": 1, /* x */ "b": "//not a comment",\n}', "json").value).toEqual({
		a: 1,
		b: "//not a comment",
	});
	expect(stripJsonc('{"u":"http://x"}')).toBe('{"u":"http://x"}');
	expect(parseData("a: [", "yaml").ok).toBe(false);
	const bad = parseData("a = ", "toml");
	expect(bad.ok).toBe(false);
	expect(formatOf("toml")).toBe("toml");
});

test("manifest: package.json header, scripts, groups, workspaces", () => {
	const m = npmManifest({
		name: "x",
		version: "1.0.0",
		license: "MIT",
		engines: { node: ">=20" },
		packageManager: "bun@1.4.2",
		scripts: { dev: "vite", test: "bun test" },
		dependencies: { a: "^1" },
		devDependencies: { b: "~2" },
		workspaces: { packages: ["apps/*"] },
	});
	expect(m.scripts.map((s) => s.name)).toEqual(["dev", "test"]);
	expect(m.groups.map((g) => g.title)).toEqual(["dependencies", "devDependencies"]);
	expect(m.workspaces).toEqual(["apps/*"]);
	expect(m.facts[0]).toEqual({ label: "Engines", value: "node >=20" });
});

test("manifest: package manager from lockfile or packageManager, run argv", () => {
	expect(detectPackageManager(["bun.lock"])).toBe("bun");
	expect(detectPackageManager(["pnpm-lock.yaml", "yarn.lock"])).toBe("pnpm");
	expect(detectPackageManager([])).toBe("npm");
	expect(detectPackageManager(["yarn.lock"], "pnpm@9.0.0")).toBe("pnpm");
	expect(runScriptArgv("yarn", "dev")).toEqual(["yarn", "dev"]);
	expect(runScriptArgv("bun", "dev")).toEqual(["bun", "run", "dev"]);
});

test("manifest: Cargo.toml with workspace inheritance and features", () => {
	const r = manifestFor(
		"cargo",
		`[workspace]\nmembers = ["crates/*"]\n[workspace.dependencies]\nserde = "1"\n[package]\nname = "a"\nversion.workspace = true\n[dependencies]\ntokio = { version = "1", features = ["full"] }\nlocal = { path = "../l" }\n`,
	);
	const m = r.manifest;
	expect(m.name).toBe("a");
	expect(m.version).toBe("workspace");
	expect(m.workspaces).toEqual(["crates/*"]);
	expect(m.groups[0].deps[0]).toMatchObject({ name: "tokio", range: "1", note: "features: full" });
	expect(m.groups[0].deps[1].range).toBe("local");
});

test("manifest: pyproject (PEP 621 + poetry), go.mod blocks, composer", () => {
	expect(pepDep("requests[socks]>=2.0; python_version<'3.9'")).toEqual({
		name: "requests",
		range: ">=2.0",
		note: "extras: socks · python_version<'3.9'",
	});
	const py = manifestFor(
		"pyproject",
		`[project]\nname="p"\nversion="1"\nrequires-python=">=3.10"\ndependencies=["a>=1","b"]\n[project.optional-dependencies]\ndev=["pytest"]\n`,
	).manifest;
	expect(py.groups.map((g) => g.title)).toEqual(["dependencies", "optional: dev"]);
	const g = goMod(
		`module example.com/x\n\ngo 1.22\n\nrequire (\n\tgithub.com/a/b v1.2.3\n\tgithub.com/c/d v0.1.0 // indirect\n)\nrequire github.com/e/f v2.0.0\n`,
	);
	expect(g.name).toBe("example.com/x");
	expect(g.groups[0].deps.map((d) => d.name)).toEqual(["github.com/a/b", "github.com/e/f"]);
	expect(g.groups[1].deps[0].name).toBe("github.com/c/d");
	const c = manifestFor(
		"composer",
		'{"name":"v/p","require":{"php":">=8"},"scripts":{"t":["a","b"]}}',
	).manifest;
	expect(c.scripts[0].command).toBe("a && b");
	expect(manifestFor("cargo", "x = ").error).toBeTruthy();
});

test("ignore sections, codeowners, editorconfig, procfile", () => {
	const s = ignoreSections("# deps\nnode_modules/\n!keep\n\n# build\n/dist\n*.log\n");
	expect(s.map((x) => x.title)).toEqual(["deps", "build"]);
	expect(s[0].rules[0]).toMatchObject({ pattern: "node_modules", dirOnly: true });
	expect(s[0].rules[1].negated).toBe(true);
	expect(s[1].rules[0]).toMatchObject({ pattern: "dist", anchored: true });
	const co = parseCodeowners("# core\n* @a @org/team\n/docs/ docs@x.com\n");
	expect(co.rules[0].owners).toEqual(["@a", "@org/team"]);
	expect(co.owners.get("@a")).toBe(1);
	const ec = parseEditorconfig(
		"root = true\n[*]\nindent_style = space\nindent_size = 2\n[*.md]\ntrim_trailing_whitespace = false\n",
	);
	expect(ec.root).toBe(true);
	expect(ec.sections[0].props[1]).toMatchObject({ key: "indent_size", value: "2" });
	expect(parseProcfile("web: bun start\n# c\nworker: node w.js\n")).toEqual([
		{ name: "web", command: "bun start", line: 1 },
		{ name: "worker", command: "node w.js", line: 3 },
	]);
});

test("license detection", () => {
	const mit =
		"MIT License\n\nCopyright (c) 2024 Ada Lovelace\n\nPermission is hereby granted, free of charge, to any person";
	expect(detectLicense(mit)).toMatchObject({ spdx: "MIT", holder: "Ada Lovelace", year: "2024" });
	expect(detectLicense("Apache License\nVersion 2.0, January 2004").spdx).toBe("Apache-2.0");
	expect(detectLicense("all rights reserved").spdx).toBeNull();
});

test("tsconfig: extends chain merges base-first and reports origin", async () => {
	const files = {
		"tsconfig.json":
			'{ // c\n "extends": "./base", "compilerOptions": { "strict": false, "outDir": "out" }, "include": ["src"], }',
		"base.json":
			'{"extends":"@tsconfig/node/tsconfig.json","compilerOptions":{"strict":true,"target":"es2022"}}',
		"node_modules/@tsconfig/node/tsconfig.json": '{"compilerOptions":{"module":"nodenext"}}',
	};
	const m = await resolveTsconfig("tsconfig.json", async (p) => files[p] ?? null, extendsCandidates);
	expect(m.chain.map((l) => l.path)).toEqual([
		"node_modules/@tsconfig/node/tsconfig.json",
		"base.json",
		"tsconfig.json",
	]);
	const by = Object.fromEntries(m.options.map((o) => [o.key, o]));
	expect(by.strict).toMatchObject({ value: false, from: "tsconfig.json" });
	expect(by.target.from).toBe("base.json");
	expect(by.module.from).toBe("node_modules/@tsconfig/node/tsconfig.json");
	expect(m.include).toEqual(["src"]);
});

test("tsconfig: cycles and missing bases terminate", async () => {
	const cyc = await resolveTsconfig(
		"a.json",
		async (p) => (p === "a.json" ? '{"extends":"./b.json"}' : '{"extends":"./a.json"}'),
		extendsCandidates,
	);
	expect(cyc.chain.length).toBe(2);
	const miss = await resolveTsconfig(
		"a.json",
		async (p) => (p === "a.json" ? '{"extends":"./nope"}' : null),
		extendsCandidates,
	);
	expect(miss.chain[0]).toMatchObject({ path: "./nope", missing: true });
	expect(extendsCandidates("pkg/tsconfig.json", "../base")).toEqual(["base.json", "base/tsconfig.json"]);
});

test("notebook: markdown/code cells with stream, image and error outputs", () => {
	const nb = readNotebook({
		nbformat: 4,
		nbformat_minor: 5,
		metadata: { kernelspec: { display_name: "Python 3", language: "python" } },
		cells: [
			{ cell_type: "markdown", source: ["# T\n", "text"] },
			{
				cell_type: "code",
				execution_count: 3,
				source: "print(1)",
				outputs: [
					{ output_type: "stream", name: "stdout", text: ["1\n"] },
					{ output_type: "display_data", data: { "image/png": "AAA\n", "text/plain": "<fig>" } },
					{
						output_type: "error",
						ename: "ValueError",
						evalue: "bad",
						traceback: ["\u001b[31mTrace\u001b[0m"],
					},
				],
			},
		],
	});
	expect(nb.kernel).toBe("Python 3");
	expect(nb.cells[0].source).toBe("# T\ntext");
	expect(nb.cells[1].execution).toBe(3);
	expect(nb.cells[1].outputs.map((o) => o.kind)).toEqual(["text", "image", "error"]);
	expect(nb.cells[1].outputs[2].trace).toBe("Trace");
});

test("format: JSON honours tab/space and final newline; editorconfig resolution", async () => {
	expect(formatJson('{"a":[1,2],"b":{}}', { indent: "  ", finalNewline: true })).toBe(
		'{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}\n',
	);
	expect(formatJson('{"a":1}', { indent: "\t", finalNewline: false })).toBe('{\n\t"a": 1\n}');
	expect(() => formatJson("{", { indent: "  ", finalNewline: true })).toThrow();
	expect(matchesGlob("*.{ts,js}", "src/a.ts")).toBe(true);
	expect(matchesGlob("*.md", "a.ts")).toBe(false);
	expect(matchesGlob("src/**/*.ts", "src/x/y.ts")).toBe(true);
	const ec = resolveEditorConfig("/w/a/b.json", [
		{
			dir: "/w",
			text: "[*]\nindent_style = space\nindent_size = 4\ninsert_final_newline = true\n[*.json]\nindent_size = 2\n",
		},
	]);
	expect(ec).toMatchObject({ indent_style: "space", indent_size: 2, insert_final_newline: true });
	expect(
		resolveEditorConfig("/w/Makefile", [{ dir: "/w", text: "[Makefile]\nindent_style = tab\n" }])
			.indent_style,
	).toBe("tab");
	expect(await formatText("a:   1\n", "yaml", { indent: "  ", finalNewline: true })).toBe("a: 1\n");
	expect(await formatText("x", "log", { indent: "  ", finalNewline: true })).toBeNull();
});

test("dockerfile: global ARG defaults resolve into FROM, so :latest through an ARG is still flagged", () => {
	expect(expandArgs("node:${V}", [{ args: "V=20-alpine" }])).toBe("node:20-alpine");
	expect(expandArgs("node:${V:-18}", [])).toBe("node:18");
	expect(expandArgs("node:$V", [])).toBe("node:$V");
	const d = analyzeDockerfile("ARG V=latest\nFROM node:${V}\nUSER app\n");
	expect(d.stages[0].image).toBe("node:latest");
	expect(d.warnings.map((w) => w.message).join()).toMatch(/:latest/);
});

test("tree: flatten honours open set, paths, types, and search force-expands ancestors", async () => {
	const { flatten, defaultOpen, typeOf } = await import("./tree.ts");
	const v = {
		name: "x",
		list: [1, { "weird key": null }],
		nested: { deep: { k: "needle" } },
		when: new Date(0),
	};
	const open = defaultOpen(v);
	const { rows } = flatten(v, open);
	expect(rows.map((r) => r.path)).toEqual([
		"",
		"name",
		"list",
		"list[0]",
		"list[1]",
		"nested",
		"nested.deep",
		"when",
	]);
	const all = flatten(v, new Set(["$", "list", "list[1]", "nested", "nested.deep"])).rows;
	expect(all.find((r) => r.id === "list[1]")?.type).toBe("object");
	expect(all.map((r) => r.path)).toContain('list[1]["weird key"]');
	expect(all.map((r) => r.path)).toContain("nested.deep.k");
	expect(typeOf(new Date())).toBe("date");
	expect(typeOf(null)).toBe("null");
	const found = flatten(v, new Set(["$"]), "needle");
	expect(found.matches).toBe(1);
	expect(found.rows.map((r) => r.path)).toEqual(["", "nested", "nested.deep", "nested.deep.k"]);
	expect(found.rows.find((r) => r.path === "nested.deep.k")?.hit).toBe(true);
	expect(flatten(v, new Set(["$"]), "zzz").matches).toBe(0);
});
