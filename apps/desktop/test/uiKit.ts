// @ts-nocheck bun test runtime types are not part of the app tsconfig
/**
 * The one mock of `@codeatlasdev/ui` for component tests (the real kit is bits-ui, which bun cannot load).
 *
 * `bun test` runs every file in one process and a module mock is process-wide: two files that each mocked the
 * kit with their own shape made whichever loaded first win, and `Tip.test.ts` failed with "Export named
 * 'Tooltip' not found" in the full run while passing alone. Every file that needs the kit calls this instead of
 * `mock.module("@codeatlasdev/ui", …)` itself. The Tooltip stub is a `.svelte` file, so it is only loaded on
 * request: a suite that stubs the runes by hand (workspace.test.ts) must not compile a component.
 */
import { mock } from "bun:test";

export async function installUiKit({ tooltip = false } = {}) {
	const Tooltip = tooltip ? (await import("./TooltipStub.svelte")).default : undefined;
	mock.module("@codeatlasdev/ui", () => ({ Tooltip, toast: { error() {}, info() {} } }));
}
