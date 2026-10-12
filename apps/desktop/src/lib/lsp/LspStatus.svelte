<script lang="ts">
	import { CircleAlert, TriangleAlert, LoaderCircle } from "@lucide/svelte";
	import { lsp, refreshStatus, serverFor, type LspDoc } from "#lib/lsp/client.svelte.ts";
	import { showPicker } from "#lib/lsp/picker.svelte.ts";
	import type { PaletteItem } from "#lib/components/Palette.svelte";

	let { doc, errors, warnings }: { doc: LspDoc; errors: number; warnings: number } = $props();

	let srv = $derived(serverFor(doc.path));
	let state = $derived(srv?.state ?? (doc.status === "missing" ? "missing" : "starting"));
	let busy = $derived(state === "downloading" || state === "starting");
	let name = $derived(srv?.name ?? doc.server ?? "");
	let detail = $derived(srv?.progress || srv?.message || "");

	async function showAll() {
		await refreshStatus().catch(() => {});
		const items: PaletteItem[] = lsp.servers.map((s, i) => ({
			id: `${i}`,
			group: "Language servers",
			label: `${s.name} · ${s.state}`,
			description: [s.language, s.root, s.progress || s.message].filter(Boolean).join(" · "),
			run: () => {},
		}));
		showPicker("Language servers", items);
	}
</script>

{#if name || state === "missing"}
	<button
		class="lsp"
		class:bad={state === "crashed" || state === "missing"}
		title={detail ? `${name}: ${detail}` : `${name || "language server"}: ${state}`}
		onclick={showAll}
	>
		{#if busy}<LoaderCircle size={12} class="spin" />{/if}
		<span class="dot {state}"></span>
		<span>{name || "no server"}</span>
		{#if detail && busy}<span class="detail">{detail}</span>{/if}
	</button>
{/if}
{#if errors > 0}
	<span class="count err" title="{errors} error{errors === 1 ? '' : 's'}"
		><CircleAlert size={12} />{errors}</span
	>
{/if}
{#if warnings > 0}
	<span class="count warn" title="{warnings} warning{warnings === 1 ? '' : 's'}"
		><TriangleAlert size={12} />{warnings}</span
	>
{/if}

<style>
	.lsp {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 6px;
		border: 0;
		border-radius: 5px;
		background: none;
		font-size: 11px;
		color: var(--ca-text-secondary);
		max-width: 260px;
	}
	.lsp:hover {
		background: var(--ca-action-hover);
	}
	.detail {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ca-text-disabled);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ca-text-disabled);
	}
	.dot.ready {
		background: var(--ca-semantic-success);
	}
	.dot.crashed,
	.dot.missing {
		background: var(--ca-semantic-error, #e5484d);
	}
	.dot.downloading,
	.dot.starting {
		background: var(--ca-semantic-warning);
	}
	.count {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		padding: 2px 4px;
	}
	.err {
		color: var(--ca-semantic-error, #e5484d);
	}
	.warn {
		color: var(--ca-semantic-warning);
	}
	:global(.spin) {
		animation: lsp-spin 1s linear infinite;
	}
	@keyframes lsp-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
