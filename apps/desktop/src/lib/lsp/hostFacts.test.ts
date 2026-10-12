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
