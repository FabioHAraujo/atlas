<script lang="ts">
	/** A one-line notice row at the top of a pane (ended terminal, raw-protocol switch, empty tab). */
	import type { Snippet } from "svelte";

	let { children, onclick }: { children: Snippet; /** Renders a button when set. */ onclick?: () => void } =
		$props();
</script>

{#if onclick}
	<button class="notice" {onclick}>{@render children()}</button>
{:else}
	<div class="notice">{@render children()}</div>
{/if}

<style>
	.notice {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 12px;
		color: var(--ca-text-secondary);
		border-bottom: 0.5px solid var(--ca-outline-subtle);
	}
</style>
