// @ts-nocheck bun test runtime types are not part of the app tsconfig
// Guards the incident where src/lib/stores/workspace.test.ts replaced globalThis.document with a stub:
// bun runs every test file in ONE process, so DOM-dependent suites (debug/agent, editor/*) failed
// ("document.body is undefined") or passed depending only on which files ran before them.
import { expect, test } from "bun:test";

test("a real DOM exists without any test importing test/setup.ts (bunfig preload)", () => {
	expect(document.body).toBeDefined();
	document.body.innerHTML = "<p id=x>hi</p>";
	expect(document.getElementById("x")?.textContent).toBe("hi");
});

test("a test that stubs document restores it: the next file still sees happy-dom", async () => {
	const real = globalThis.document;
	const stub = { hasFocus: () => true };
	globalThis.document = stub;
	expect(globalThis.document).toBe(stub);
	globalThis.document = real;
	expect(document.body).toBeDefined();
});
