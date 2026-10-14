<script lang="ts">
	/**
	 * The header of a tab group: the tabs scroll in their own container, the actions (new-tab menu, quick commands) and the
	 * window drag region stay outside it. They used to be children of one `overflow-x: auto` strip with a hidden scrollbar,
	 * so enough tabs pushed the "+" out of reach.
	 */
	import type { Snippet } from "svelte";
	import { swipe, type SwipeOptions } from "#lib/shell/swipe.ts";
	import { scrollTabIntoView } from "./tabStrip.ts";

	let {
		tabList,
		actions,
		activeTab,
		count,
		swipeOptions,
	}: {
		tabList: Snippet;
		actions: Snippet;
		/** Id of the active tab: it is scrolled into view when it changes. */
		activeTab?: string;
		/** How many tabs there are: a new tab can land past the visible edge without the active id changing. */
		count?: number;
		swipeOptions: SwipeOptions;
	} = $props();

	let scroller = $state<HTMLElement | null>(null);

	$effect(() => {
		const id = activeTab;
		void count;
		if (!scroller || !id) return;
		const el = scroller;
		// After layout: the new tab's box (and the scroller's new scrollWidth) exist only once the frame is laid out.
		const raf = requestAnimationFrame(() => {
			const tab = el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
			if (!tab) return;
			const next = scrollTabIntoView({
				scroller: el.getBoundingClientRect(),
				tab: tab.getBoundingClientRect(),
				scrollLeft: el.scrollLeft,
				margin: 8,
			});
			if (next !== el.scrollLeft) el.scrollLeft = next;
		});
		return () => cancelAnimationFrame(raf);
	});

	/** A vertical wheel over the tabs scrolls them sideways (a mouse has no horizontal wheel). */
	function onwheel(e: WheelEvent) {
		if (!scroller || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
		scroller.scrollLeft += e.deltaY;
		e.preventDefault();
	}
</script>

<div class="strip" data-gesture-zone use:swipe={swipeOptions}>
	<div class="tabs" bind:this={scroller} {onwheel} role="tablist">
		{@render tabList()}
	</div>
	{@render actions()}
	<div class="fill" data-tauri-drag-region></div>
</div>

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 32px;
		padding: 0 6px;
		border-bottom: 0.5px solid var(--ca-outline-subtle);
	}
	/* Only the tabs scroll. `min-width: 0` lets the scroller shrink below its content: otherwise flexbox grows it past the
	   strip and the actions after it leave with the overflow. */
	.tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 0 1 auto;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.fill {
		flex: 1;
		align-self: stretch;
		min-width: 8px;
	}
</style>
