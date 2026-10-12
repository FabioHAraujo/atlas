<script lang="ts">
	/** Non-blocking toasts for errors outside any boundary, plus the dialog "Details" opens. */
	import { Dialog } from "@codeatlasdev/ui";
	import { OctagonAlert, X } from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import ErrorPanel from "./ErrorPanel.svelte";
	import { errors } from "./errors.svelte.ts";

	/** Longer than the stock toast (4 s): there is something to read and act on. */
	const LIFETIME_MS = 12_000;

	// Reading `repeats` re-arms the timers when the same error fires again, so a live problem stays visible.
	$effect(() => {
		const timers = errors.toasts.map(
			(t) => (t.repeats, window.setTimeout(() => errors.dismiss(t.id), LIFETIME_MS)),
		);
		return () => timers.forEach(clearTimeout);
	});
</script>

<div class="stack" role="region" aria-label="Errors">
	{#each errors.toasts as t (t.id)}
		<div class="toast" role="alert" transition:fly={{ y: 10, duration: 200 }}>
			<span class="icon" aria-hidden="true"><OctagonAlert size={15} strokeWidth={1.9} /></span>
			<div class="text">
				<b>An action didn't finish</b>
				<span class="m">{t.report.message}</span>
			</div>
			{#if t.repeats > 0}<span class="count" title="Happened again">×{t.repeats + 1}</span>{/if}
			<button class="details" onclick={() => errors.show(t.report, t.id)}>Details</button>
			<button class="x" aria-label="Dismiss" onclick={() => errors.dismiss(t.id)}><X size={13} /></button>
		</div>
	{/each}
</div>

<Dialog
	open={!!errors.current}
	onOpenChange={(o) => !o && (errors.current = null)}
	title="Error details"
	size="md"
>
	{#if errors.current}
		<ErrorPanel
			report={errors.current}
			variant="dialog"
			title="An action didn't finish"
			hint="Atlas is still running. Copy the details or report it if it keeps happening."
			close={() => (errors.current = null)}
			closeLabel="Close"
		/>
	{/if}
</Dialog>

<style>
	.stack {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 1600;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(440px, calc(100vw - 32px));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 8px 9px 11px;
		border-radius: 12px;
		color: var(--ca-text-primary);
		background: var(--ca-glass-bg, var(--ca-surface-raised));
		backdrop-filter: var(--ca-blur-thick);
		-webkit-backdrop-filter: var(--ca-blur-thick);
		box-shadow:
			0 0 0 0.5px color-mix(in oklab, var(--ca-semantic-error) 40%, var(--ca-outline-subtle)),
			0 10px 30px -10px rgb(0 0 0 / 0.35);
	}
	.icon {
		flex: none;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 7px;
		color: var(--ca-semantic-error);
		background: color-mix(in oklab, var(--ca-semantic-error) 13%, transparent);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: 12.5px;
		line-height: 1.3;
	}
	.m {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		overflow-wrap: anywhere;
		font-size: 11.5px;
		color: var(--ca-text-secondary);
	}
	.count {
		flex: none;
		font: 11px var(--mono);
		color: var(--ca-text-secondary);
	}
	.details {
		flex: none;
		padding: 4px 9px;
		border: 0;
		border-radius: 6px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--ca-text-primary);
		background: var(--ca-action-hover);
		cursor: default;
	}
	.details:hover {
		background: var(--ca-action-selected, var(--ca-action-hover));
	}
	.x {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--ca-text-secondary);
		cursor: default;
	}
	.x:hover {
		color: var(--ca-text-primary);
		background: var(--ca-action-hover);
	}
</style>
