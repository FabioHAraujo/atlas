<script lang="ts">
	import { Button, Select, SegmentedControl, THEME_PRESETS, colorScheme } from "@codeatlasdev/ui";
	import { Check, FolderOpen, Monitor, Moon, Sun, Upload } from "@lucide/svelte";
	import { themes } from "#lib/stores/theme.svelte.ts";
	import { readableOn } from "#lib/theme/color.ts";
	import Group from "./Group.svelte";
	import Row from "./Row.svelte";
	import { copyTheme, revealThemesFolder, saveTheme } from "./theme/actions.ts";
	import CreditCard from "./theme/CreditCard.svelte";
	import GhosttyBanner from "./theme/GhosttyBanner.svelte";
	import ImportDialog from "./theme/ImportDialog.svelte";
	import TerminalThemeSelect from "./theme/TerminalThemeSelect.svelte";
	import ThemeGrid from "./theme/ThemeGrid.svelte";
	import ThemeIssues from "./theme/ThemeIssues.svelte";

	const MODES = [
		{ value: "system", label: "System", icon: Monitor },
		{ value: "light", label: "Light", icon: Sun },
		{ value: "dark", label: "Dark", icon: Moon },
	];

	let importing = $state(false);
	/** Theme the Export row acts on; follows the active theme until the user picks another. */
	let exportName = $state<string | null>(null);
	let exportTarget = $derived(exportName ?? themes.current?.name ?? "");
	const options = (names: string[]) => names.map((n) => ({ value: n, label: n }));
</script>

<GhosttyBanner />

<Group title="Color theme">
	<Row
		id="theme-mode"
		label="Theme"
		description="Follow your system's appearance, or always use light or dark."
	>
		<SegmentedControl
			aria-label="Theme"
			size="sm"
			value={themes.selection.mode}
			items={MODES}
			onchange={(v) => void themes.setTheme({ mode: v as "system" | "light" | "dark" })}
		/>
	</Row>
	<CreditCard />
	<ThemeGrid />
	<Row id="theme-light" label="Light theme" description="Colors used in light mode.">
		<div class="select">
			<Select
				size="sm"
				value={themes.selection.light}
				options={options(themes.names.light)}
				onchange={(v) => void themes.setTheme({ light: v })}
			/>
		</div>
	</Row>
	<Row id="theme-dark" label="Dark theme" description="Colors used in dark mode.">
		<div class="select">
			<Select
				size="sm"
				value={themes.selection.dark}
				options={options(themes.names.dark)}
				onchange={(v) => void themes.setTheme({ dark: v })}
			/>
		</div>
	</Row>
	<Row
		id="theme-terminal"
		label="Terminal theme"
		description="Colors of terminals and agents. Same as app follows the theme above."
	>
		<TerminalThemeSelect />
	</Row>
	<ThemeIssues />
</Group>

<Group title="Import and export">
	<Row
		id="theme-import"
		stack
		label="Import theme"
		description="From Ghostty, iTerm, VS Code, Alacritty or Base16, or a zip or folder of themes. Your themes live in ~/.atlas/themes and reload as you save."
	>
		<Button size="sm" variant="outlined" onclick={() => (importing = true)}>
			<Upload size={13} /> Import…
		</Button>
		<Button size="sm" variant="ghost" onclick={revealThemesFolder}>
			<FolderOpen size={13} /> Reveal themes folder
		</Button>
	</Row>
	<Row
		id="theme-export"
		stack
		label="Export theme"
		description="Share a theme as JSON or as a Ghostty config."
	>
		<div class="select">
			<Select
				size="sm"
				value={exportTarget}
				options={options(themes.list.map((t) => t.name))}
				onchange={(v) => (exportName = v)}
			/>
		</div>
		<Button
			size="sm"
			variant="outlined"
			disabled={!exportTarget}
			onclick={() => copyTheme(exportTarget, "json")}
		>
			Copy as JSON
		</Button>
		<Button
			size="sm"
			variant="outlined"
			disabled={!exportTarget}
			onclick={() => copyTheme(exportTarget, "ghostty")}
		>
			Copy as Ghostty config
		</Button>
		<Button
			size="sm"
			variant="ghost"
			disabled={!exportTarget}
			onclick={() => saveTheme(exportTarget, "json")}
		>
			Save to file…
		</Button>
	</Row>
</Group>

<Group title="Accent color">
	<Row id="accent" label="Accent color" description="Highlights buttons, selections and focus.">
		<div class="swatches">
			{#each THEME_PRESETS as t (t.id)}
				<button
					class="sw"
					class:on={colorScheme.preset === t.id}
					style="--sw: {t.swatchColor}; --on: {readableOn(t.swatchColor)}"
					title={t.label}
					aria-label={t.label}
					aria-pressed={colorScheme.preset === t.id}
					onclick={() => colorScheme.setPreset(t.id)}
				>
					{#if colorScheme.preset === t.id}<Check size={13} />{/if}
				</button>
			{/each}
		</div>
	</Row>
</Group>

<ImportDialog bind:open={importing} />

<style>
	.select {
		width: 200px;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 10px;
		max-width: 260px;
	}
	.sw {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 0;
		background: var(--sw);
		color: var(--on);
		display: grid;
		place-items: center;
		box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2);
	}
	.sw.on {
		box-shadow:
			0 0 0 2px var(--ca-surface-raised),
			0 0 0 4px var(--sw);
	}
</style>
