<script lang="ts">
	/** One theme in the picker: live miniature, name, badges and the overflow menu (export / remove). */
	import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@codeatlasdev/ui";
	import { Check, Ellipsis, Moon, Sun } from "@lucide/svelte";
	import type { Theme } from "#lib/theme.ts";
	import ThemePreview from "./ThemePreview.svelte";
	import { previewModel } from "./preview.ts";

	let {
		theme,
		selected,
		tabindex,
		onpick,
		onpreview,
		oncopy,
		onsave,
		onremove,
		cardEl = $bindable(),
	}: {
		theme: Theme;
		selected: boolean;
		tabindex: 0 | -1;
		onpick: () => void;
		onpreview: (on: boolean) => void;
		oncopy: (format: "json" | "ghostty") => void;
		onsave: (format: "json" | "ghostty") => void;
		onremove: () => void;
		cardEl?: HTMLElement;
	} = $props();

	const DEFAULTS: Record<string, true> = { Dracula: true, Alucard: true };

	let m = $derived(previewModel(theme));
	let isDefault = $derived(theme.source === "bundled" && Object.hasOwn(DEFAULTS, theme.name));
	let Icon = $derived(theme.appearance === "dark" ? Moon : Sun);
</script>

<div class="card" class:selected>
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<div
		bind:this={cardEl}
		class="hit"
		role="radio"
		aria-checked={selected}
		aria-label="{theme.name}, {theme.appearance}{isDefault ? ', default' : ''}{theme.source === 'user'
			? ', yours'
			: ''}"
		{tabindex}
		data-theme-card={theme.name}
		onclick={onpick}
		onpointerenter={() => onpreview(true)}
		onpointerleave={() => onpreview(false)}
		onfocus={() => onpreview(true)}
		onblur={() => onpreview(false)}
		onkeydown={(e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onpick();
			}
		}}
	>
		<ThemePreview {m} />
		<div class="meta">
			<Icon size={12} aria-hidden="true" />
			<span class="name">{theme.name}</span>
			{#if isDefault}<span class="badge">Default</span>{/if}
			{#if theme.source === "user"}<span class="badge yours">Yours</span>{/if}
			{#if selected}<Check size={13} class="tick" aria-hidden="true" />{/if}
		</div>
	</div>
	<div class="more">
		<DropdownMenu align="end">
			{#snippet triggerChild(props)}
				<button
					{...props}
					class="menu-btn"
					aria-label="{theme.name} options"
					onfocus={() => onpreview(false)}
				>
					<Ellipsis size={14} />
				</button>
			{/snippet}
			<DropdownMenuItem onclick={() => oncopy("json")}>Copy as JSON</DropdownMenuItem>
			<DropdownMenuItem onclick={() => oncopy("ghostty")}>Copy as Ghostty config</DropdownMenuItem>
			<DropdownMenuItem onclick={() => onsave("json")}>Save as JSON…</DropdownMenuItem>
			<DropdownMenuItem onclick={() => onsave("ghostty")}>Save as Ghostty config…</DropdownMenuItem>
			{#if theme.source === "user"}
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onclick={onremove}>Remove…</DropdownMenuItem>
			{/if}
		</DropdownMenu>
	</div>
</div>

<style>
	.card {
		position: relative;
		border-radius: 12px;
		min-width: 0;
	}
	.hit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 6px 8px;
		border-radius: 12px;
		background: var(--ca-surface-base);
		box-shadow: 0 0 0 0.5px var(--ca-outline-subtle);
		cursor: pointer;
		outline: none;
	}
	.hit:hover {
		background: var(--ca-action-hover);
	}
	.selected .hit {
		box-shadow:
			0 0 0 2px var(--atlas-focus-ring, var(--ca-brand-main)),
			0 0 0 0.5px var(--ca-outline-subtle);
	}
	.hit:focus-visible {
		box-shadow:
			0 0 0 2px var(--ca-surface-raised),
			0 0 0 4px var(--atlas-focus-ring, var(--ca-brand-main));
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px;
		min-width: 0;
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 550;
		color: var(--ca-text-primary);
	}
	.badge {
		flex-shrink: 0;
		padding: 0 5px;
		border-radius: 999px;
		font-size: 10px;
		line-height: 15px;
		color: var(--ca-text-secondary);
		box-shadow: inset 0 0 0 0.5px var(--ca-outline-subtle);
	}
	.badge.yours {
		color: var(--ca-brand-main);
	}
	.meta :global(.tick) {
		flex-shrink: 0;
		color: var(--atlas-focus-ring, var(--ca-brand-main));
	}
	.more {
		position: absolute;
		top: 10px;
		right: 10px;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.card:hover .more,
	.card:focus-within .more,
	.more:has([data-state="open"]) {
		opacity: 1;
	}
	.menu-btn {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 6px;
		color: var(--ca-text-primary);
		background: var(--ca-surface-raised);
		box-shadow: 0 0 0 0.5px var(--ca-outline-subtle);
	}
	.menu-btn:focus-visible {
		outline: 2px solid var(--atlas-focus-ring, var(--ca-brand-main));
		outline-offset: 1px;
	}
</style>
