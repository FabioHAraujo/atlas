<script lang="ts">
	/**
	 * The content area as a pager: the current space and its previous/next neighbours are mounted
	 * as full-width layers. A switch never mounts the incoming space; it only moves transforms
	 * (`spacePager`, pager.ts) and flips roles. Neighbours rest hidden (`content-visibility`,
	 * `inert`) so they cost no layout or paint until a gesture (or `warm`) shows them.
	 */
	import { onMount, tick } from "svelte";
	import { spacePager } from "#lib/shell/pager.ts";
	import { shell } from "#lib/shell/shell.svelte.ts";
	import { neighbour } from "#lib/shell/space.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";
	import SpaceSlot from "./SpaceSlot.svelte";

	let root: HTMLElement | undefined = $state();
	/** A gesture or spring is running: natives parked, the ids in `kept` stay mounted. */
	let moving = $state(false);
	let kept = $state<string[]>([]);
	const layers: Record<string, HTMLElement> = {};

	/** Which side a layer parks on at rest: the previous neighbour (wrap included) on the left, the rest on the right. */
	const side = (id: string) =>
		id === neighbour(shell.spaceIds, shell.activeId, -1) &&
		id !== neighbour(shell.spaceIds, shell.activeId, 1)
			? "prev"
			: "next";

	/** Current space + sidebar neighbours + whatever a running switch still needs. */
	let ids = $derived.by(() => {
		const act = shell.activeId;
		if (!act) return [];
		const list = [act];
		for (const d of [-1, 1] as const) {
			const n = neighbour(shell.spaceIds, act, d);
			if (n && !list.includes(n)) list.push(n);
		}
		for (const k of kept) if (k && !list.includes(k)) list.push(k);
		return list;
	});

	function layer(node: HTMLElement, id: string) {
		layers[id] = node;
		return {
			destroy() {
				if (layers[id] === node) delete layers[id];
			},
		};
	}

	onMount(() =>
		spacePager.attach({
			layer: (id) => layers[id],
			width: () => root?.clientWidth ?? 0,
			ids: () => shell.spaceIds,
			active: () => shell.activeId,
			commit: (id) => shell.commitSpace(id),
			moving(on, keep) {
				kept = on ? (keep ?? []) : [];
				moving = on;
			},
			flush: () => tick(),
		}),
	);
</script>

<div class="pager" bind:this={root} class:moving>
	{#each ids as id (id)}
		{@const current = id === shell.activeId}
		<div
			class="space-layer"
			data-space={id}
			data-role={current ? "current" : "near"}
			data-side={current ? undefined : side(id)}
			inert={!current}
			aria-hidden={current ? undefined : true}
			use:layer={id}
		>
			<SpaceSlot {id} {current} {moving} />
		</div>
	{/each}
</div>

<style>
	.pager {
		position: relative;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	/* Layers are stacked, each the size of the pager; position comes from `translate3d`, written
	   by pager.ts only while a switch runs. At rest the current layer has no transform at all. */
	.space-layer {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	/* At rest a neighbour is parked one page away, laid out and composited but out of reach (inert,
	   no hit-testing, not in the a11y tree), so a gesture only has to move a transform: no layout
	   or first paint at gesture start. `contain` keeps its updates from touching the current layer. */
	.space-layer[data-role="near"] {
		contain: layout paint style;
		pointer-events: none;
		will-change: transform;
		transform: translate3d(100%, 0, 0);
	}
	.space-layer[data-side="prev"] {
		transform: translate3d(-100%, 0, 0);
	}
	/* Inline `transform` (pager.ts) wins over the parked offset while a switch runs. */
	.pager.moving .space-layer {
		will-change: transform;
	}
</style>
