<script lang="ts">
	import type { Snippet } from "svelte";
	import { statusItems, type StatusInput, type StatusItem } from "#lib/editor/statusbar.ts";

	let {
		input,
		onaction,
		lsp,
	}: {
		input: StatusInput;
		/** A clickable item was activated (`position`, `indent`, `eol`, `encoding`, `language`, `problems`). */
		onaction: (id: string, anchor: HTMLElement) => void;
		/** The language-server item (its own popover); rendered after the language mode. */
		lsp?: Snippet;
	} = $props();

	let items = $derived(statusItems(input));
	const leading = (it: StatusItem) => it.id === "position" || it.id === "problems";
	let left = $derived(items.filter(leading));
	let right = $derived(items.filter((i) => !leading(i)));
</script>

{#snippet cell(it: StatusItem)}
	{#if it.kind === "info"}
		<span class="item" title={it.title}>{it.text}</span>
	{:else}
		<button
			class="item btn"
			class:warning={it.kind === "warning"}
			class:error={it.kind === "error"}
			title={it.title}
			onclick={(e) => onaction(it.id, e.currentTarget)}>{it.text}</button
		>
	{/if}
{/snippet}

<div class="status" role="status" aria-label="Editor status">
	<div class="side">
		{#each left as it (it.id)}{@render cell(it)}{/each}
	</div>
	<div class="side">
		{#each right as it (it.id)}
			{#if it.id === "language"}
				{@render cell(it)}
				{@render lsp?.()}
			{:else}
				{@render cell(it)}
			{/if}
		{/each}
		{#if !right.some((i) => i.id === "language")}{@render lsp?.()}{/if}
	</div>
</div>

<style>
	.status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 22px;
		padding: 0 6px;
		border-top: 0.5px solid var(--ca-outline-subtle);
		font-size: 11.5px;
		line-height: 1;
		color: var(--ca-text-secondary);
		white-space: nowrap;
		overflow: hidden;
	}
	.side {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}
	.item {
		display: inline-flex;
		align-items: center;
		height: 18px;
		padding: 0 6px;
		border: 0;
		border-radius: 4px;
		background: none;
		font: inherit;
		color: inherit;
	}
	.btn:hover {
		background: var(--ca-action-hover);
		color: var(--ca-text-primary);
	}
	.warning {
		color: var(--ca-semantic-warning);
	}
	.error {
		color: var(--ca-semantic-error);
	}
</style>
