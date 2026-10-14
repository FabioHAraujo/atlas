<script lang="ts">
	/** The one-time toast offering the Ghostty theme. `Use theme` only opens Settings; nothing is applied here. */
	import { Button } from "@codeatlasdev/ui";
	import { corner } from "#lib/shell/cornerStack.ts";
	import { Ghost, X } from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { ghosttyOffer, openGhosttyOffer } from "#lib/shell/themeCommands.svelte.ts";
	import { themes } from "#lib/stores/theme.svelte.ts";

	/** Longer than the stock toast: there is a choice to make. */
	const LIFETIME_MS = 15_000;

	let live = $derived(ghosttyOffer.shown && themes.ghostty.offered);

	$effect(() => {
		if (!live) return;
		const t = setTimeout(() => (ghosttyOffer.shown = false), LIFETIME_MS);
		return () => clearTimeout(t);
	});
</script>

{#if live}
	<div use:corner class="card" role="status" transition:fly={{ y: 12, duration: 220 }}>
		<Ghost size={15} aria-hidden="true" />
		<div class="text">
			<b>Use your Ghostty theme?</b>
			<span>Atlas found ~/.config/ghostty/config.</span>
		</div>
		<Button size="sm" onclick={openGhosttyOffer}>Use theme</Button>
		<button class="x" aria-label="Dismiss" onclick={() => (ghosttyOffer.shown = false)}>
			<X size={13} />
		</button>
	</div>
{/if}

<style>
	.card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 10px 10px 12px;
		border-radius: 12px;
		color: var(--ca-text-primary);
		background: var(--ca-surface-raised);
		box-shadow:
			0 0 0 0.5px
				color-mix(in oklab, var(--atlas-focus-ring, var(--ca-brand-main)) 45%, var(--ca-outline-subtle)),
			0 10px 30px -10px rgb(0 0 0 / 0.35);
	}
	.text {
		display: flex;
		flex-direction: column;
		line-height: 1.3;
		font-size: 12.5px;
	}
	.text span {
		font-size: 11.5px;
		color: var(--ca-text-secondary);
	}
	.x {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 6px;
		color: var(--ca-text-secondary);
		background: transparent;
	}
	.x:hover {
		background: var(--ca-action-hover);
	}
</style>
