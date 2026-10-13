// Lifecycle of one isolated Atlas Desktop capture: scratch HOME + hostd dir + seeded projects, the debug bundle
// spawned by us, then either a coded scene (driven through the debug bridge while the app's OWN native recorder
// writes the video: `atlas desktop capture start|stop`) or a declarative recipe (`atlas desktop record --script`, run
// inside the app), then teardown of exactly the processes we started and removal of the scratch dir (always).
// No external recorder and no window focus: ScreenCaptureKit runs inside the app, on its own window.
//
// Isolation: the instance runs with its own HOME (so `~/.atlas/desktop-debug.sock`, projects.json, settings, hook
// endpoint are all separate from the user's app) and its own ATLAS_HOSTD_DIR (so it never attaches to the user's
// `atlas hostd`). We never touch a process we did not spawn or find under our scratch HOME.

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { registerAsset } from "../lib/assets.ts";
import { run } from "../lib/exec.ts";
import { REPO, STUDIO, StudioError } from "../lib/paths.ts";
import { makeCtx, sleep, type Ctx, type Scene, type SceneEnv } from "./ctx.ts";
import { staleReason } from "./fresh.ts";
import { DEFAULT_INSTANCE, type InstanceProfile } from "../run/recipe.ts";
import { desktopVersion, homeFiles } from "./settings.ts";

const HERE = join(STUDIO, "src/capture");
const BUNDLE_BUILT = join(REPO, "target/debug/bundle/macos/Atlas.app/Contents/MacOS/atlas-desktop");
const ATLAS_BUILT = join(REPO, "target/debug/atlas");
/** Canonical short scratch root (macOS /tmp -> /private/tmp). */
const SCRATCH = realpathSync("/tmp");
const BUILD_HINT =
	"build it from the repo root:\n  cargo build -p atlas-cli && codesign -f -s - target/debug/atlas\n  bun run desktop:build:app   (debug app at target/debug/bundle/macos/Atlas.app; no DMG)";

/** Projects the 1.0 film's sidebar showed, in sidebar order. orbit-shop is the demo stack; the rest are one-service stacks. */
const SIDE_PROJECTS = [
	{ name: "lumen-app", port: 4200, hue: 330 },
	{ name: "nova-docs", port: 4300, hue: 95 },
	{ name: "pulse-api", port: 4400, hue: 285 },
] as const;
/** Worktrees of orbit-shop and the branch each one carries (offsets 100/200/300 are assigned by the app). */
export const ORBIT_WORKTREES = [
	{ name: "checkout-shipping", prompt: "Add shipping cost to checkout total" },
	{ name: "fix-stripe-timeout", prompt: "Retry stripe timeouts with backoff" },
	{ name: "cart-empty-state", prompt: "Design an empty cart state" },
] as const;

const git = (cwd: string, ...args: string[]) =>
	run(["git", "-c", "user.name=Atlas Studio", "-c", "user.email=studio@atlas.invalid", "-c", "commit.gpgsign=false", ...args], { cwd });

function seedProject(root: string, name: string, yaml: string) {
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "atlas.yaml"), yaml);
	writeFileSync(join(root, "README.md"), `# ${name}\n`);
	writeFileSync(join(root, ".gitignore"), ".logs/\n");
}

function sideYaml(name: string, port: number): string {
	return `name: ${name}
services:
  app:
    command: "while true; do echo tick; sleep 1; done"
    port: ${port}
    ready_log: tick
`;
}

/** What the scene needs from a scratch run; `app` resolves paths and facts, `stop` tears down. */
interface Instance {
	env: SceneEnv;
	/** Pid of the atlas-desktop we spawned. */
	pid: number;
	tmp: string;
}

