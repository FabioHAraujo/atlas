<script lang="ts">
	import type { Snippet } from "svelte";

	let { title, description, children }: { title?: string; description?: string; children: Snippet } =
		$props();
</script>

<section class="group">
	{#if title}
		<header>
			<h3>{title}</h3>
			{#if description}<p>{description}</p>{/if}
		</header>
	{/if}
	<div class="card">{@render children()}</div>
</section>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	header {
		padding: 0 2px;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: -0.005em;
		color: var(--ca-text-primary);
	}
	p {
		margin: 2px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--ca-text-secondary);
	}
	.card {
		border-radius: 12px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: var(--ca-surface-raised);
	}
	.card > :global(* + *) {
		border-top: 0.5px solid var(--ca-outline-subtle);
	}
</style>
