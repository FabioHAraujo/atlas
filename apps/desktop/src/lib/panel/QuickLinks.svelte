<script lang="ts">
	import { Kbd } from "@codeatlasdev/ui";
	import { ExternalLink } from "@lucide/svelte";
	import type { ServiceDef } from "#lib/api.ts";
	import { openService } from "#lib/actions.svelte.ts";

	/** One button per browser-openable service; lit while the service runs. */
	let {
		services,
		running,
		upNames,
	}: {
		services: ServiceDef[];
		/** The stack is up: buttons are enabled. */
		running: boolean;
		/** Names of the services currently running. */
		upNames: Set<string>;
	} = $props();
</script>

<div class="quick">
	{#each services as q (q.name)}
		<button
			class="qbtn"
			class:up={upNames.has(q.name)}
			disabled={!running}
			onclick={() => openService(q)}
			title={q.target?.url}
		>
			<span class="qname">{q.name}</span>
			<span class="qurl mono">{q.target?.url.replace(/^https?:\/\/(localhost)?/, "")}</span>
			{#if q.open_key}<Kbd>{q.open_key}</Kbd>{:else}<ExternalLink size={12} />{/if}
		</button>
	{/each}
</div>

<style>
	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.qbtn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border-radius: 9px;
		border: 0.5px solid var(--ca-outline-subtle);
		background: var(--ca-surface-raised);
		color: var(--ca-text-primary);
		font: inherit;
		transition:
			border-color 120ms ease-out,
			background 120ms ease-out;
	}
	.qbtn:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--space-accent, var(--ca-brand-main)) 60%, transparent);
		background: color-mix(in oklab, var(--space-accent, var(--ca-brand-main)) 6%, var(--ca-surface-raised));
	}
	.qbtn:disabled,
	.qbtn:disabled .qurl {
		color: var(--ca-text-disabled);
	}
	.qname {
		font-weight: 600;
		font-size: 12.5px;
	}
	.qurl {
		font-size: 11px;
		color: var(--ca-text-secondary);
	}
</style>
