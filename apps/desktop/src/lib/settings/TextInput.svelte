<script lang="ts">
	import FieldInput from "./FieldInput.svelte";

	let {
		value,
		label,
		placeholder,
		mono = false,
		width = "240px",
		onchange,
	}: {
		value: string;
		label: string;
		placeholder?: string;
		mono?: boolean;
		width?: string;
		onchange: (v: string) => void;
	} = $props();
</script>

<FieldInput
	class={mono ? "text mono" : "text"}
	style="width: {width}"
	aria-label={label}
	{placeholder}
	{value}
	spellcheck="false"
	onchange={(e) => onchange(e.currentTarget.value)}
/>
