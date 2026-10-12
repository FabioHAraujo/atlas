import { invoke } from "@tauri-apps/api/core";
import { bootMark } from "#lib/boot.ts";
import { store } from "#lib/stores/projects.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";

/**
 * Tell Rust the window can be shown: the real theme is resolved and the registry and workspace
 * are in, so the first painted frame is the final layout (no skeleton, no default theme). Two
 * animation frames let Svelte flush and the compositor paint it. Rust shows the window anyway
 * after its own deadline (`boot.rs`), so a failing load never leaves it hidden.
 */
export function startReadyGate(): () => void {
	let sent = false;
	return $effect.root(() => {
		$effect(() => {
			if (sent || !themes.ready || !store.loaded || !ws.loaded) return;
			sent = true;
			bootMark("ready:gate");
			// Not after a frame: WebKit suspends rendering while the window is hidden, so a frame
			// would only ever come after the show. Svelte has flushed the DOM by the next task.
			setTimeout(() => void invoke("app_ready").catch(() => {}), 0);
		});
	});
}
