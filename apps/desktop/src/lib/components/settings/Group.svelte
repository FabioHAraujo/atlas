<script lang="ts">
	/** Bordered, raised container whose direct `Row`s are separated by hairlines. */
	import type { Snippet } from "svelte";

	let { children, class: cls = "" }: { children: Snippet; class?: string } = $props();
</script>

<div class="group {cls}">{@render children()}</div>

<style>
	.group {
		border-radius: 10px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: var(--ca-surface-raised);
	}
	.group :global(.srow + .srow) {
		border-top: 0.5px solid var(--ca-outline-subtle);
	}
</style>
