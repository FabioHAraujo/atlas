<script lang="ts">
	import { toast } from "@codeatlasdev/ui";
	import { tick } from "svelte";
	import { api } from "#lib/api.ts";
	import { resolvePath } from "#lib/logs/links.ts";
	import { openFile } from "#lib/stores/files.svelte.ts";
	import { openPreview } from "#lib/stores/browser.svelte.ts";
	import type { Run } from "./actionRuns.ts";
	import { segments, type Seg } from "./actionSegments.ts";

	/** Output of one run: tail window, follow-while-live scrolling and clickable URLs/paths. */
	let {
		run,
		rev,
		active,
		wtId,
		root,
	}: {
		run: Run;
		/** Bumped by the runs store on every change of the (non-reactive) line rings. */
		rev: number | undefined;
		/** The drawer is open: only then does a live run keep the view pinned to its end. */
		active: boolean;
		wtId: string | undefined;
		/** Absolute root used to resolve relative file links. */
		root: string;
	} = $props();

	/** Rendered tail: a run keeps up to 5000 lines, the DOM only needs the end unless asked. */
	const TAIL = 1500;

	let all = $state(false);
	let rows = $derived.by(() => {
		void rev;
		const items = run.lines.items;
		const shown = all ? items : items.slice(-TAIL);
		const hidden = items.length - shown.length;
		return { lines: shown, hidden, first: run.lines.base + hidden };
	});

	let viewport = $state<HTMLElement>();
	let follow = $state(true);

	function onscroll() {
		if (!viewport) return;
		follow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24;
	}

	const toEnd = () => tick().then(() => viewport && (viewport.scrollTop = viewport.scrollHeight));

	// Auto-follow while the run is live and the reader is at the bottom.
	$effect(() => {
		void rev;
		if (!active || !follow || run.status !== "running") return;
		void toEnd();
	});

	// Switching runs starts at the end (what just happened), following again.
	$effect(() => {
		void run.id;
		all = false;
		follow = true;
		void toEnd();
	});

	async function openLink(e: MouseEvent, seg: Seg) {
		const link = seg.link;
		if (!link) return;
		e.preventDefault();
		try {
			if (link.kind === "url" || link.kind === "osc") {
				if (/^https?:/i.test(link.target) && wtId) await openPreview(wtId, link.target, e.shiftKey);
				else await api.openUrl(link.target);
				return;
			}
			const rel = resolvePath(link.target, root, null);
			if (rel && wtId) openFile(wtId, rel, link.line, link.col);
			else toast.error(`${link.target} is outside the project`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		}
	}
</script>

<div class="out mono" bind:this={viewport} {onscroll} tabindex="-1">
	{#if run.truncated > 0}
		<div class="note">
			{run.truncated.toLocaleString()} earlier lines were not kept (attached mid-run); full output is in .logs/.
		</div>
	{/if}
	{#if rows.hidden > 0}
		<button class="note more" onclick={() => (all = true)}>
			Show {rows.hidden.toLocaleString()} earlier lines
		</button>
	{/if}
	{#each rows.lines as l, i (rows.first + i)}
		<div class="ln">
			{#each segments(l.text) as s}{#if s.link}<a
						href={s.link.target}
						class="lnk"
						style={s.css}
						title={s.link.kind === "file" ? "Open file" : "Open link (⇧ for the browser)"}
						onclick={(e) => openLink(e, s)}>{s.text}</a
					>{:else}<span style={s.css}>{s.text}</span>{/if}{/each}
		</div>
	{:else}
		<div class="note">{run.status === "running" ? "Waiting for output…" : "No output."}</div>
	{/each}
</div>

<style>
	.out {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--ca-surface-sunken, var(--ca-surface-raised));
		border: 1px solid var(--ca-outline-subtle);
		font-size: 11.5px;
		line-height: 1.5;
		user-select: text;
		-webkit-user-select: text;
	}
	.ln {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		min-height: 1.5em;
	}
	.lnk {
		color: var(--ca-semantic-info);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.note {
		padding: 2px 0 6px;
		font-family: inherit;
		font-size: 11px;
		color: var(--ca-text-disabled);
	}
	.more {
		display: block;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.more:hover {
		color: var(--ca-text-primary);
	}
</style>
