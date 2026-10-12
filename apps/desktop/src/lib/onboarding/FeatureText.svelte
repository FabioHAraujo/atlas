<script lang="ts">
	import type { Component, Snippet } from "svelte";

	/** Icon tile + title + one muted line: the lead of an onboarding / settings row. */
	let {
		icon: Icon,
		title,
		children,
	}: { icon: Component<{ size?: number }>; title: string; children: Snippet } = $props();
</script>

<span class="ico"><Icon size={16} /></span>
<div class="text">
	<b>{title}</b>
	<small>{@render children()}</small>
</div>

<style>
	.ico {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		color: var(--ca-brand-main);
		background: color-mix(in oklab, var(--ca-brand-main) 12%, transparent);
	}
	.text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.35;
	}
	.text b {
		font-size: 13px;
		font-weight: 600;
	}
	.text small {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
</style>
