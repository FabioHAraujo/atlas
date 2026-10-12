<script lang="ts">
	/** Settings search results: a list of matches that jump to their section and row. */
	import { crumb, type SettingEntry } from "#lib/settings/index.ts";
	import PageHead from "#lib/settings/PageHead.svelte";

	let {
		results,
		query,
		onpick,
	}: { results: SettingEntry[]; query: string; onpick: (e: SettingEntry) => void } = $props();
</script>

<PageHead
	title={results.length
		? `${results.length} ${results.length === 1 ? "setting" : "settings"}`
		: "No settings found"}
	description={results.length
		? `Matching “${query.trim()}”.`
		: "Try a shorter word, like “font”, “theme” or “branch”."}
/>
<div class="results">
	{#each results as r (r.section + (r.tab ?? "") + r.id)}
		<button class="result" onclick={() => onpick(r)}>
			<span class="rtext">
				<span class="rlabel">{r.label}</span>
				<span class="rdesc">{r.description}</span>
			</span>
			<span class="rcrumb">{crumb(r)}</span>
		</button>
	{/each}
</div>

<style>
	.results {
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: var(--ca-surface-raised);
	}
	.result {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 14px;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
	}
	.result + .result {
		border-top: 0.5px solid var(--ca-outline-subtle);
	}
	.result:hover {
		background: var(--ca-action-hover);
	}
	.rtext {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.rlabel {
		font-size: 13px;
		font-weight: 500;
	}
	.rdesc {
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
	.rcrumb {
		flex-shrink: 0;
		font-size: 11.5px;
		color: var(--ca-text-hint);
	}
</style>
