<script lang="ts">
	/**
	 * The one bottom-right column transient cards live in (`corner` action, `cornerStack.ts`). It is a flex column
	 * growing upward from the corner, so two cards can never cover each other whatever their heights; DOM order is
	 * the priority (first = nearest the corner). The column itself takes no pointer events, only its cards do.
	 */
	import { Toaster } from "@codeatlasdev/ui";
	import { CORNER_GAP, CORNER_ID, CORNER_MARGIN } from "./cornerStack.ts";
</script>

<div
	id={CORNER_ID}
	style:--corner-margin="{CORNER_MARGIN}px"
	style:--corner-gap="{CORNER_GAP}px"
	role="region"
	aria-label="Notices"
>
	<Toaster />
</div>

<style>
	#atlas-corner {
		position: fixed;
		right: var(--corner-margin);
		bottom: var(--corner-margin);
		z-index: 1500;
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-end;
		gap: var(--corner-gap);
		width: min(440px, calc(100vw - 2 * var(--corner-margin)));
		max-height: calc(100vh - 2 * var(--corner-margin));
		pointer-events: none;
	}
	#atlas-corner > :global(*) {
		position: relative;
		pointer-events: auto;
		max-width: 100%;
	}
	/* the kit Toaster is `position: fixed` bottom/right: inside the column it is a plain child */
	#atlas-corner > :global(.ca-toaster) {
		bottom: auto;
		right: auto;
		max-width: 100%;
		width: 100%;
	}
	/* a wrapper with nothing in it (no toast, no error) takes no room, so it leaves no gap either */
	#atlas-corner > :global(:not(:has(*))) {
		display: none;
	}
	/* an empty column must not draw or catch anything */
	#atlas-corner:not(:has(*)) {
		display: none;
	}
</style>
