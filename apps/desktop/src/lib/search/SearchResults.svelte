<script lang="ts">
	import { tick } from "svelte";
	import { ChevronRight, ChevronDown } from "@lucide/svelte";
	import { fileIcon } from "#lib/icons.ts";
	import { openFile } from "#lib/stores/files.svelte.ts";
	import type { SearchState } from "#lib/search/search.svelte.ts";
	import { dirOf, flatRows, nameOf, navKey, previewRuns } from "#lib/search/rows.ts";

	/** Result tree (files with their matches) and its keyboard navigation. */
	let {
		worktreeId,
		s,
		list = $bindable(),
		onleaveup,
	}: {
		worktreeId: string;
		s: SearchState;
		list?: HTMLDivElement;
		/** ArrowUp from the first row: hand focus back to the query field. */
		onleaveup: () => void;
	} = $props();

	let collapsed = $state<Record<string, boolean>>({});
	let cursor = $state(0);

	let rows = $derived(flatRows(s.files, collapsed));

	/** Move from the query field into the list (ArrowDown). */
	export function enter() {
		if (!rows.length) return false;
		void move(0);
		list?.focus();
		return true;
	}

	// A new result set restarts keyboard navigation at the top.
	$effect(() => {
		void s.files;
		cursor = 0;
		collapsed = {};
	});

	function open(i: number) {
		const r = rows[i];
		if (!r) return;
		if (r.kind === "file") collapsed[r.path] = !collapsed[r.path];
		else openFile(worktreeId, r.path, r.match.line, r.match.start + 1);
	}

	async function move(to: number) {
		cursor = Math.min(rows.length - 1, Math.max(0, to));
		await tick();
		list?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
	}

	function onkeydown(e: KeyboardEvent) {
		const act = navKey(e.key, rows, cursor);
		if (!act) return;
		if (act.type === "move") (e.preventDefault(), void move(act.to));
		else if (act.type === "leave") (e.preventDefault(), onleaveup());
		else if (act.type === "open") (e.preventDefault(), open(cursor));
		else if (act.type === "fold") collapsed[act.path] = act.collapsed;
		// "swallow": a handled key with nothing to do (→ on a match row) still must not bubble.
		e.stopPropagation();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="list" bind:this={list} {onkeydown} tabindex="0" role="tree" aria-label="Search results">
	{#if s.phase === "idle"}
		<div class="hint">
			<p>Search every file in this worktree.</p>
			<p class="sub">Type to search. Use ↑ ↓ to move, Enter to open at the line.</p>
		</div>
	{:else if s.phase === "done" && !s.files.length}
		<div class="hint">
			<p>Nothing matches “{s.query}”.</p>
			<p class="sub">Try fewer words, turn off whole word, or clear the file filters.</p>
		</div>
	{/if}
	{#each rows as r, i (r.key)}
		{#if r.kind === "file"}
			<div
				class="file"
				class:cur={cursor === i}
				data-row={i}
				role="treeitem"
				aria-selected={cursor === i}
				aria-expanded={!collapsed[r.path]}
				tabindex="-1"
				onclick={() => ((cursor = i), open(i))}
				onkeydown={(e) => e.key === "Enter" && open(i)}
			>
				{#if collapsed[r.path]}<ChevronRight size={11} />{:else}<ChevronDown size={11} />{/if}
				<span class="ico" data-contrast-decorative>{@html fileIcon(nameOf(r.path))}</span>
				<span class="fname">{nameOf(r.path)}</span>
				<span class="fdir">{dirOf(r.path)}</span>
				<span class="count">{r.count}</span>
			</div>
		{:else}
			<div
				class="match"
				class:cur={cursor === i}
				data-row={i}
				role="treeitem"
				aria-selected={cursor === i}
				tabindex="-1"
				onclick={() => ((cursor = i), open(i))}
				onkeydown={(e) => e.key === "Enter" && open(i)}
			>
				<span class="ln">{r.match.line}</span>
				<span class="txt"
					>{#each previewRuns(r.match) as run, k (k)}{#if run.hit}<mark>{run.text}</mark
							>{:else}{run.text}{/if}{/each}</span
				>
			</div>
		{/if}
	{/each}
	{#if s.truncated}
		<p class="more">Showing the first results. Narrow the search to see the rest.</p>
	{/if}
</div>

<style>
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 2px 0 10px;
		outline: none;
	}
	.hint {
		padding: 20px 16px;
		color: var(--ca-text-secondary);
	}
	.hint p {
		margin: 0 0 4px;
	}
	.hint .sub {
		font-size: 11.5px;
		color: var(--ca-text-secondary);
	}
	.file,
	.match {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 0 4px;
		border-radius: 5px;
		cursor: default;
	}
	.file {
		height: 24px;
		padding: 0 6px;
		margin-top: 2px;
	}
	.match {
		min-height: 22px;
		padding: 1px 6px 1px 24px;
		align-items: baseline;
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.file:hover,
	.match:hover {
		background: var(--ca-action-hover);
	}
	.list:focus-within .cur,
	.cur {
		background: color-mix(in oklab, var(--space-accent, var(--ca-brand-main)) 16%, transparent);
	}
	.ico {
		display: inline-flex;
	}
	.ico :global(svg) {
		width: 15px;
		height: 15px;
	}
	.fname {
		font-weight: 550;
		white-space: nowrap;
	}
	.fdir {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--ca-text-secondary);
	}
	.count {
		padding: 0 6px;
		border-radius: 8px;
		background: color-mix(in oklab, var(--ca-text-primary) 9%, transparent);
		font-size: 10.5px;
		color: var(--ca-text-secondary);
	}
	.ln {
		min-width: 28px;
		text-align: right;
		color: var(--ca-text-disabled);
		flex-shrink: 0;
	}
	.txt {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre;
		color: var(--ca-text-secondary);
	}
	mark {
		border-radius: 3px;
		background: color-mix(in oklab, var(--ca-semantic-warning) 38%, transparent);
		color: var(--ca-text-primary);
	}
	.more {
		margin: 8px 12px;
		font-size: 11px;
		color: var(--ca-text-secondary);
	}
</style>
