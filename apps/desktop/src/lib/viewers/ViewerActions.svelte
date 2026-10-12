<script lang="ts">
	/** "Open externally" / "Reveal in Finder" row shared by the viewers' no-preview states. */
	let { onopen, onreveal }: { onopen: () => void; onreveal: () => void } = $props();
</script>

<div class="actions">
	<button class="primary" onclick={onopen}>Open externally</button>
	<button onclick={onreveal}>Reveal in Finder</button>
</div>

<style>
	.actions {
		display: flex;
		gap: 8px;
		justify-content: center;
	}
	.actions button {
		height: 28px;
		padding: 0 12px;
		border: 0.5px solid var(--ca-outline-subtle);
		border-radius: 8px;
		background: none;
		color: var(--ca-text-primary);
		font-size: 12px;
		transition: background 120ms ease-out;
	}
	.actions button:hover {
		background: var(--ca-action-hover);
	}
	.actions .primary {
		border-color: transparent;
		background: var(--space-accent, var(--ca-brand-main));
		color: white;
	}
	.actions .primary:hover {
		background: color-mix(in oklab, var(--space-accent, var(--ca-brand-main)) 85%, black);
	}
</style>
