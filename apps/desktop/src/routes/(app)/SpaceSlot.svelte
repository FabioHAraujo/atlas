<script lang="ts">
	/**
	 * One mounted space layer. The current space reads the live selection (identical to a single
	 * page); a neighbour reads the worktree it would land on, so committing a switch changes no
	 * prop of the tree below and nothing remounts.
	 */
	import { untrack } from "svelte";
	import { provideSpace } from "#lib/shell/spaceCtx.ts";
	import { shell } from "#lib/shell/shell.svelte.ts";
	import { store } from "#lib/stores/projects.svelte.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";
	import SpaceView from "./SpaceView.svelte";

	let { id, current, moving }: { id: string; current: boolean; moving: boolean } = $props();

	let worktreeId = $derived(current ? ws.doc.selected : shell.landing(id));
	let worktree = $derived(ws.worktree(worktreeId));
	let project = $derived(
		store.projects.find((p) => p.id === (current ? store.selected : worktreeId)) ?? null,
	);

	provideSpace({
		get id() {
			return id;
		},
		get current() {
			return current;
		},
		get live() {
			return current && !moving;
		},
		get worktree() {
			return worktree;
		},
		get project() {
			return project;
		},
	});

	// A neighbour has never been "selected": give it the layout and Panel tab `ws.select` would.
	$effect(() => {
		const wid = worktreeId;
		if (current || !wid || !ws.loaded || !ws.worktree(wid)) return;
		untrack(() => {
			ws.ensureLayout(wid);
			ws.ensurePanel(wid);
		});
	});
</script>

<SpaceView />
