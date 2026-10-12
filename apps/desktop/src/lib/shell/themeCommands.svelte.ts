/** Palette commands for themes (`Theme: <name>`, next/previous, import, Ghostty) and the one-time Ghostty offer. */
import { toast } from "@codeatlasdev/ui";
import type { Command } from "#lib/keymap.svelte.ts";
import { register } from "#lib/keymap.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";
import { updates } from "#lib/stores/updates.svelte.ts";
import type { Theme } from "#lib/theme.ts";

/** Select `t` for its own appearance; the other appearance's slot does not change what is on screen. */
export function useTheme(t: Theme) {
	const showing = themes.current?.appearance;
	void themes.setTheme({ [t.appearance]: t.name });
	if (showing && showing !== t.appearance) toast.info(`Used in ${t.appearance} mode`);
}

export function themeCommands(): Command[] {
	return [
		...themes.list.map((t) => ({
			id: `theme::Set:${t.name}`,
			label: `Theme: ${t.name}`,
			run: () => useTheme(t),
		})),
		{ id: "theme::Next", label: "Theme: Next", run: () => themes.cycle(1) },
		{ id: "theme::Previous", label: "Theme: Previous", run: () => themes.cycle(-1) },
		{ id: "theme::Import", label: "Theme: Import…", run: () => updates.show("appearance") },
		{
			id: "theme::UseGhostty",
			label: "Theme: Use Ghostty theme",
			run: () => updates.show("appearance"),
			when: () => themes.ghostty.available,
		},
		{
			id: "terminal-theme::App",
			label: "Terminal theme: Same as app",
			run: () => void themes.setTheme({ terminal: "app" }),
		},
		...themes.list.map((t) => ({
			id: `terminal-theme::Set:${t.name}`,
			label: `Terminal theme: ${t.name}`,
			run: () => void themes.setTheme({ terminal: t.name }),
		})),
	];
}

/**
 * Keeps the registry in step with `themes.list` (user themes appear and disappear as files change).
 * Call inside a reactive root; returns the disposer.
 */
export function startThemeCommands(): () => void {
	let unregister = () => {};
	const stop = $effect.root(() => {
		$effect(() => {
			const off = register(themeCommands());
			unregister();
			unregister = off;
		});
	});
	return () => {
		stop();
		unregister();
	};
}

/** Drives `GhosttyOffer.svelte`: set once, after `themes.init()`, while the offer is still live. */
export const ghosttyOffer = $state({ shown: false });

/** Offer the Ghostty theme once per session; it never applies anything by itself. */
export function offerGhostty() {
	if (themes.ghostty.offered) ghosttyOffer.shown = true;
}

/** The toast's `Use theme` button: open Settings > Appearance, where the banner applies it. */
export function openGhosttyOffer() {
	ghosttyOffer.shown = false;
	updates.show("appearance");
}
