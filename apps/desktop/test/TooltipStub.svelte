<script lang="ts">
	// Stand-in for the UI kit's Tooltip in component tests (the real one is bits-ui, which bun cannot load).
	// It renders the trigger like the kit does and counts how many tooltips were ever built.
	import type { Snippet } from "svelte";

	let { content, triggerChild }: { content: string; triggerChild: Snippet<[Record<string, unknown>]> } =
		$props();

	(globalThis as { __tooltipsBuilt?: number }).__tooltipsBuilt =
		((globalThis as { __tooltipsBuilt?: number }).__tooltipsBuilt ?? 0) + 1;
</script>

<span data-tooltip-stub data-content={content}>{@render triggerChild({ "data-tooltip-trigger": "" })}</span>
