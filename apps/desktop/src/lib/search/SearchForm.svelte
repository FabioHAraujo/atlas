<script lang="ts">
	import { Spinner } from "@codeatlasdev/ui";
	import { Search, CaseSensitive, Regex, WholeWord, SlidersHorizontal, X } from "@lucide/svelte";
	import Tip from "#lib/components/Tip.svelte";
	import { scheduleSearch, type SearchState } from "#lib/search/search.svelte.ts";

	/** Query field with its toggles, the include/skip globs and the one-line status. */
	let {
		worktreeId,
		s,
		input = $bindable(),
		onkeydown,
	}: {
		worktreeId: string;
		s: SearchState;
		input?: HTMLInputElement;
		/** Keys of the query field (the results list drives navigation from it). */
		onkeydown: (e: KeyboardEvent) => void;
	} = $props();

	const change = () => scheduleSearch(worktreeId);
</script>

<div class="form">
	<div class="field">
		<Search size={13} />
		<input
			bind:this={input}
			bind:value={s.query}
			oninput={change}
			{onkeydown}
			placeholder="Find in project"
			spellcheck="false"
			autocomplete="off"
			aria-label="Search query"
		/>
		{#if s.query}
			<button
				class="tog"
				aria-label="Clear"
				onclick={() => {
					s.query = "";
					change();
					input?.focus();
				}}><X size={12} /></button
			>
		{/if}
		<Tip label="Match case" side="bottom">
			{#snippet child(props)}
				<button
					{...props}
					class="tog"
					class:on={s.caseSensitive}
					aria-pressed={s.caseSensitive}
					aria-label="Match case"
					onclick={() => ((s.caseSensitive = !s.caseSensitive), change())}><CaseSensitive size={14} /></button
				>
			{/snippet}
		</Tip>
		<Tip label="Whole word" side="bottom">
			{#snippet child(props)}
				<button
					{...props}
					class="tog"
					class:on={s.wholeWord}
					aria-pressed={s.wholeWord}
					aria-label="Whole word"
					onclick={() => ((s.wholeWord = !s.wholeWord), change())}><WholeWord size={14} /></button
				>
			{/snippet}
		</Tip>
		<Tip label="Regular expression" side="bottom">
			{#snippet child(props)}
				<button
					{...props}
					class="tog"
					class:on={s.regex}
					aria-pressed={s.regex}
					aria-label="Regular expression"
					onclick={() => ((s.regex = !s.regex), change())}><Regex size={14} /></button
				>
			{/snippet}
		</Tip>
	</div>
	<button class="filters" onclick={() => (s.showFilters = !s.showFilters)} aria-expanded={s.showFilters}>
		<SlidersHorizontal size={11} />
		Files to include or skip
		{#if s.include || s.exclude}<span class="dot"></span>{/if}
	</button>
	{#if s.showFilters}
		<div class="globs">
			<input
				bind:value={s.include}
				oninput={change}
				placeholder="Include: src/**, *.ts"
				spellcheck="false"
				aria-label="Files to include"
			/>
			<input
				bind:value={s.exclude}
				oninput={change}
				placeholder="Skip: dist, *.min.js"
				spellcheck="false"
				aria-label="Files to skip"
			/>
		</div>
	{/if}
</div>

<div class="status" aria-live="polite">
	{#if s.phase === "running"}
		<Spinner size="small" /> Searching…
	{:else if s.phase === "done"}
		{#if s.matches}
			{s.matches}{s.truncated ? "+" : ""} result{s.matches === 1 ? "" : "s"} in {s.files.length}{s.truncated
				? "+"
				: ""} file{s.files.length === 1 ? "" : "s"}
			<span class="took">{s.tookMs} ms · {s.tool}</span>
		{:else}
			No results
		{/if}
	{:else if s.phase === "error"}
		<span class="err">{s.error}</span>
	{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
	}
	.field,
	.globs input {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 28px;
		padding: 0 4px 0 8px;
		border: 0.5px solid var(--ca-outline-subtle);
		border-radius: 8px;
		background: color-mix(in oklab, var(--ca-text-primary) 4%, transparent);
		color: var(--ca-text-secondary);
		transition:
			border-color 140ms ease-out,
			background 140ms ease-out;
	}
	.field:focus-within,
	.globs input:focus {
		border-color: var(--space-accent, var(--ca-brand-main));
		background: transparent;
	}
	.field input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		outline: 0;
		background: none;
		color: var(--ca-text-primary);
		font: inherit;
		padding: 0 4px;
	}
	.globs {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.globs input {
		padding: 0 8px;
		font: inherit;
		font-size: 12px;
		outline: 0;
		color: var(--ca-text-primary);
	}
	.tog {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border: 0;
		border-radius: 5px;
		background: none;
		color: inherit;
		transition:
			background 120ms ease-out,
			color 120ms ease-out;
	}
	.tog:hover {
		background: var(--ca-action-hover);
		color: var(--ca-text-primary);
	}
	.tog.on {
		background: color-mix(in oklab, var(--space-accent, var(--ca-brand-main)) 22%, transparent);
		color: var(--space-accent-text, var(--ca-brand-main));
	}
	.filters {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 2px 4px;
		border: 0;
		border-radius: 5px;
		background: none;
		font-size: 11px;
		color: var(--ca-text-secondary);
	}
	.filters:hover {
		color: var(--ca-text-primary);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--space-accent, var(--ca-brand-main));
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 20px;
		padding: 0 12px 4px;
		font-size: 11px;
		color: var(--ca-text-secondary);
	}
	.took {
		margin-left: auto;
		color: var(--ca-text-secondary);
	}
	.err {
		color: var(--ca-semantic-error, #d33);
	}
</style>
