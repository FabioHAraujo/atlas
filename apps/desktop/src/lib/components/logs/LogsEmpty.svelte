<script lang="ts">
	import { Chip, EmptyState, Spinner } from "@codeatlasdev/ui";
	import { ScrollText } from "@lucide/svelte";

	let {
		loading,
		stopped,
		filtering,
		filtered,
		rangeLabel,
		onreset,
	}: {
		/** The stack runs but its first batch of lines has not arrived. */
		loading: boolean;
		/** Stack stopped and nothing buffered. */
		stopped: boolean;
		filtering: boolean;
		/** Any filter (search, service, level, range) is active. */
		filtered: boolean;
		/** Label of the active time range, or null when there is none. */
		rangeLabel: string | null;
		onreset: () => void;
	} = $props();
</script>

<div class="none">
	{#if loading}
		<Spinner size={20} label="Loading logs" />
	{:else if stopped}
		<EmptyState icon={ScrollText} title="Stack is stopped" description="Logs stream here once it runs." />
	{:else if filtering}
		<Spinner size={20} label="Filtering" />
	{:else if filtered}
		<EmptyState
			icon={ScrollText}
			title="No lines match"
			description={rangeLabel
				? `Nothing in "${rangeLabel}". Clear the range, the search or the filters.`
				: "Clear the search or the filters."}
		>
			{#snippet actions()}
				<Chip size="sm" label="Reset filters" onclick={onreset} />
			{/snippet}
		</EmptyState>
	{:else}
		<EmptyState icon={ScrollText} title="Waiting for output…" />
	{/if}
</div>

<style>
	.none {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--ca-text-secondary);
		z-index: 1;
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
</style>
