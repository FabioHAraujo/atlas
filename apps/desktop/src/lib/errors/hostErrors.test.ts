// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const calls: [string, unknown][] = [];
mock.module("@tauri-apps/api/core", () => ({
	invoke: async (cmd: string, args: unknown) => {
		calls.push([cmd, args]);
		return null;
	},
}));
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
await (await import("../../../test/uiKit.ts")).installUiKit();

// `$state` is a compiler rune; plain values are enough for the rules under test.
const keys = ["$state"];
const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
Object.defineProperty(globalThis, "$state", { value: (v) => v, configurable: true, writable: true });
afterAll(() => {
	for (const k of keys) {
		if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
		else delete globalThis[k];
	}
});

// Dynamic on purpose: static imports are hoisted above the `$state` rune stub and the module mocks
// installed here, and the store reads both at load time.
const { errors } = await import("./errors.svelte.ts");

const NOT_REACHABLE =
	"Terminal host not reachable. Terminals cannot start or reconnect until it is back. Use Restart terminal host, or Report if it keeps happening.";

beforeEach(() => {
	errors.toasts = [];
});

/**
 * Incident 1.5.0-alpha.5: three tabs each called the host, each got "atlas hostd is not reachable
 * (see ~/.atlas/hostd.log)" and the user saw three identical stacked toasts. Same failure = one
 * toast with a count, however many callers hit it and whatever order they arrive in.
 */
test("N identical host failures are one toast with a count", async () => {
	for (let i = 0; i < 3; i++) errors.captureHost(NOT_REACHABLE);
	expect(errors.toasts).toHaveLength(1);
	expect(errors.toasts[0].repeats).toBe(2);
	expect(errors.toasts[0].host).toBe(true);
});

test("a different failure is its own toast; the same one afterwards still folds into the first", async () => {
	errors.captureHost(NOT_REACHABLE);
	errors.captureHost("Terminal host upgrade failed (boom). Terminals keep running on the old host.");
	errors.captureHost(NOT_REACHABLE);
	expect(errors.toasts.map((t) => t.repeats)).toEqual([1, 0]);
});

test("the log path and per-call noise do not defeat the dedupe", async () => {
	errors.captureHost(`${NOT_REACHABLE} (connect /Users/ana/.atlas/hostd.sock: refused)`);
	errors.captureHost(`${NOT_REACHABLE} (connect /Users/bob/.atlas/hostd.sock: refused)`);
	expect(errors.toasts).toHaveLength(1);
});

test("a host toast keeps the message actionable and never a log path", async () => {
	errors.captureHost(NOT_REACHABLE);
	const t = errors.toasts[0];
	expect(t.report.message).toContain("Restart terminal host");
	expect(t.report.message).not.toContain("hostd.log");
	expect(t.report.context?.diagnostics).toBeUndefined(); // fetched on demand, not on every toast
});

test("restartHost asks the backend to restart it and clears the toast", async () => {
	errors.captureHost(NOT_REACHABLE);
	calls.length = 0;
	await errors.restartHost(errors.toasts[0].id);
	expect(calls.map((c) => c[0])).toContain("host_restart_force");
	expect(errors.toasts).toHaveLength(0);
});
