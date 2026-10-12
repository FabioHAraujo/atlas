<script lang="ts">
	/**
	 * Keeps a dialog-like component out of the startup bundle: its module is fetched the first
	 * time `when` is truthy (the open flag), then it stays mounted, so closing animates as before.
	 * It renders once the module arrives (a few ms for a local chunk), still inside the open flag.
	 */
	import type { Component } from "svelte";

	let { when, load }: { when: boolean; load: () => Promise<{ default: Component }> } = $props();

	let View = $state<Component>();
	let requested = false;

	$effect(() => {
		if (!when || requested) return;
		requested = true;
		void load().then((m) => (View = m.default));
	});
</script>

{#if View}<View />{/if}
