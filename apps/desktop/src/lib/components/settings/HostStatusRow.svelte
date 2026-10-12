<script lang="ts">
	/** Settings ▸ Updates ▸ Terminal host: version, why it is behind, running terminals, choices. */
	import { Button, Spinner } from "@codeatlasdev/ui";
	import { SquareTerminal } from "@lucide/svelte";
	import { terminalsLine } from "#lib/hostStatus.ts";
	import {
		hostState as h,
		openHostPrompt,
		postponeHost,
		restartHost,
	} from "#lib/stores/hostStatus.svelte.ts";
	import Row from "./Row.svelte";

	let busy = $derived(h.status === "upgrading" || h.status === "restarting");
	let waiting = $derived(h.status === "outdated");
	/** One line: the full sentence (`h.reason`) is on the version's tooltip and in the prompt. */
	let sub = $derived.by(() => {
		if (busy) return h.status === "upgrading" ? "Updating, terminals stay attached…" : "Restarting…";
		const n = terminalsLine(h.ptys.length).toLowerCase();
		if (!h.reason) return `Up to date · ${n}`;
		return `Older than Atlas ${h.appVersion} · ${n}`;
	});
</script>

<Row icon={SquareTerminal} name="Terminal host" {sub}>
	{#if h.idleArmed}<span class="tag info">Restarts when idle</span>{:else if h.deferred}<span class="tag warn"
			>Postponed</span
		>{/if}
	{#if busy}<Spinner size={14} />{/if}
	<div class="ver mono" title={h.reason || undefined}>{h.version ?? "—"}</div>
	{#if waiting && h.idleArmed}
		<Button size="sm" variant="ghost" onclick={postponeHost}>Don't wait</Button>
	{:else if waiting}
		<Button size="sm" variant="outlined" onclick={openHostPrompt}>Restart…</Button>
	{:else if h.skew === "needsRestart" && !busy}
		<Button size="sm" variant="outlined" onclick={h.ptys.length ? openHostPrompt : restartHost}
			>Restart{h.ptys.length ? "…" : ""}</Button
		>
	{/if}
</Row>

<style>
	.ver {
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
	.tag {
		font-size: 10.5px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
	}
	.tag.info {
		color: var(--ca-semantic-info);
		background: color-mix(in oklab, var(--ca-semantic-info) 14%, transparent);
	}
	.tag.warn {
		color: var(--ca-semantic-warning);
		background: color-mix(in oklab, var(--ca-semantic-warning) 14%, transparent);
	}
</style>
