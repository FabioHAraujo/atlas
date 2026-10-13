import { describe, expect, test } from "bun:test";
import { demoLaunchers, desktopVersion, homeFiles, seedSettings } from "./settings.ts";

describe("seedSettings", () => {
	test("lastSeen equals the running app version, so no 'Updated to X' toast lands in a recording", () => {
		const s = seedSettings("1.3.0") as { updates: { lastSeen: string; auto: boolean } };
		expect(s.updates.lastSeen).toBe("1.3.0");
		expect(s.updates.auto).toBe(false);
	});

	test("onboarding, tour and checklist are marked done so no first-run UI covers the product", () => {
		const s = seedSettings("1.3.0") as { onboarding: { done: boolean; toured: boolean; checklist: { dismissed: boolean } } };
		expect(s.onboarding.done && s.onboarding.toured && s.onboarding.checklist.dismissed).toBe(true);
	});

	test("recipes that film the onboarding itself can switch it back on", () => {
		const s = seedSettings("1.3.0", { onboarding: false }) as { onboarding: { done: boolean } };
		expect(s.onboarding.done).toBe(false);
	});
});

describe("desktopVersion", () => {
	test("reads the version of the crate the capture actually runs (not a constant in the studio)", () => {
		expect(desktopVersion()).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("homeFiles (what a scratch HOME starts with)", () => {
	const files = (o: { projects: boolean; onboarding: boolean }) => Object.fromEntries(homeFiles("1.3.0", o).map((f) => [f.path, f.content]));

	test("a first-run profile has an EMPTY project registry and the onboarding flow switched on", () => {
		const f = files({ projects: false, onboarding: true });
		expect(JSON.parse(f[".atlas/desktop/projects.json"]!)).toEqual([]);
		expect((JSON.parse(f[".atlas/desktop/settings.json"]!) as { onboarding: { done: boolean } }).onboarding.done).toBe(false);
	});

	test("the registry file exists even for the seeded profile's start (the app must not fall back to anything on this Mac)", () => {
		expect(Object.keys(files({ projects: true, onboarding: false }))).toContain(".atlas/desktop/projects.json");
	});

	test("the omp-integration marker is always planted: no banner covers the welcome screen or the product", () => {
		expect(Object.keys(files({ projects: false, onboarding: true }))).toContain(".omp/plugins/node_modules/atlas-omp/extensions/atlas-status.ts");
	});

	test("every path is relative and stays inside the scratch HOME", () => {
		for (const { path } of homeFiles("1.3.0", { projects: false, onboarding: true })) {
			expect(path.startsWith("/") || path.includes("..")).toBe(false);
		}
	});
});

describe("demoLaunchers (the terminal demos a script starts with a fixed argv)", () => {
	// The script grammar's `terminal` step takes an argv, not env, and the scratch paths are random per run. The launcher
	// files carry the env, so a recipe can say ["bash", ".atlas-studio/term-demo"] and be the same text on every machine.
	const env = { assets: "/tmp/atlas-studio-x/assets", atlasBin: "/tmp/atlas-studio-x/bin/atlas", orbitRoot: "/tmp/atlas-studio-x/projects/orbit-shop" };
	const files = Object.fromEntries(demoLaunchers(env).map((f) => [f.path, f]));

	test("each launcher exports the env its demo requires and execs the demo", () => {
		expect(files[".atlas-studio/term-demo"]!.content).toContain(`TERM_DEMO_IMAGE='${env.assets}/orbit-small.png'`);
		expect(files[".atlas-studio/term-demo"]!.content).toContain(`exec bash '${env.assets}/term-demo.sh'`);
		const mcp = files[".atlas-studio/mcp-demo"]!.content;
		expect(mcp).toContain(`ATLAS_BIN='${env.atlasBin}'`);
		expect(mcp).toContain(`MCP_DEMO_DIR='${env.orbitRoot}'`);
		expect(mcp).toContain(`exec python3 '${env.assets}/mcp-demo.py'`);
	});

	test("a path with a quote cannot break out of the shell string", () => {
		const evil = demoLaunchers({ ...env, assets: "/tmp/it's" });
		expect(evil[0]!.content).toContain(`'/tmp/it'\\''s/orbit-small.png'`);
	});

	test("the launchers hold the final screen long enough for a 14 s loop, and live inside the scratch HOME", () => {
		for (const f of demoLaunchers(env)) {
			expect(f.content).toMatch(/_HOLD=20/);
			expect(f.path.startsWith("/") || f.path.includes("..")).toBe(false);
		}
	});
});