async function seed(tmp: string, atlasBin: string, profile: InstanceProfile): Promise<SceneEnv> {
	const home = join(tmp, "home");
	const projects = join(tmp, "projects");
	mkdirSync(join(home, ".atlas/desktop"), { recursive: true });
	mkdirSync(join(tmp, "hostd"), { recursive: true });
	mkdirSync(projects, { recursive: true });
	for (const f of homeFiles(desktopVersion(), profile)) {
		mkdirSync(dirname(join(home, f.path)), { recursive: true });
		writeFileSync(join(home, f.path), f.content);
	}
	if (!profile.projects) return { projects: {}, home, atlasBin, assets: join(HERE, "assets"), fakeAgentDir: join(HERE, "fakeagent") };
	const roots: Record<string, string> = {};
	const orbit = join(projects, "orbit-shop");
	// orbit-shop = demo/atlas.yaml + the quiet infra of the film's panel (database, search: memory-wavy stand-ins) that
	// migrate waits for. `payments` crash-loops by design in the demo stack.
	const assets = join(HERE, "assets");
	const infra = `  database:
    command: "python3 ${assets}/memhog.py 40 0.05 1 & while true; do echo 'checkpoint complete: wrote 42 buffers'; sleep 4; done"
    port: 54320
    ready_log: checkpoint
  search:
    command: "python3 ${assets}/memhog.py 30 0.04 2 & while true; do echo 'query \\"running shoes\\" 14ms'; sleep 2.2; done"
    depends_on: { database: log_ready }
`;
	const demo = readFileSync(join(REPO, "demo/atlas.yaml"), "utf8");
	const orbitYaml = demo.replace("services:\n", `services:\n${infra}`).replace("    oneshot: true\n", "    oneshot: true\n    depends_on: { database: log_ready }\n");
	seedProject(orbit, "orbit-shop", orbitYaml);
	roots["orbit-shop"] = orbit;
	for (const p of SIDE_PROJECTS) {
		roots[p.name] = join(projects, p.name);
		seedProject(roots[p.name]!, p.name, sideYaml(p.name, p.port));
	}
	for (const root of Object.values(roots)) {
		await git(root, "init", "-q", "-b", "main");
		await git(root, "add", "-A");
		await git(root, "commit", "-q", "-m", "initial commit");
	}
	// git worktree + the app's own bookkeeping both want canonical paths (macOS /var -> /private/var)
	for (const k of Object.keys(roots)) roots[k] = realpathSync(roots[k]!);
	return { projects: roots, home, atlasBin, assets: join(HERE, "assets"), fakeAgentDir: join(HERE, "fakeagent") };
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const v = await probe().catch(() => undefined);
		if (v !== undefined) return v;
		if (Date.now() > deadline) throw new StudioError(`timed out waiting for ${what}`, `${timeoutMs / 1000}s`);
		await sleep(300);
	}
}

/** Reply of `atlas desktop debug info` (crates/atlas-desktop/src/debug.rs). */
interface BridgeInfo {
	pid: number;
	window_id: number;
	visible: boolean;
}

/** `atlas desktop debug info` against the isolated instance (HOME decides which socket), or undefined while it is not up. */
async function bridgeInfo(env: SceneEnv): Promise<BridgeInfo | undefined> {
	const { code, out } = await run([env.atlasBin, "desktop", "debug", "info"], { env: { HOME: env.home }, allowFail: true });
	if (code !== 0) return undefined;
	const info: BridgeInfo = JSON.parse(out); // our own CLI's output: a flat object with exactly these fields
	return info;
}

/**
 * The environment of the instance Studio spawns. `ATLAS_AGENT=1` makes it an agent instance (debug build): no Dock
 * icon, never focused, window on a private virtual display, so a capture can never appear on the user's desktop.
 * HOME and ATLAS_HOSTD_DIR isolate everything else (the bridge socket lives under HOME).
 */
export function appEnv(home: string, hostdDir: string, atlasBin: string, path: string): Record<string, string> {
	return { HOME: home, ATLAS_HOSTD_DIR: hostdDir, ATLAS_AGENT: "1", ATLAS_BIN: atlasBin, PATH: path, SHELL: "/bin/zsh", TERM: "xterm-256color", LANG: "en_US.UTF-8" };
}

/** Pids of one scratch stack: its runner (`.logs/.tui.lock`) and the services it spawned (`.logs/.pids`). Exact pids only. */
function stackPids(root: string): number[] {
	const pids: number[] = [];
	for (const f of [".tui.lock", ".pids"]) {
		const file = join(root, ".logs", f);
		if (!existsSync(file)) continue;
		for (const word of readFileSync(file, "utf8").split(/\s+/)) {
			const pid = Number(word);
			if (Number.isInteger(pid) && pid > 1) pids.push(pid);
		}
	}
	return pids;
}

