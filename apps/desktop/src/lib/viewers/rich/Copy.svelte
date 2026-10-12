<script lang="ts">
	import { Check, Copy, KeyRound } from "@lucide/svelte";

	/** Icon button that copies `text` and shows a check for a moment. */
	let { text, label = "Copy", key = false }: { text: string; label?: string; key?: boolean } = $props();
	let done = $state(false);
	let timer: number | undefined;

	async function copy(e: MouseEvent) {
		e.stopPropagation();
		await navigator.clipboard.writeText(text);
		done = true;
		clearTimeout(timer);
		timer = window.setTimeout(() => (done = false), 1200);
	}
</script>

<button class="rv-btn icon" title={done ? "Copied" : label} aria-label={label} onclick={copy}>
	{#if done}<Check size={12} />{:else if key}<KeyRound size={12} />{:else}<Copy size={12} />{/if}
</button>
