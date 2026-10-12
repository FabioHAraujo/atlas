<script lang="ts">
	import FieldInput from "./FieldInput.svelte";

	/**
	 * Small number box with a unit. Commits on change/blur; an empty or invalid entry
	 * is sent as NaN so the setting falls back to its default.
	 */
	let {
		value,
		unit,
		label,
		onchange,
	}: { value: number; unit?: string; label: string; onchange: (v: number) => void } = $props();

	let text = $derived(String(value));
</script>

<label>
	<FieldInput
		class="num"
		inputmode="decimal"
		aria-label={label}
		value={text}
		onchange={(e) => {
			const v = e.currentTarget.value.trim();
			onchange(v === "" ? NaN : Number(v));
		}}
	/>
	{#if unit}<span>{unit}</span>{/if}
</label>

<style>
	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
</style>
