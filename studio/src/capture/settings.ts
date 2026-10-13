// What the isolated instance's settings.json holds. Pure, so the rules that keep recordings clean are tested.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, StudioError } from "../lib/paths.ts";

/** Version of the desktop crate the capture runs: the app compares it to `updates.lastSeen` to decide on "Updated to X". */
export function desktopVersion(): string {
	const toml = readFileSync(join(REPO, "crates/atlas-desktop/Cargo.toml"), "utf8");
	const v = /^version\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
	if (!v) throw new StudioError("could not read the atlas-desktop version", "crates/atlas-desktop/Cargo.toml has no version line");
	return v;
}

/**
 * Dev-build look, no first-run UI, no network update checks, and `lastSeen` = the running version so the app never
 * believes it was just updated. `onboarding: false` brings the first-run flow back (for recipes that film it).
 */
export function seedSettings(version: string, o: { onboarding?: boolean } = {}): object {
	const done = o.onboarding !== false;
	return {
		onboarding: { done, toured: done, checklist: { dismissed: done, done: [] } },
		updates: { auto: false, lastSeen: version, notified: null, skipped: null },
		sshHosts: [],
	};
}

/** A file to plant in the scratch HOME: a path relative to it and its text. */
export interface HomeFile {
	path: string;
	content: string;
}

/**
 * Everything a scratch HOME starts with. The project registry is always written (empty when the profile has no
 * projects): the app, and discovery's `$HOME`-scoped Spotlight/walk, then see nothing of this Mac. The omp marker
 * keeps the "Enable omp integration" banner off the welcome screen and the product.
 */
export function homeFiles(version: string, o: { projects: boolean; onboarding: boolean }): HomeFile[] {
	return [
		{ path: ".atlas/desktop/settings.json", content: JSON.stringify(seedSettings(version, { onboarding: !o.onboarding })) },
		{ path: ".atlas/desktop/projects.json", content: "[]" },
		{ path: ".omp/plugins/node_modules/atlas-omp/extensions/atlas-status.ts", content: "// scratch marker: the capture shows the integration as enabled\n" },
	];
}

/** POSIX single-quote a value: `it's` -> `'it'\''s'`. Paths come from mkdtemp, but a launcher must never trust that. */
const sq = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;

/**
 * Launchers for the two terminal demos. The script grammar's `terminal` step takes an argv and no env, and the scratch
 * paths are random per run, so each launcher carries the env and execs the demo: a recipe says
 * `["bash", ".atlas-studio/term-demo"]` and is the same text on every machine. They hold the final screen for 20 s.
 */
export function demoLaunchers(env: { assets: string; atlasBin: string; orbitRoot: string }): HomeFile[] {
	return [
		{ path: ".atlas-studio/term-demo", content: `export TERM_DEMO_IMAGE=${sq(`${env.assets}/orbit-small.png`)} TERM_DEMO_HOLD=20\nexec bash ${sq(`${env.assets}/term-demo.sh`)}\n` },
		{ path: ".atlas-studio/mcp-demo", content: `export ATLAS_BIN=${sq(env.atlasBin)} MCP_DEMO_DIR=${sq(env.orbitRoot)} MCP_DEMO_HOLD=20\nexec python3 ${sq(`${env.assets}/mcp-demo.py`)}\n` },
	];
}
