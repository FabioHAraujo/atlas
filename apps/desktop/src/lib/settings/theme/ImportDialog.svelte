<script lang="ts">
	/**
	 * Import a theme: pick a file (Ghostty config, .itermcolors, VS Code theme JSON, Base16 yaml, Atlas/Zed
	 * family JSON), drop one on the dialog, or paste the text. Shows what was detected before anything is saved.
	 */
	import { Button, Checkbox, Dialog, Select, TextArea, TextField, toast } from "@codeatlasdev/ui";
	import { TriangleAlert, Upload } from "@lucide/svelte";
	import { homeDir } from "@tauri-apps/api/path";
	import { open as pickFile } from "@tauri-apps/plugin-dialog";
	import { errText } from "#lib/api.ts";
	import { b64decode, host } from "#lib/host.ts";
	import { themes } from "#lib/stores/theme.svelte.ts";
	import type { ImportResult } from "#lib/theme/import/color.ts";
	import { detectFormat, importAny, type ThemeFormat } from "#lib/theme/import/detect.ts";
	import ImportPreview from "./ImportPreview.svelte";

	let { open = $bindable(false) }: { open: boolean } = $props();

	const FORMAT_LABEL: Record<ThemeFormat, string> = {
		ghostty: "Ghostty config",
		iterm: "iTerm colors",
		vscode: "VS Code theme",
		base16: "Base16 scheme",
		zed: "Zed theme file",
		atlas: "Atlas theme file",
	};
	const FILE_FILTER = [
		{ name: "Theme", extensions: ["json", "jsonc", "itermcolors", "yaml", "yml", "conf", "txt"] },
		{ name: "Any file", extensions: ["*"] },
	];

	let fileName = $state("");
	let text = $state("");
	let format = $state<ThemeFormat | null>(null);
	let result = $state<ImportResult | null>(null);
	let error = $state<string | null>(null);
	let name = $state("");
	let appearance = $state<"dark" | "light">("dark");
	let applyFont = $state(false);
	let select = $state(true);
	let busy = $state(false);
	let dragging = $state(false);

	/** Zed/Atlas families are copied verbatim; every other format is converted to an `ImportResult`. */
	let copyOnly = $derived(format === "zed" || format === "atlas");
	let hasPrefs = $derived(!!result && (!!result.font || !!result.terminal));
	let ready = $derived(copyOnly || !!result);
	let preview = $derived<ImportResult | null>(result && { ...result, name, appearance });

	// A closed dialog starts empty again.
	$effect(() => {
		if (open) return;
		fileName = text = name = "";
		format = null;
		result = error = null;
		applyFont = false;
		select = true;
	});

	async function analyze() {
		result = error = null;
		format = text.trim() ? detectFormat(fileName, text) : null;
		if (!text.trim()) return;
		try {
			const home = await homeDir();
			const outcome = await importAny(fileName || "pasted", text, {
				home,
				readFile: async (p) => {
					try {
						return b64decode((await host.fsRead(p, 2_000_000)).data);
					} catch {
						return null;
					}
				},
				themeDirs: [
					`${home}/.config/ghostty/themes`,
					"/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
				],
				appearance: themes.current?.appearance ?? "dark",
			});
			format = outcome.kind;
			if ("result" in outcome) {
				result = outcome.result;
				name = outcome.result.name;
				appearance = outcome.result.appearance;
				applyFont = !!(outcome.result.font || outcome.result.terminal);
			}
		} catch (e) {
			error = errText(e);
		}
	}

	async function load(path: string, content: string) {
		fileName = path;
		text = content;
		await analyze();
	}

	async function choose() {
		const path = await pickFile({ title: "Import a theme", multiple: false, filters: FILE_FILTER });
		if (typeof path !== "string") return;
		try {
			await load(path, b64decode((await host.fsRead(path, 2_000_000)).data));
		} catch (e) {
			error = errText(e);
		}
	}

	async function drop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files[0];
		if (file) await load(file.name, await file.text());
	}

	/** Copy a Zed/Atlas family file as is into `~/.atlas/themes`. */
	async function copyFamily() {
		const dir = `${await homeDir()}/.atlas/themes`;
		const base = (fileName.split("/").pop() || "theme.json").replace(/\.[^.]+$/, "");
		await host.fsMkdir(dir).catch(() => {});
		await host.fsWrite(`${dir}/${base || "theme"}.json`, text);
		await themes.reload();
		toast.success("Theme file added");
	}

	async function run() {
		busy = true;
		try {
			if (copyOnly) await copyFamily();
			else if (preview) {
				const t = await themes.importResult(preview, { applyFont: applyFont && hasPrefs, select });
				toast.success(select ? `Using ${t.name}` : `Imported ${t.name}`);
			}
			open = false;
		} catch (e) {
			error = errText(e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open
	title="Import a theme"
	description="Ghostty config, iTerm colors, VS Code theme, Base16 scheme or an Atlas / Zed theme file."
	size="lg"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="body"
		class:dragging
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={drop}
	>
		<div class="pick">
			<Button variant="outlined" onclick={choose}><Upload size={13} /> Choose file…</Button>
			<span class="hint">or drop a file here, or paste its text below</span>
		</div>
		<TextArea
			label="Theme text"
			rows={5}
			placeholder="palette = 0=#21222c&#10;background = #282a36"
			bind:value={text}
			oninput={() => {
				fileName = "";
			}}
			onchange={analyze}
		/>

		{#if error}
			<p class="error" role="alert"><TriangleAlert size={13} /> {error}</p>
		{:else if format}
			<p class="detected" role="status">
				Detected: <b>{FORMAT_LABEL[format]}</b>
				{#if copyOnly}· the file is added to your themes as it is{/if}
			</p>
		{/if}

		{#if preview && result}
			<div class="grid">
				<div class="fields">
					<TextField label="Name" bind:value={name} />
					<Select
						label="Appearance"
						value={appearance}
						options={[
							{ value: "dark", label: "Dark" },
							{ value: "light", label: "Light" },
						]}
						onchange={(v) => (appearance = v as "dark" | "light")}
					/>
					{#if hasPrefs}
						<Checkbox bind:checked={applyFont} label="Also use its font and cursor settings" />
					{/if}
					<Checkbox bind:checked={select} label={`Use as ${appearance} theme`} />
				</div>
				<ImportPreview result={preview} {name} />
			</div>
			{#if result.warnings.length}
				<ul class="warnings" aria-label="Import warnings">
					{#each result.warnings as w, i (i)}<li>{w}</li>{/each}
				</ul>
			{/if}
		{/if}
	</div>

	{#snippet actions()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!ready || busy || (!copyOnly && !name.trim())} loading={busy} onclick={run}
			>Import</Button
		>
	{/snippet}
</Dialog>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-radius: 10px;
	}
	.body.dragging {
		outline: 2px dashed var(--atlas-focus-ring, var(--ca-brand-main));
		outline-offset: 4px;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.hint {
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
	.detected,
	.error {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 12.5px;
		color: var(--ca-text-secondary);
	}
	.error {
		color: var(--ca-semantic-error);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 240px;
		gap: 16px;
		align-items: start;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.warnings {
		margin: 0;
		padding: 8px 10px 8px 26px;
		border-radius: 8px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--ca-text-secondary);
		background: color-mix(in oklab, var(--ca-semantic-warning) 10%, transparent);
	}
</style>
