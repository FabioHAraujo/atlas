<script lang="ts">
	/** Heading of a settings block on a page; later blocks get a hairline above. */
	import type { Snippet } from "svelte";

	let {
		title,
		first = false,
		setting,
		children,
	}: {
		title: string;
		first?: boolean;
		/** `data-setting` id for search-result flashing. */
		setting: string;
		/** Optional description under the title. */
		children?: Snippet;
	} = $props();
</script>

<div class="gtitle" class:first data-setting={setting}>
	<h3>{title}</h3>
	{#if children}<p>{@render children()}</p>{/if}
</div>

<style>
	/* Heading of a block that holds several groups: stronger than a Group title, with a hairline above. */
	.gtitle {
		margin-top: 12px;
		padding-top: 22px;
		border-top: 0.5px solid var(--ca-outline-subtle);
	}
	.gtitle.first {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	p {
		margin: 4px 0 0;
		max-width: 72ch;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ca-text-secondary);
	}
</style>
