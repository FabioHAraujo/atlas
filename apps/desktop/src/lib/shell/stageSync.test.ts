// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { beforeEach, expect, test } from "bun:test";
import { createStageSync } from "./stageSync.ts";

/** A fake world: DOM ops and native commands are recorded in one ordered log. */
let log, snapped, fail, idleQueue, gestureActive;
const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

function make(over = {}) {
	const s = createStageSync({
		ids: () => ["a", "b", "c"],
		active: () => "b",
		show: (id) => log.push(`show:${id}`),
		park: (id) => log.push(`park:${id}`),
		nextFrame: async () => void log.push("frame"),
		cover: async () => (log.push("cover"), true),
		uncover: async () => void log.push("uncover"),
		snapshot: async (id) => {
			log.push(`snap:${id}`);
			if (fail) throw new Error("no snapshot");
			snapped.push(id);
			return true;
		},
		pages: async () => void log.push("pages"),
		idle: (f) => idleQueue.push(f),
		gestureActive: () => gestureActive,
		quietMs: () => 1000,
		...over,
	});
	return s;
}
/** Run queued idle tasks until none is left; bounded, since a task waiting for quiet re-arms itself. */
const runIdle = async (max = 50) => {
	for (let i = 0; i < max && idleQueue.length; i++) await idleQueue.shift()();
	await flush();
};

beforeEach(() => {
	log = [];
	snapped = [];
	fail = false;
	idleQueue = [];
	gestureActive = false;
});

test("warming a page covers the screen first, shows the page, snapshots it, parks it, then uncovers", async () => {
	const s = make();
	s.warm(["a"]);
	await runIdle();
	expect(log).toEqual(["cover", "show:a", "frame", "snap:a", "park:a", "uncover"]);
});

test("the current page is snapshotted as it is on screen, with no cover and no show/park", async () => {
	const s = make();
	s.warm(["b"]);
	await runIdle();
	expect(log).toEqual(["snap:b"]);
});

test("pages warm one at a time inside a single cover, neighbours first", async () => {
	const s = make();
	s.warm(["b", "c", "a"]);
	await runIdle();
	expect(log).toEqual([
		"snap:b",
		"cover",
		"show:c",
		"frame",
		"snap:c",
		"park:c",
		"show:a",
		"frame",
		"snap:a",
		"park:a",
		"uncover",
	]);
});

test("a gesture that starts mid-warm-up stops it: the shown page is parked and the cover lifted", async () => {
	// Hold the first page's frame open so the abort lands while it is shown.
	const { promise: held, resolve: release } = Promise.withResolvers();
	const s = make({ nextFrame: async () => (log.push("frame"), held) });
	s.warm(["a", "c"]);
	const run = idleQueue.shift()();
	await flush();
	expect(log).toEqual(["cover", "show:a", "frame"]);
	s.abort();
	release();
	await run;
	expect(log).toEqual(["cover", "show:a", "frame", "park:a", "uncover"]);
	expect(log.includes("snap:a")).toBe(false);
	expect(log.includes("snap:c")).toBe(false);
});

test("no warm-up starts while a gesture is in flight; it is retried after", async () => {
	const s = make();
	gestureActive = true;
	s.warm(["a"]);
	await runIdle();
	expect(log).toEqual([]);
	gestureActive = false;
	s.resume();
	await runIdle();
	expect(log).toContain("snap:a");
});

test("a failed snapshot never leaves a page shown or the screen covered", async () => {
	fail = true;
	const s = make();
	s.warm(["a"]);
	await runIdle();
	expect(log).toEqual(["cover", "show:a", "frame", "snap:a", "park:a", "uncover"]);
});

test("warming the same page twice in a row is one warm-up", async () => {
	const s = make();
	s.warm(["a"]);
	s.warm(["a"]);
	await runIdle();
	expect(log.filter((x) => x === "snap:a").length).toBe(1);
});

test("dirty pages are re-warmed, clean ones are not", async () => {
	const s = make();
	s.warm(["a"]);
	await runIdle();
	log.length = 0;
	s.warmIfStale(["a", "c"]);
	await runIdle();
	expect(log.filter((x) => x.startsWith("snap:"))).toEqual(["snap:c"]);
	log.length = 0;
	s.dirty("a");
	s.warmIfStale(["a", "c"]);
	await runIdle();
	expect(log.filter((x) => x.startsWith("snap:"))).toEqual(["snap:a"]);
});

// ---- not on every selection: quiet window, one page per task ----

test("nothing warms until the app has been input-quiet; activity pushes the warm-up back", async () => {
	let quietFor = 50; // ms since the last selection / gesture / mutation
	const s = make({ quietMs: () => quietFor });
	s.warm(["a"]);
	await runIdle(3);
	expect(log).toEqual([]); // too soon: a selection just happened
	expect(idleQueue.length).toBe(1); // it re-armed itself instead of dropping the request
	quietFor = 400;
	await runIdle();
	expect(log).toContain("snap:a");
});

test("each idle task warms ONE page and hands the thread back before the next", async () => {
	const s = make({ quietMs: () => 1000 });
	s.warm(["b", "c", "a"]);
	await idleQueue.shift()();
	expect(log.filter((x) => x.startsWith("snap:"))).toEqual(["snap:b"]);
	expect(idleQueue.length).toBe(1); // the rest is queued as a new task, not run back to back
	await runIdle();
	expect(log.filter((x) => x.startsWith("snap:"))).toEqual(["snap:b", "snap:c", "snap:a"]);
});

test("a cover is raised once for a run of pages and lifted only after the last one", async () => {
	const s = make({ quietMs: () => 1000 });
	s.warm(["c", "a"]);
	await runIdle();
	expect(log.filter((x) => x === "cover").length).toBe(1);
	expect(log.filter((x) => x === "uncover").length).toBe(1);
	expect(log.at(-1)).toBe("uncover");
	expect(log.indexOf("uncover")).toBeGreaterThan(log.lastIndexOf("snap:a"));
});

test("a selection does not make fresh pages stale: only a change inside a page does", async () => {
	const s = make({ quietMs: () => 1000 });
	s.warm(["a", "b", "c"]);
	await runIdle();
	log.length = 0;
	s.warmIfStale(["a", "b", "c"]); // what a selection triggers
	await runIdle();
	expect(log).toEqual([]);
	s.dirty("c");
	s.warmIfStale(["a", "b", "c"]);
	await runIdle();
	expect(log.filter((x) => x.startsWith("snap:"))).toEqual(["snap:c"]);
});
