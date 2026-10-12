// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import {
	detailsText,
	fileNames,
	fingerprint,
	isBenign,
	issueUrl,
	messageOf,
	report,
	scrub,
} from "./report.ts";

describe("isBenign", () => {
	test("ignores AbortError and the ResizeObserver loop warning", () => {
		expect(isBenign(new DOMException("x", "AbortError"))).toBe(true);
		expect(isBenign("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
		expect(isBenign(new Error("The operation was aborted."))).toBe(true);
	});
	test("keeps real errors", () => {
		expect(isBenign(new TypeError("x is undefined"))).toBe(false);
		expect(isBenign("Aborting is not the same as AbortError in the middle")).toBe(false);
	});
});

describe("messageOf", () => {
	test("handles strings, errors, objects and cycles", () => {
		expect(messageOf("boom")).toBe("boom");
		expect(messageOf(new Error("bad"))).toBe("bad");
		expect(messageOf({ message: "obj" })).toBe("obj");
		const a: Record<string, unknown> = {};
		a.self = a;
		expect(messageOf(a)).toBe("[object Object]");
		expect(messageOf("  ")).toBe("Unknown error");
	});
});

describe("fileNames", () => {
	test("reduces paths and URLs to file:line:col, dropping query strings", () => {
		expect(fileNames("at f (/Users/ana/proj/src/lib/Editor.svelte?t=123:45:6)")).toBe(
			"at f (Editor.svelte:45:6)",
		);
		expect(fileNames("render@http://localhost:1420/src/lib/Editor.svelte:12:3")).toBe(
			"render@Editor.svelte:12:3",
		);
		expect(fileNames("f@[native code]")).toBe("f@[native code]");
	});
});

describe("scrub", () => {
	test("removes home directories and secret-looking query values", () => {
		expect(scrub("ENOENT /Users/ana/x/y")).toBe("ENOENT ~/x/y");
		expect(scrub("GET /a?token=abc123&b=1")).toBe("GET /a?token=…&b=1");
	});
});

describe("report + issueUrl", () => {
	const e = new Error("Cannot read properties of undefined (reading 'x') in /Users/ana/p");
	e.stack = `Error: boom\n    at render (/Users/ana/p/src/Editor.svelte:10:2)\n    at run (/Users/ana/p/src/a.ts:1:1)`;
	const r = { ...report(e, { where: "Editor", kind: "editor", file: "main.rs" }), version: "0.5.14" };

	test("keeps file names only and no home path", () => {
		expect(r.stack).toBe("    at render (Editor.svelte:10:2)\n    at run (a.ts:1:1)");
		expect(r.message).not.toContain("/Users");
	});
	test("issue URL targets the repo and carries version, message and trimmed stack", () => {
		const u = new URL(issueUrl(r));
		expect(u.origin + u.pathname).toBe("https://github.com/codeatlasdev/atlas/issues/new");
		const body = u.searchParams.get("body") ?? "";
		expect(body).toContain("Atlas: 0.5.14");
		expect(body).toContain("Editor.svelte:10:2");
		expect(body).not.toContain("/Users");
		expect(u.searchParams.get("title")?.startsWith("[desktop] Cannot read")).toBe(true);
	});
	test("details text is plain and complete", () => {
		const t = detailsText(r);
		expect(t).toContain("Atlas 0.5.14");
		expect(t).toContain("Where: Editor (editor)");
		expect(t).toContain("File: main.rs");
	});
	test("long stacks stay under the URL budget", () => {
		const long = { ...r, stack: "x".repeat(50_000) };
		expect(issueUrl(long).length).toBeLessThan(9000);
	});
});

describe("fingerprint", () => {
	test("same message and top frame collide", () => {
		const a = { message: "m", stack: "a\nb" };
		expect(fingerprint(a)).toBe(fingerprint({ message: "m", stack: "a\nz" }));
		expect(fingerprint(a)).not.toBe(fingerprint({ message: "n", stack: "a" }));
	});
});

test("a plain object carrying a stack (SvelteKit's handleError result) keeps its frames", () => {
	const r = report({ message: "m", stack: "m\n    at f (/Users/ana/p/a.ts:1:2)" }, { where: "x" });
	expect(r.stack).toBe("    at f (a.ts:1:2)");
});
