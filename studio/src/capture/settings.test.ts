import { describe, expect, test } from "bun:test";
import { desktopVersion, homeFiles, seedSettings } from "./settings.ts";

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
