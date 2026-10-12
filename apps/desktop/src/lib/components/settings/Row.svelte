<script lang="ts">
	/** One settings row: icon tile, name + subline, trailing controls. Lives inside a `Group`. */
	import type { Component, Snippet } from "svelte";

	let {
		icon: Icon,
		name,
		sub,
		mono = false,
		children,
	}: {
		icon: Component<{ size?: number }>;
		name: string;
		sub: string;
		/** Monospace subline (paths). */
		mono?: boolean;
		/** Trailing content: tags, versions, links, switches. */
		children?: Snippet;
	} = $props();
</script>

<div class="srow">
	<div class="ico"><Icon size={15} /></div>
	<div class="what">
		<div class="name">{name}</div>
		<div class="sub" class:mono>{sub}</div>
	</div>
	{@render children?.()}
</div>

<style>
	.srow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
	}
	.ico {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		background: var(--ca-surface-sunken);
		color: var(--ca-text-secondary);
	}
	.what {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		font-size: 13px;
	}
	.sub {
		font-size: 11px;
		color: var(--ca-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
