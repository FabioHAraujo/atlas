import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { StudioError } from "../lib/paths.ts";
import { enforce } from "./gate.ts";
import { lintFile } from "./index.ts";

const fixture = (n: string) => join(import.meta.dir, "__fixtures__", n);

describe("the gate that `studio check` and `studio publish` share", () => {
	test("enforce throws a StudioError carrying the diagnostic code, its pixel rect and the suggested fix", async () => {
		const r = await lintFile(fixture("poster-cropped-top.jpg"), { profile: "still", fast: true });
		let err: unknown;
		try {
			enforce([r], "film-poster.jpg");
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(StudioError);
		const e = err as StudioError;
		expect(e.message).toContain("1 lint error");
		expect(e.hint).toContain("frame/window-cropped");
		expect(e.hint).toMatch(/@ \d+,\d+ \d+x\d+/);
		expect(e.hint).toContain("fix:");
	});

	test("a clean picture passes the gate", async () => {
		const r = await lintFile(fixture("window-only-shot.jpg"), { profile: "still", fast: true });
		expect(() => enforce([r], "clean")).not.toThrow();
	});

	test("warnings never fail the gate", () => {
		const r = {
			version: 1 as const,
			target: { file: "x.mp4", kind: "video" as const, profile: "site", width: 1, height: 1 },
			diagnostics: [{ severity: "warning" as const, code: "spec/bitrate", message: "high" }],
			skipped: [],
			summary: { errors: 0, warnings: 1, infos: 0 },
		};
		expect(() => enforce([r], "w")).not.toThrow();
	});
});

describe("`bun studio lint --json` is the LSP-style contract agents read", () => {
	test("exit code 1 and JSON diagnostics with severity, code, message, rect and fix for the cropped poster", async () => {
		const p = Bun.spawn(["bun", join(import.meta.dir, "../cli.ts"), "lint", fixture("poster-cropped-top.jpg"), "--profile", "still", "--json", "--fast"], { stdout: "pipe", stderr: "pipe" });
		const out = await new Response(p.stdout as ReadableStream).text();
		expect(await p.exited).toBe(1);
		const j = JSON.parse(out) as { version: number; target: { profile: string }; diagnostics: Array<{ severity: string; code: string; message: string; rect: { x: number; y: number; w: number; h: number }; fix: { action: string; params: { side: string } } }>; summary: { errors: number } };
		expect(j.version).toBe(1);
		expect(j.summary.errors).toBe(1);
		const d = j.diagnostics.find((x) => x.code === "frame/window-cropped")!;
		expect([d.severity, d.code, d.fix.action, d.fix.params.side]).toEqual(["error", "frame/window-cropped", "reframe", "top"]);
		expect(d.rect.w).toBeGreaterThan(0);
	});

	test("exit code 0 for a clean file", async () => {
		const p = Bun.spawn(["bun", join(import.meta.dir, "../cli.ts"), "lint", fixture("window-only-shot.jpg"), "--profile", "still", "--json", "--fast"], { stdout: "pipe", stderr: "pipe" });
		await new Response(p.stdout as ReadableStream).text();
		expect(await p.exited).toBe(0);
	});

	test("lint with no argument is a usage error with a hint, not a stack trace", async () => {
		const p = Bun.spawn(["bun", join(import.meta.dir, "../cli.ts"), "lint"], { stdout: "pipe", stderr: "pipe" });
		const err = await new Response(p.stderr as ReadableStream).text();
		expect(await p.exited).toBe(1);
		expect(err).toContain("lint needs a film id");
		expect(err).not.toContain("at ");
	});
});

import { guessProfile, resolveTargets } from "./index.ts";
import { checkBlack } from "./checks-video.ts";
import { checkSpec } from "./checks-video.ts";
import { PROFILES } from "./profiles.ts";

describe("what `lint <dir>` picks up and how it judges it (found linting site/public/media)", () => {
	test("scrub sprites (-thumbs.jpg) are data for the player, not pictures: they are never linted", async () => {
		const t = await resolveTargets(join(import.meta.dir, "__fixtures__"));
		expect(t.map((x) => x.file).some((f) => f.includes("-thumbs"))).toBe(false);
	});

	test("a 16:10 silent loop is profiled as an in-page loop, not as a 16:9 social video", () => {
		expect(guessProfile("site/public/media/loop-agents.mp4", 1280, 800, "video")).toBe("site-loop");
		const loop = PROFILES["site-loop"]!;
		const d = checkSpec({ kind: "video", w: 1280, h: 800, duration: 14, fps: 30, vcodec: "h264", hasAudio: false, videoKbps: 400 }, loop);
		expect(d).toEqual([]);
	});

	test("a webm is the site player's sibling of the mp4: codec rules of the social upload do not apply to it", () => {
		expect(guessProfile("film-vertical.webm", 1080, 1920, "video")).toBe("site-sibling");
		const sib = PROFILES["site-sibling"]!;
		expect(checkSpec({ kind: "video", w: 1080, h: 1920, duration: 30, fps: 30, vcodec: "vp9", hasAudio: true, videoKbps: 1000 }, sib)).toEqual([]);
	});

	test("a 0.2 s dip to black between scenes is the film's own transition, not a black-frame defect", () => {
		expect(checkBlack([{ start: 72.87, end: 73.07 }], 77.9)).toEqual([]);
		expect(checkBlack([{ start: 72.87, end: 74.4 }], 77.9)).toHaveLength(1);
	});
});

describe("app-capture profiles do not judge the app's own typography", () => {
	test("site-loop and site-sibling carry no text rules: the whole frame is a recording of the real app", () => {
		expect(PROFILES["site-loop"]!.captured).toBe(true);
		expect(PROFILES["site-sibling"]!.captured).toBe(true);
		expect(PROFILES.still!.captured).toBeUndefined();
	});

	test("a loop poster full of app UI text yields no text findings", async () => {
		const r = await lintFile(join(import.meta.dir, "__fixtures__", "terminal-fullbleed.jpg"), { profile: "site-loop", fast: true });
		expect(r.diagnostics.filter((d) => d.code.startsWith("text/") || d.code.startsWith("safe-area/"))).toEqual([]);
	});
});
