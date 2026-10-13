<script lang="ts">
	/**
	 * A kit overlay (menu, select, bell, drawer: each a bits-ui Portal) that a neighbour space layer does not need yet.
	 *
	 * Every kit overlay mounts an imperative root under `<body>` with its own watcher even while closed, and a layer
	 * carries about six of them (more for every file row of an Explorer). Built inside the commit of a space switch
	 * that is milliseconds of main thread and ~160 nodes under `<body>`. A neighbour is `inert`: nobody can open its
	 * overlays, so a box of the trigger's size stands in; they are built one per task once the page has been quiet
	 * (`idleQueue`), or in the very flush the layer becomes current if that comes first. A layer that was current keeps
	 * what it built (A→B→A rebuilds nothing):
	 * `width`/`height` are the trigger's laid-out size (or `fill` for a full-row one), so building it shifts nothing.
	 */
	import type { Snippet } from "svelte";
	import { peekSpace } from "#lib/shell/spaceKey.ts";
	import AfterIdle from "./AfterIdle.svelte";

	let {
		width,
		height,
		fill = false,
		children,
	}: {
		width?: number;
		height?: number;
		/** The trigger is `width: 100%` and shrinks with its row (a select): the placeholder does the same. */
		fill?: boolean;
		children: Snippet;
	} = $props();

	// Outside a pager there is one page and it is the current one.
	const space = peekSpace();
</script>

{#snippet placeholder()}
	<!-- Out of the layout's way: the same box the trigger will have. -->
	<span
		data-overlay-placeholder
		aria-hidden="true"
		style:width={fill ? "100%" : width === undefined ? undefined : `${width}px`}
		style:height={height === undefined ? undefined : `${height}px`}
		style:display={fill ? "block" : "inline-block"}
		style:flex={fill ? "0 1 auto" : "none"}
	></span>
{/snippet}

<AfterIdle now={space?.current ?? true} fallback={placeholder}>
	{@render children()}
</AfterIdle>
