// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { startSync } from "./sync.ts";

// Defect: a webview that (re)loads while hostd already runs servers never learned about them: status
// pushes only fire on change, so the chip showed no server (and no version/progress) until some
// unrelated change. The sync must pull the list when it starts and on every reconnect.

const server = (name) => ({ name, state: "ready", root: "/p" });

function rig(initial) {
	const handlers = {};
	const applied = [];
	let list = initial;
	const stop = startSync({
		listen: async (ev, h) => ((handlers[ev] = h), () => delete handlers[ev]),
		fetchServers: async () => list,
		apply: (s) => applied.push(s.map((x) => x.name)),
		reopenAll: () => applied.push("reopen"),
	});
	return { handlers, applied, set: (l) => (list = l), stop };
}

test("the list is pulled once at start, before any push could have told us", async () => {
	const r = rig([server("rust-analyzer")]);
	await Promise.resolve();
	await Promise.resolve();
	expect(r.applied).toEqual([["rust-analyzer"]]);
});

test("a reconnect pulls the list again and re-opens documents", async () => {
	const r = rig([]);
	await new Promise((x) => setTimeout(x, 0));
	r.set([server("gopls")]);
	r.handlers["host://reconnected"]();
	await new Promise((x) => setTimeout(x, 0));
	expect(r.applied).toContainEqual(["gopls"]);
	expect(r.applied).toContain("reopen");
});

test("pushes are applied as they come", async () => {
	const r = rig([]);
	await new Promise((x) => setTimeout(x, 0));
	r.handlers["host://event"]({ payload: { ev: "lsp_status", servers: [server("a"), server("b")] } });
	expect(r.applied.at(-1)).toEqual(["a", "b"]);
});

test("a host that cannot answer (too old, not up yet) is not an error", async () => {
	const rejections = [];
	const on = (e) => rejections.push(e);
	process.on("unhandledRejection", on);
	startSync({
		listen: async () => () => {},
		fetchServers: async () => {
			throw new Error("bad request: unknown variant `lsp_status`");
		},
		apply: () => {},
		reopenAll: () => {},
	});
	await new Promise((x) => setTimeout(x, 10));
	process.off("unhandledRejection", on);
	expect(rejections).toEqual([]);
});

test("stopping removes every listener", async () => {
	const r = rig([]);
	await new Promise((x) => setTimeout(x, 0));
	r.stop();
	await new Promise((x) => setTimeout(x, 0));
	expect(Object.keys(r.handlers)).toEqual([]);
});
