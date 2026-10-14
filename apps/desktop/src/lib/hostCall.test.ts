// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const HOST_DOWN = "Terminal host not reachable. Terminals cannot start or reconnect until it is back.";
let fail: unknown = null;
mock.module("@tauri-apps/api/core", () => ({
	invoke: async (cmd: string) => {
		if (fail) throw fail;
		return cmd === "system_info" ? null : { ok: true };
	},
}));
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
await (await import("../../test/uiKit.ts")).installUiKit();
const saved = Object.getOwnPropertyDescriptor(globalThis, "$state");
Object.defineProperty(globalThis, "$state", { value: (v) => v, configurable: true, writable: true });
afterAll(() => {
	if (saved) Object.defineProperty(globalThis, "$state", saved);
	else delete globalThis.$state;
});

// Dynamic on purpose: the `$state` stub and the module mocks above must exist before these load.
const { hostCall } = await import("./host.ts");
const { errors } = await import("./errors/errors.svelte.ts");

beforeEach(() => {
	fail = null;
	errors.toasts = [];
});

/**
 * Incident 1.5.0-alpha.5: Explorer, tabs, Git and the editor each toasted their own copy of the same host
 * outage. Every hostd call goes through `hostCall`, so that is where an outage joins the one shared toast;
 * the caller still gets the rejection and decides what to do with it.
 */
test("many callers hitting one outage make one toast, and each still sees the rejection", async () => {
	fail = HOST_DOWN;
	const results = await Promise.allSettled([hostCall("fs_list"), hostCall("fs_stat"), hostCall("pty_list")]);
	expect(results.every((r) => r.status === "rejected")).toBe(true);
	expect(errors.toasts).toHaveLength(1);
	expect(errors.toasts[0].repeats).toBe(2);
});

test("an ordinary host error (a missing file) is not an outage and makes no host toast", async () => {
	fail = "No such file or directory";
	await hostCall("fs_stat").catch(() => {});
	expect(errors.toasts).toHaveLength(0);
});

test("success touches nothing", async () => {
	expect(await hostCall("info")).toEqual({ ok: true });
	expect(errors.toasts).toHaveLength(0);
});
