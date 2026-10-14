<script lang="ts">
	let { title, description }: { title: string; description?: string } = $props();
</script>

<header class="phead">
	<h2>{title}</h2>
	{#if description}<p>{description}</p>{/if}
</header>

<style>
	.phead {
		padding-bottom: 4px;
	}
	.phead h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.015em;
		color: var(--ca-text-primary);
	}
	.phead p {
		margin: 4px 0 0;
		max-width: 72ch;
		font-size: 13px;
		line-height: 1.5;
		color: var(--ca-text-secondary);
	}
</style>
