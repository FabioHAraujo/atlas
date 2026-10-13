// Incident (three agent instances started together; one window showed on the user's built-in display): starts must be
// serialized. The lock lives in `atlas desktop --agent` (desktop_agent.rs `StartLock`, flock on <tmp>/atlas-agent.lock);
// the wrapper script must reach the app only through that command, never launch the bundle itself.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sh = readFileSync(join(import.meta.dir, "desktop-agent.sh"), "utf8");
const code = sh
	.split("\n")
	.filter((l) => !l.trim().startsWith("#"))
	.join("\n");

describe("desktop-agent.sh serializes through the CLI start lock", () => {
	test("the app is started only by `atlas desktop --agent` (which takes the flock)", () => {
		expect(code).toMatch(/exec "\$ATLAS" desktop --agent "\$@"/);
		// the bundle path is only tested for existence, never executed
		expect(code).not.toMatch(/exec "\$APP"|^\s*"\$APP"|open -a|open "/m);
	});

	test("the CLI start takes the lock before it creates a display (source guard)", () => {
		const rs = readFileSync(join(import.meta.dir, "../crates/atlas-cli/src/commands/desktop_agent.rs"), "utf8");
		const start = rs.slice(rs.indexOf("pub fn start("));
		expect(start.indexOf("StartLock::acquire")).toBeGreaterThan(-1);
		expect(start.indexOf("StartLock::acquire")).toBeLessThan(start.indexOf("cmd.spawn()") > -1 ? start.indexOf("cmd.spawn()") : start.indexOf(".spawn()"));
	});
});
