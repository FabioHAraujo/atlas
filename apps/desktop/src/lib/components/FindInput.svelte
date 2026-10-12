<script lang="ts">
	/** Compact find field for terminal and log toolbars (raised pill input, optional invalid state). */
	import type { HTMLInputAttributes } from "svelte/elements";

	let {
		value = $bindable(""),
		input = $bindable(),
		invalid = false,
		width = 200,
		...rest
	}: {
		value?: string;
		input?: HTMLInputElement | undefined;
		/** Danger border (e.g. a regex that does not compile). */
		invalid?: boolean;
		width?: number;
	} & Omit<HTMLInputAttributes, "value" | "width"> = $props();
</script>

<input bind:this={input} bind:value class:invalid style:width="{width}px" {...rest} />

<style>
	input {
		font: inherit;
		font-size: 12px;
		padding: 4px 8px;
		border-radius: 6px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: var(--ca-surface-raised, var(--ca-bg-default));
		color: var(--ca-text-primary);
	}
	input.invalid {
		border-color: var(--ca-semantic-danger, #e5484d);
	}
</style>
