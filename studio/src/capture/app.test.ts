import { describe, expect, test } from "bun:test";
import { appEnv } from "./app.ts";

describe("appEnv (the instance Studio spawns)", () => {
	// Incident: capture instances opened a normal window on the user's desktop (and took focus) while recording.
	test("it is an agent instance: it can never show on the user's desktop", () => {
		expect(appEnv("/tmp/s/home", "/tmp/s/hostd", "/tmp/s/atlas", "/usr/bin").ATLAS_AGENT).toBe("1");
	});

	test("home and hostd are the scratch ones, never inherited from the caller", () => {
		const e = appEnv("/tmp/s/home", "/tmp/s/hostd", "/tmp/s/atlas", "/usr/bin");
		expect(e.HOME).toBe("/tmp/s/home");
		expect(e.ATLAS_HOSTD_DIR).toBe("/tmp/s/hostd");
		expect(Object.keys(e).sort()).toEqual(["ATLAS_AGENT", "ATLAS_BIN", "ATLAS_HOSTD_DIR", "HOME", "LANG", "PATH", "SHELL", "TERM"]);
	});
});
