<script lang="ts">
	// Test host for Overlay: provides a space context (`current` is a prop) and counts how many times the
	// wrapped overlay was actually built (the kit overlay it stands for is a bits-ui Portal; bun cannot load it).
	import type { Snippet } from "svelte";
	import Overlay from "#lib/components/Overlay.svelte";
	import { provideSpace } from "#lib/shell/spaceKey.ts";

	let {
		current = false,
		width,
		height,
		fill = false,
		children,
	}: { current?: boolean; width?: number; height?: number; fill?: boolean; children: Snippet } = $props();

	provideSpace({
		id: "s",
		get current() {
			return current;
		},
		get live() {
			return current;
		},
		worktree: undefined,
		project: null,
	});

	function built() {
		(globalThis as { __overlayBuilt?: number }).__overlayBuilt =
			((globalThis as { __overlayBuilt?: number }).__overlayBuilt ?? 0) + 1;
	}
</script>

<Overlay {width} {height} {fill}>
	{(built(), "")}
	{@render children()}
</Overlay>
