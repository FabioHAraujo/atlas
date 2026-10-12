<script lang="ts">
	import type { Snippet } from "svelte";
	import { Drawer } from "@codeatlasdev/ui";

	/** Right-hand drawer with the column layout both panel drawers (activity, action output) use. */
	let {
		open = $bindable(false),
		title,
		width,
		children,
	}: { open: boolean; title: string; width: string; children: Snippet } = $props();
</script>

<Drawer bind:open side="right" {title} {width}>
	<div class="wrap">{@render children()}</div>
</Drawer>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 0;
		height: 100%;
	}
</style>
