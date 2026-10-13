<script lang="ts">
	/**
	 * Mounts `children` when the browser is idle, or at once when `now` is true; once mounted it stays.
	 *
	 * For UI nobody can reach yet: overlays (menus, drawers, dialogs, popovers) in a space layer that is
	 * mounted beside the current one. Each overlay of the UI kit is a Portal with its own watcher and an
	 * imperative root under `<body>`; a layer carries about fifteen, and building them inside the commit of
	 * a space switch cost ~10 ms of main thread. Waiting for idle moves that off the switch; `now` (the layer
	 * became current) builds them in the same flush, so nothing is ever missing when it matters.
	 *
	 * "Idle" is `idleQueue` (WKWebView has no `requestIdleCallback`): one item per task, after a quiet window, so a layer's
	 * deferred overlays never land in one chunk next to a switch. `idle={false}`: only on `now`.
	 */
	import type { Snippet } from "svelte";
	import { idleQueue } from "#lib/idleQueue.ts";

	let {
		now = false,
		idle = true,
		children,
		fallback,
	}: {
		now?: boolean;
		/** Also mount when the browser is idle (default). `false`: only when `now`. */
		idle?: boolean;
		children: Snippet;
		/** Shown until `children` mounts: a box of the final size, so mounting shifts nothing. */
		fallback?: Snippet;
	} = $props();
	let ready = $state(false);
	// `now` renders in the very flush it turns true; `ready` keeps it afterwards.
	$effect(() => {
		if (now) ready = true;
	});
	$effect(() => {
		if (ready || now || !idle) return;
		// One item per task, after the page has been quiet: never in the task of a space switch (`idleQueue`).
		return idleQueue.add(() => (ready = true));
	});
</script>

{#if ready || now}{@render children()}{:else}{@render fallback?.()}{/if}
