<script lang="ts">
	export type DotTone = "run" | "ok" | "warn" | "fail" | "info" | "off";

	/** 7px status dot used by the panel drawers; `pulse` for something still in flight. */
	let { tone, pulse = false }: { tone: DotTone; pulse?: boolean } = $props();
</script>

<span class="dot t-{tone}" class:pulse></span>

<style>
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ca-text-disabled);
	}
	.t-run {
		background: var(--space-accent, var(--ca-brand-main));
	}
	.t-ok {
		background: var(--atlas-state-success, var(--ca-semantic-success));
	}
	.t-warn {
		background: var(--atlas-state-warning, var(--ca-semantic-warning));
	}
	.t-fail {
		background: var(--atlas-state-error, var(--ca-semantic-error));
	}
	.t-info {
		background: var(--atlas-state-info, var(--ca-semantic-info));
	}
	.pulse {
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse {
			animation: none;
		}
	}
</style>
