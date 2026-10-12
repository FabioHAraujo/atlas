<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import StatusDot, { type DotTone } from "./StatusDot.svelte";

	/** One 28px list row of a panel drawer: a status dot, the content, hover highlight. */
	let {
		tone,
		pulse = false,
		on = false,
		children,
		...rest
	}: {
		tone: DotTone;
		pulse?: boolean;
		/** Selected row (listbox option). */
		on?: boolean;
		children: Snippet;
	} & HTMLButtonAttributes = $props();
</script>

<button class="row" class:on {...rest}>
	<StatusDot {tone} {pulse} />
	{@render children()}
</button>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 28px;
		padding: 0 6px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--ca-text-primary);
		font: inherit;
		font-size: 12.5px;
		text-align: left;
	}
	.row:not(:disabled):hover {
		background: var(--ca-action-hover);
	}
	.row:disabled {
		cursor: default;
	}
	.row.on {
		background: var(--ca-surface-raised);
	}
</style>
