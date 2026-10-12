// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { hostFacts, type HostLike } from "./hostFacts.ts";

const host = (over: Partial<HostLike> = {}): HostLike => ({
	status: "current",
	proto: 2,
	caps: ["pty_attach_raw", "upgrade", "lsp"],
	skew: "none",
	ptys: [],
	...over,
});

test("a host that has not reconciled yet is not reported as too old", () => {
	expect(hostFacts(host({ proto: null, caps: [] })).lsp).toBe(true);
});

test("a reconciled host without the lsp cap is too old", () => {
	expect(hostFacts(host({ proto: 1, caps: [] })).lsp).toBe(false);
	expect(hostFacts(host({ caps: ["pty_attach_raw", "upgrade"] })).lsp).toBe(false);
});

test("a live upgrade in flight or pending reads as updating (no terminal lost)", () => {
	expect(hostFacts(host({ status: "upgrading" })).updating).toBe(true);
	expect(hostFacts(host({ skew: "upgradable" })).updating).toBe(true);
	expect(hostFacts(host()).updating).toBe(false);
});

test("the terminals a restart would end are listed by title and folder", () => {
	const f = hostFacts(
		host({
			ptys: [
				{ title: "zsh", cwd: "/w/a" },
				{ title: "bun dev", cwd: "/w/b" },
			],
		}),
	);
	expect(f.ptys).toEqual([
		{ title: "zsh", cwd: "/w/a" },
		{ title: "bun dev", cwd: "/w/b" },
	]);
});

// Defect (host skew): a 0.6.2 host answers `lsp_open` with `bad request: unknown variant ...`. The
// client reported that as "could not reach the language server host, restart the app", so F12 and
// ⌘-click did nothing useful and the real fix (restart the terminal host) was never offered.
import { isHostTooOld } from "./hostFacts.ts";

test("the exact reply of an old hostd to an lsp command reads as 'host too old'", () => {
	const reply =
		"bad request: unknown variant `lsp_open`, expected one of `pty_create`, `pty_attach`, `pty_list`";
	expect(isHostTooOld(reply)).toBe(true);
	expect(isHostTooOld(new Error(reply))).toBe(true);
});

test("other failures are not blamed on the host version", () => {
	expect(isHostTooOld("connection refused")).toBe(false);
	expect(isHostTooOld("path must be absolute: x")).toBe(false);
	expect(isHostTooOld("bad request: missing field `path`")).toBe(false);
	expect(isHostTooOld(undefined)).toBe(false);
});

// The worktree root travels with every `lsp_open`: hostd serves dependency files (node_modules, the
// cargo registry, Rust std) from it instead of rooting a second server in the dependency.
import { openPayload } from "./hostFacts.ts";

test("lsp_open carries the worktree root, in the snake_case the Rust side reads", () => {
	const p = openPayload({ path: "/w/a.ts", languageId: "typescript", text: "x", version: 3, root: "/w" });
	expect(p).toEqual({ path: "/w/a.ts", language_id: "typescript", text: "x", version: 3, root: "/w" });
	expect(Object.keys(p).every((k) => !/[A-Z]/.test(k))).toBe(true);
});

test("no worktree (a file outside every one) sends no root rather than an empty string", () => {
	const p = openPayload({ path: "/x/a.ts", languageId: "typescript", text: "", version: 1, root: undefined });
	expect("root" in p).toBe(false);
	expect(
		openPayload({ path: "/x/a.ts", languageId: "typescript", text: "", version: 1, root: "" }),
	).not.toHaveProperty("root");
});

test("overrides ride along only when there are some", () => {
	const o = { command: "x" };
	expect(openPayload({ path: "/a", languageId: "go", text: "", version: 1, overrides: o }).overrides).toBe(o);
	expect(openPayload({ path: "/a", languageId: "go", text: "", version: 1 })).not.toHaveProperty("overrides");
});
