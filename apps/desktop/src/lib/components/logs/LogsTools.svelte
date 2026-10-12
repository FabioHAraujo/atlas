<script lang="ts">
	import { Switch } from "@codeatlasdev/ui";
	import {
		ChevronDown,
		ChevronUp,
		CircleAlert,
		Clock,
		Copy,
		Sparkles,
		TriangleAlert,
		WrapText,
	} from "@lucide/svelte";
	import type { Level } from "#lib/logs/model.ts";

	let {
		showTime = $bindable(),
		wrap = $bindable(),
		follow = $bindable(),
		aiLines,
		onjump,
		onfollow,
		oncopy,
		oncopyai,
	}: {
		showTime: boolean;
		wrap: boolean;
		follow: boolean;
		/** Lines "Copy for AI" hands over (shown in its tooltip). */
		aiLines: number;
		/** Jump to the previous (-1) / next (1) line of at least `min` level. */
		onjump: (dir: 1 | -1, min: Level) => void;
		/** The Follow switch went on: scroll to the newest line. */
		onfollow: () => void;
		oncopy: () => void;
		oncopyai: () => void;
	} = $props();

	const JUMPS = [
		{
			dir: -1,
			min: "error",
			cls: "err",
			Icon: CircleAlert,
			title: "Previous error (E)",
			label: "Previous error",
		},
		{ dir: 1, min: "error", cls: "err", Icon: CircleAlert, title: "Next error (e)", label: "Next error" },
		{
			dir: -1,
			min: "warn",
			cls: "warn",
			Icon: TriangleAlert,
			title: "Previous warning (W)",
			label: "Previous warning",
		},
		{
			dir: 1,
			min: "warn",
			cls: "warn",
			Icon: TriangleAlert,
			title: "Next warning (w)",
			label: "Next warning",
		},
	] as const;
</script>

<div class="jump">
	{#each JUMPS as j (j.label)}
		<button class="icon {j.cls}" title={j.title} aria-label={j.label} onclick={() => onjump(j.dir, j.min)}>
			<j.Icon size={13} />
			{#if j.dir === -1}<ChevronUp size={11} />{:else}<ChevronDown size={11} />{/if}
		</button>
	{/each}
</div>
<div class="right">
	<button
		class="icon"
		class:on={showTime}
		title="Timestamps (t)"
		aria-label="Timestamps"
		aria-pressed={showTime}
		onclick={() => (showTime = !showTime)}><Clock size={14} /></button
	>
	<button
		class="icon"
		class:on={wrap}
		title="Wrap long lines"
		aria-label="Wrap long lines"
		aria-pressed={wrap}
		onclick={() => (wrap = !wrap)}><WrapText size={14} /></button
	>
	<Switch label="Follow" bind:checked={follow} onchange={() => follow && onfollow()} />
	<button class="icon" onclick={oncopy} title="Copy filtered lines" aria-label="Copy filtered lines"
		><Copy size={14} /></button
	>
	<button class="icon" onclick={oncopyai} title="Copy last {aiLines} lines for AI" aria-label="Copy for AI"
		><Sparkles size={14} /></button
	>
</div>

<style>
	.jump {
		display: flex;
		gap: 2px;
		flex-wrap: wrap;
		align-items: center;
	}
	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 1px;
		min-width: 26px;
		height: 26px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--ca-text-secondary);
		cursor: pointer;
	}
	.icon.on {
		background: var(--ca-brand-fill);
		color: var(--ca-brand-contrast);
	}
	.icon:hover:not(.on) {
		background: var(--ca-action-hover);
	}
	.icon.err {
		color: var(--ca-semantic-error);
	}
	.icon.warn {
		color: var(--ca-semantic-warning);
	}
</style>
