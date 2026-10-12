<script lang="ts">
	/** The chat's rounded multi-line input (composer box and ask-prompt answers). */
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let { el = $bindable(), ...rest }: { el?: HTMLTextAreaElement | undefined } & HTMLTextareaAttributes =
		$props();
</script>

<textarea bind:this={el} {...rest}></textarea>

<style>
	textarea {
		flex: 1;
		resize: none;
		font: inherit;
		font-size: 13px;
		padding: 8px 10px;
		border-radius: 8px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: color-mix(in oklab, var(--ca-text-primary) 3%, transparent);
		color: inherit;
		max-height: 200px;
	}
</style>