/** Stop only what we started: the stacks under our scratch (`atlas down`, then exact-pid SIGTERM of what is left), the app, our hostd. */
async function teardown(inst: Instance | null, tmp: string, appProc: Subprocess | null) {
	const atlas = join(tmp, "bin/atlas");
	const hostdDir = join(tmp, "hostd");
	const hostdPid = existsSync(join(hostdDir, "hostd.pid")) ? Number(readFileSync(join(hostdDir, "hostd.pid"), "utf8").trim()) : 0;
	if (inst) {
		for (const root of Object.values(inst.env.projects)) {
			const pids = stackPids(root); // read before `down` removes the lock
			await run([inst.env.atlasBin, "down", "--dir", root], { env: { HOME: inst.env.home }, allowFail: true });
			await sleep(300);
			// a recycled pid must not be hit: only kill what still runs from our scratch dir
			for (const pid of pids) if (await runsUnder(pid, tmp)) process.kill(pid, "SIGTERM");
		}
	}
	if (appProc) {
		appProc.kill("SIGTERM");
		await Promise.race([appProc.exited, sleep(5000)]);
		if (alive(appProc.pid)) appProc.kill("SIGKILL");
	}
	if (hostdPid > 1) {
		await run([atlas, "hostd", "--stop", "--dir", hostdDir], { env: { ATLAS_HOSTD_DIR: hostdDir }, allowFail: true });
		await sleep(500);
		if (alive(hostdPid)) process.kill(hostdPid, "SIGTERM");
	}
	await killUnder(tmp);
	// never remove anything but our own mkdtemp dir
	if (!tmp.startsWith(`${SCRATCH}/atlas-studio-`) || tmp.includes("..")) throw new StudioError(`refusing to remove ${tmp}`, "not a scratch dir of this capture");
	rmSync(tmp, { recursive: true, force: true });
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** True when `pid` is alive and its command line mentions `dir`. */
async function runsUnder(pid: number, dir: string): Promise<boolean> {
	const { out } = await run(["ps", "-o", "command=", "-p", String(pid)], { allowFail: true });
	return out.includes(dir);
}

/** Exact-pid SIGTERM of any leftover process whose command line mentions our scratch dir (service shells, memhog…). */
async function killUnder(tmp: string) {
	const { out } = await run(["ps", "-axo", "pid=,command="], { allowFail: true });
	for (const line of out.split("\n")) {
		const m = /^\s*(\d+)\s+(.*)$/.exec(line);
		if (!m || !m[2]!.includes(tmp) || Number(m[1]) === process.pid) continue;
		try {
			process.kill(Number(m[1]), "SIGTERM");
		} catch {
			// already gone
		}
	}
}

export interface AppCaptureOpts {
	/** Manifest key to register under; default `rec:<scene>`. */
	as?: string;
}

/** What `atlas desktop capture stop` reports (crates/atlas-desktop/src/capture/mod.rs). */
export interface StopReport {
	out: string;
	width: number;
	height: number;
	fps: number;
	frames: number;
	duration_ms: number;
	wall_ms: number;
	max_gap_ms: number;
	avg_fps: number;
	bytes: number;
	first_frame_offset_ms: number | null;
}

/** Bring up an isolated instance with its stores loaded and the seeded projects visible; hand it to `body`; tear down. */
export async function withInstance<T>(profile: InstanceProfile, body: (env: SceneEnv, ctx: Ctx, atlas: string, tmp: string) => Promise<T>): Promise<T> {
	for (const [what, path] of [
		["the debug bundle", BUNDLE_BUILT],
		["the atlas CLI", ATLAS_BUILT],
	] as const) {
		if (!existsSync(path)) throw new StudioError(`${what} is missing: ${path}`, BUILD_HINT);
	}
	// a bundle embeds the frontend at build time: an old one records an old UI without any sign of it
	const stale = process.env.ATLAS_STUDIO_ALLOW_STALE ? undefined : staleReason(BUNDLE_BUILT, [join(REPO, "apps/desktop/src"), join(REPO, "crates/atlas-desktop/src"), join(REPO, "crates/atlas-core/src")]);
	if (stale) throw new StudioError(stale, `rebuild it: ${BUILD_HINT.split("\n").pop()?.trim()}   (or set ATLAS_STUDIO_ALLOW_STALE=1 to record from it anyway)`);
	// /tmp (= /private/tmp) keeps the project path short on screen; the Panel prints it
	const tmp = realpathSync(mkdtempSync(join(SCRATCH, "atlas-studio-")));
	let appProc: Subprocess | null = null;
	let inst: Instance | null = null;
	try {
		// private copies: a `cargo build`/`clean` running elsewhere cannot pull the binaries out from under the capture
		mkdirSync(join(tmp, "bin"));
		const atlas = join(tmp, "bin/atlas");
		const desktop = join(tmp, "bin/atlas-desktop");
		copyFileSync(ATLAS_BUILT, atlas);
		copyFileSync(BUNDLE_BUILT, desktop);
		const env = await seed(tmp, atlas, profile);
		const fakePath = [env.fakeAgentDir, "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", join(process.env.HOME ?? "", ".bun/bin")].join(":");
		chmodSync(join(env.fakeAgentDir, "omp"), 0o755);
		appProc = Bun.spawn([desktop], {
			env: appEnv(env.home, join(tmp, "hostd"), atlas, fakePath),
			stdin: "ignore",
			stdout: Bun.file(join(tmp, "app.log")),
			stderr: Bun.file(join(tmp, "app.log")),
		});
		inst = { env, pid: appProc.pid, tmp };

		// the bridge answers once the window and webview exist; the stores appear after the layout's onMount
		const info = await waitFor("the debug bridge", 60_000, () => bridgeInfo(env));
		if (info.pid !== appProc.pid) throw new StudioError(`debug bridge answered for pid ${info.pid}, not our app (${appProc.pid})`, "refusing to drive a foreign instance");
		const { ctx, close } = await makeCtx(env.home, env);
		try {
			await waitFor("the app stores", 60_000, async () => {
				const ok = await ctx.eval<boolean>(`return !!window.__atlas && window.__atlas.ws.loaded && window.__atlas.store.loaded`);
				return ok ? true : undefined;
			});
			for (const root of Object.values(env.projects)) {
				await ctx.eval(`await window.__TAURI_INTERNALS__.invoke("projects_add", { root: ${JSON.stringify(root)} }); await window.__atlas.store.refresh(); return 1`);
			}
			await ctx.eval(`await window.__atlas.store.refresh(); return window.__atlas.store.projects.length`);
			if (profile.projects) {
				await waitFor("the seeded projects in the sidebar", 20_000, async () =>
					(await ctx.eval<number>(`return window.__atlas.ws.doc.worktrees.length`)) >= Object.keys(env.projects).length ? true : undefined
				);
			}
			return await body(env, ctx, atlas, tmp);
		} finally {
			close();
		}
	} finally {
		await teardown(inst, tmp, appProc);
	}
}

/** `atlas desktop <args>` against the isolated instance (its HOME selects the sockets); stdout parsed as JSON. */
export async function appCli<T>(env: SceneEnv, args: string[]): Promise<T> {
	const { out } = await run([env.atlasBin, "desktop", ...args], { env: { HOME: env.home } });
	const parsed: T = JSON.parse(out); // our own CLI prints one JSON document
	return parsed;
}

export async function provenance(atlas: string, extra: Record<string, unknown>) {
	const { out: ver } = await run([atlas, "version"]);
	const { out: sha } = await run(["git", "rev-parse", "--short", "HEAD"], { cwd: REPO });
	return { atlasVersion: /atlas (\S+)/.exec(ver)?.[1], gitSha: sha.trim(), ...extra };
}

/** Run one coded scene end to end and register the recording. Returns the registered key. */
export async function captureScene(scene: Scene, opts: AppCaptureOpts = {}): Promise<string> {
	return withInstance(DEFAULT_INSTANCE, async (env, ctx, atlas, tmp) => {
		await scene.setup?.(ctx);
		const out = join(tmp, `${scene.id}.mov`);
		await appCli(env, ["capture", "start", out, "--fps", "60"]);
		let report: StopReport;
		try {
			await scene.body(ctx);
		} finally {
			report = await appCli<StopReport>(env, ["capture", "stop"]);
		}
		const key = opts.as ?? `rec:${scene.id}`;
		await registerAsset(key, "recording", out, `bun studio capture app ${scene.id}`, await provenance(atlas, { seconds: scene.seconds, pacing: pacing(report) }));
		return key;
	});
}

const pacing = (r: StopReport) => ({ frames: r.frames, avgFps: Math.round(r.avg_fps * 10) / 10, maxGapMs: Math.round(r.max_gap_ms), width: r.width, height: r.height });

/** What one script run produced (the app writes video.mov, timeline.json and shots/ under `outDir`). */
export interface ScriptRun {
	outDir: string;
	video: string;
	timelineFile: string;
	shots: string[];
}

/** Run a validated script inside an already-running instance (`atlas desktop record`) and return where the output is. */
export async function runScriptIn(env: SceneEnv, script: unknown, outDir: string): Promise<ScriptRun> {
	mkdirSync(outDir, { recursive: true });
	const scriptFile = join(outDir, "script.json");
	writeFileSync(scriptFile, JSON.stringify(script));
	await run([env.atlasBin, "desktop", "record", "--script", scriptFile, "--out", outDir], { env: { HOME: env.home } });
	const shotsDir = join(outDir, "shots");
	const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => f.endsWith(".png")).sort() : [];
	return { outDir, video: join(outDir, "video.mov"), timelineFile: join(outDir, "timeline.json"), shots: shots.map((f) => join(shotsDir, f)) };
}
