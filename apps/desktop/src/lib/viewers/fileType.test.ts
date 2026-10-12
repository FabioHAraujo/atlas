// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { fileType } from "./fileType.ts";
import { loadLanguage } from "./lang.ts";

test("exact names win over extensions", () => {
	expect(fileType("a/package.json")).toMatchObject({
		id: "package-json",
		view: "package-json",
		lang: "json",
	});
	expect(fileType("Cargo.toml")).toMatchObject({ view: "manifest", lang: "toml" });
	expect(fileType("go.mod")).toMatchObject({ view: "manifest" });
	expect(fileType("tsconfig.json").view).toBe("tsconfig");
	expect(fileType("tsconfig.build.json").view).toBe("tsconfig");
	expect(fileType("x/atlas.yaml").view).toBe("atlas");
	expect(fileType("atlas.local.yaml").view).toBe("atlas");
});

test("Dockerfile family is detected by name, prefix and suffix", () => {
	for (const p of [
		"Dockerfile",
		"dockerfile",
		"Dockerfile.dev",
		"api.Dockerfile",
		"Containerfile",
		"app/Dockerfile.prod",
	])
		expect(fileType(p)).toMatchObject({ id: "dockerfile", view: "dockerfile" });
	expect(fileType("Dockerfile.dev").lang).toBe("dockerfile");
});

test(".env and variants", () => {
	for (const p of [
		".env",
		".env.local",
		".env.production",
		".env.example",
		"prod.env",
		"apps/web/.env.test.local",
	])
		expect(fileType(p)).toMatchObject({ id: "env", view: "env" });
	expect(fileType(".envrc").view).toBeUndefined();
});

test("compose files by name and by compose.* pattern", () => {
	for (const p of ["docker-compose.yml", "compose.yaml", "docker-compose.prod.yml", "compose.override.yaml"])
		expect(fileType(p).view).toBe("compose");
	expect(fileType("config.yaml").view).toBe("tree");
});

test("GitHub workflows and actions", () => {
	expect(fileType(".github/workflows/ci.yml").view).toBe("workflow");
	expect(fileType("repo/.github/workflows/release.yaml").view).toBe("workflow");
	expect(fileType(".github/actions/setup/action.yml").view).toBe("workflow");
	expect(fileType(".github/dependabot.yml").view).toBe("tree");
});

test("Makefile, Justfile, Procfile and ignore files", () => {
	expect(fileType("Makefile").view).toBe("makefile");
	expect(fileType("GNUmakefile").view).toBe("makefile");
	expect(fileType("rules.mk").view).toBe("makefile");
	expect(fileType("justfile").view).toBe("justfile");
	expect(fileType("Procfile").view).toBe("procfile");
	for (const p of [".gitignore", ".dockerignore", ".npmignore", ".prettierignore", ".eslintignore"])
		expect(fileType(p)).toMatchObject({ id: "ignore", view: "ignore", lang: "gitignore" });
});

test("license variants but not code files named license", () => {
	for (const p of [
		"LICENSE",
		"LICENSE.md",
		"LICENSE-MIT",
		"LICENSE-APACHE",
		"License.txt",
		"COPYING",
		"UNLICENSE",
	])
		expect(fileType(p).view).toBe("license");
	expect(fileType("license.ts").view).toBeUndefined();
	expect(fileType("licenses.json").view).toBe("tree");
});

test("data and notebooks", () => {
	expect(fileType("a.csv").view).toBe("table");
	expect(fileType("a.TSV").view).toBe("table");
	expect(fileType("n.ipynb").view).toBe("notebook");
	expect(fileType("data.json").view).toBe("tree");
	expect(fileType("x.toml").view).toBe("tree");
	expect(fileType("CODEOWNERS").view).toBe("codeowners");
	expect(fileType(".editorconfig").view).toBe("editorconfig");
});

test("source-only languages resolve by extension, longest suffix first", () => {
	expect(fileType("a.proto").lang).toBe("protobuf");
	expect(fileType("schema.prisma").lang).toBe("prisma");
	expect(fileType("main.tf").lang).toBe("hcl");
	expect(fileType("x.service.ts").lang).toBe("typescript");
	expect(fileType("fix.patch").lang).toBe("diff");
	expect(fileType("nginx.conf").lang).toBe("nginx");
	expect(fileType("app.log").lang).toBe("log");
	expect(fileType("Foo.vue").lang).toBe("vue");
	expect(fileType("a.kt").lang).toBe("kotlin");
});

test("unknown files are plain text", () => {
	expect(fileType("README")).toMatchObject({ lang: null, view: undefined });
	expect(fileType("a/b/.hidden")).toMatchObject({ lang: null });
});

test("every language id fileType emits loads without throwing", async () => {
	const ids = new Set([
		"json",
		"jsonc",
		"yaml",
		"toml",
		"env",
		"gitignore",
		"makefile",
		"justfile",
		"procfile",
		"log",
		"dockerfile",
		"shell",
		"properties",
		"nginx",
		"diff",
		"lua",
		"ruby",
		"swift",
		"kotlin",
		"powershell",
		"java",
		"c",
		"cpp",
		"csharp",
		"dart",
		"protobuf",
		"vue",
		"astro",
		"groovy",
		"cmake",
		"hcl",
		"graphql",
		"typescript",
		"tsx",
		"go-mod",
	]);
	for (const id of ids) expect(await loadLanguage(id)).toBeDefined();
});
