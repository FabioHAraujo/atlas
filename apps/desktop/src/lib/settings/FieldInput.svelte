<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";

	/** The bordered, sunken text box shared by `TextInput` and `NumInput`. */
	let { class: cls, ...rest }: HTMLInputAttributes = $props();
</script>

<input class={cls} {...rest} />

<style>
	input {
		height: 28px;
		padding: 0 8px;
		font: inherit;
		font-size: 12.5px;
		border-radius: 7px;
		border: 0.5px solid var(--atlas-control-border, var(--ca-outline-default));
		background: var(--ca-surface-sunken);
		color: var(--ca-text-primary);
		user-select: text;
		-webkit-user-select: text;
	}
	input:focus {
		outline: none;
		border-color: color-mix(
			in oklab,
			var(--ca-brand-main) 55%,
			var(--atlas-control-border, var(--ca-outline-default))
		);
	}
	input.mono {
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	input.num {
		width: 64px;
		text-align: right;
	}
	input.text {
		max-width: 100%;
	}
</style>
