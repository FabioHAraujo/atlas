// Incident: the selection bench was written but never run, and nothing proved it fails when the budget is blown, so
// a regression back to ~45 ms stalls could have shipped behind a green script. `--judge <report.json>` re-judges a saved
// report without a webview; these tests run the real script as a process and check its exit code and message.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	summarize,
	type Sample,
} from "../apps/desktop/src/lib/debug/selectionBench.ts";

const script = join(import.meta.dir, "selection-bench.ts");
const dir = mkdtempSync(join(tmpdir(), "selbench-"));

const sample = (o: Partial<Sample> = {}): Sample => ({
	flushMs: 3,
	paintMs: 30,
	stallMs: 4,
	nodes: 80,
	records: 90,
	...o,
});
const report = (samples: Sample[], name: string) => {
	const p = join(dir, `${name}.json`);
	writeFileSync(p, JSON.stringify({ ...summarize(samples), samples }));
	return p;
};
const judge = (path: string, ...extra: string[]) => {
	const r = Bun.spawnSync(["bun", script, "--judge", path, ...extra], {
		stderr: "pipe",
		stdout: "pipe",
	});
	return {
		code: r.exitCode,
		err: r.stderr.toString(),
		out: r.stdout.toString(),
	};
};
const n = (len: number, f: (i: number) => Partial<Sample>) =>
	Array.from({ length: len }, (_, i) => sample(f(i)));

describe("a bench that did not exercise the pager is not a pass", () => {
	// Incident: after the app crashed ("Atlas hit an error") the bench still ran, mounted no layers, touched 0 nodes and
	// reported a spectacular pass.
	const withLayers = (layers: number, extra: object = {}) => {
		const p = join(dir, `layers-${layers}.json`);
		writeFileSync(
			p,
			JSON.stringify({ layers, samples: n(30, () => ({})), ...extra }),
		);
		return p;
	};
	test("no layers in the page: exit 1, naming the crash", () => {
		const r = judge(withLayers(0));
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/layers/);
	});
	test("a selection that touched nothing at all (the page did not react) is not a pass", () => {
		const r = judge(
			withLayers(3, { samples: n(30, () => ({ nodes: 0, records: 0 })) }),
		);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/nothing/i);
	});
	test("three layers and real work passes", () => {
		expect(judge(withLayers(3)).code).toBe(0);
	});
});

describe("the bench exits 1 over budget", () => {
	test("a report inside the budget exits 0", () => {
		expect(
			judge(
				report(
					n(30, () => ({})),
					"ok",
				),
			).code,
		).toBe(0);
	});
	test("the measured 'before' shape (stall 44, flush 9, a layer of nodes) exits 1 and names every metric", () => {
		const r = judge(
			report(
				n(30, () => ({ stallMs: 44, flushMs: 9, nodes: 378 })),
				"before",
			),
		);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/stall/);
		expect(r.err).toMatch(/flush/);
		expect(r.err).toMatch(/nodes/);
	});
	test("one metric over is enough: only nodes touched too high", () => {
		const r = judge(
			report(
				n(30, () => ({ nodes: 121 })),
				"nodes",
			),
		);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/nodes/);
		expect(r.err).not.toMatch(/stall/);
	});
	test("p95, not the mean: 3 slow selections out of 30 fail it; 1 does not", () => {
		expect(
			judge(
				report(
					n(30, (i) => ({ stallMs: i < 3 ? 60 : 2 })),
					"p95",
				),
				"--warmup",
				"0",
			).code,
		).toBe(1);
		expect(
			judge(
				report(
					n(30, (i) => ({ stallMs: i === 0 ? 60 : 2 })),
					"one",
				),
				"--warmup",
				"0",
			).code,
		).toBe(0);
	});
	test("an empty report never passes", () => {
		expect(judge(report([], "empty")).code).toBe(1);
	});
	test("--no-check reports the numbers but exits 0", () => {
		expect(
			judge(
				report(
					n(30, () => ({ stallMs: 44 })),
					"nocheck",
				),
				"--no-check",
			).code,
		).toBe(0);
	});
	test("warmup selections are dropped before judging: a slow start is the app starting, not a selection", () => {
		const samples = n(34, (i) => ({ stallMs: i < 4 ? 400 : 3 }));
		expect(judge(report(samples, "warm"), "--warmup", "4").code).toBe(0);
		expect(judge(report(samples, "cold"), "--warmup", "0").code).toBe(1);
	});
});
