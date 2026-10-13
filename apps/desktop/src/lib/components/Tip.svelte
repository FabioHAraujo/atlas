<script lang="ts">
	import { Tooltip } from "@codeatlasdev/ui";
	import { tick, type Snippet } from "svelte";
	import { shortcutFor } from "#lib/keymap.svelte.ts";

	/**
	 * Tooltip for an interactive control; appends the command's current key binding
	 * (it follows user remaps), e.g. "Toggle left dock  ⌘B".
	 *
	 * The tooltip itself (the kit's provider, root, trigger and portal state) is built on the first
	 * pointer or focus event that reaches the control, not at mount: a mounted space layer carries
	 * a dozen of these and none is needed until someone points at it. Mounting them all was a
	 * measurable part of every space switch.
	 */
	let {
		label,
		command,
		side = "bottom",
		child,
	}: {
		label: string;
		/** Command id whose binding is shown next to the label. */
		command?: string;
		side?: "top" | "bottom" | "left" | "right";
		/** The control; spread `props` onto it. */
		child: Snippet<[Record<string, unknown>]>;
	} = $props();

	let keys = $derived(command ? shortcutFor(command) : undefined);
	let armed = $state(false);
	let wrap: HTMLElement | undefined = $state();

	/**
	 * Build the tooltip, then replay the event that woke it on the new trigger so the first hover still opens
	 * it. The swap re-creates the control, so keyboard focus is put back on its replacement.
	 */
	async function arm(e: Event) {
		if (armed) return;
		const wasFocused = !!wrap?.contains(document.activeElement);
		armed = true;
		await tick();
		// The tooltip's trigger renders the control itself: the first focusable inside the wrapper is it.
		const control = wrap?.querySelector<HTMLElement>("button, a[href], input, select, textarea, [tabindex]");
		if (wasFocused) control?.focus({ preventScroll: true });
		// bits-ui listens for `pointerenter` (which does not bubble, so a wrapper cannot hear it itself).
		control?.dispatchEvent(
			new Event(e.type === "pointerover" ? "pointerenter" : e.type, { bubbles: e.type === "focusin" }),
		);
	}
</script>

<!-- Permanent wrapper (transparent to layout): the listeners outlive the swap from bare control to tooltip. -->
<span class="tip" bind:this={wrap} onpointerover={arm} onfocusin={arm} role="presentation">
	{#if armed}
		<Tooltip content={keys ? `${label}  ${keys}` : label} {side} delay={400} triggerChild={child} />
	{:else}
		{@render child({})}
	{/if}
</span>

<style>
	/* Transparent to layout: the control sits exactly where it did without the wrapper. */
	.tip {
		display: contents;
	}
</style>
