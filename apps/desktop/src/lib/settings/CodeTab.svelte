<script lang="ts">
	import { Switch } from "@codeatlasdev/ui";
	import { prefs } from "#lib/stores/prefs.svelte.ts";
	import { updates } from "#lib/stores/updates.svelte.ts";
	import EditorRows from "./EditorRows.svelte";
	import FontRows from "./FontRows.svelte";
	import Group from "./Group.svelte";
	import NumInput from "./NumInput.svelte";
	import Row from "./Row.svelte";
	import { savePref } from "./savePref.ts";

	let p = $derived(prefs.value);
</script>

<Group title="Code font">
	<FontRows
		idPrefix="buffer"
		mono
		familyLabel="Code font"
		familyDescription="Font for the editor and diffs."
		sizeLabel="Code font size"
		sizeDescription="Text size in the editor and diffs."
		family={p.buffer_font_family}
		size={p.buffer_font_size}
		onfamily={(v) => savePref("buffer_font_family", v)}
		onsize={(v) => savePref("buffer_font_size", v)}
	>
		{#snippet extra()}
			<Row
				id="buffer-line-height"
				label="Line spacing"
				description="Space between lines, as a multiple of the font size. 1.5 is comfortable."
			>
				<NumInput
					label="Line spacing"
					unit="×"
					value={p.buffer_line_height}
					onchange={(v) => savePref("buffer_line_height", v)}
				/>
			</Row>
		{/snippet}
		{#snippet preview()}
			<pre
				class="sample"
				style="font-family: {p.buffer_font_family}; font-size: {p.buffer_font_size}px; line-height: {p.buffer_line_height}">const answer = items.filter((x) =&gt; x.ok).length;
if (answer !== 42) throw new Error("not yet");</pre>
		{/snippet}
	</FontRows>
</Group>

<EditorRows />

<Group
	title="Language servers"
	description="Which servers are installed, custom commands and options are in the Languages tab."
>
	<Row
		id="lsp-enable"
		label="Language servers"
		description="Completion, diagnostics, hover and go to definition from the language's server (downloaded on first use)."
	>
		<Switch
			aria-label="Language servers"
			checked={p.enable_language_servers}
			onchange={(v) => savePref("enable_language_servers", v)}
		/>
	</Row>
	<Row
		id="lsp-format-on-save"
		label="Format on save"
		description="Format the file with its language server every time it is saved."
	>
		<Switch
			aria-label="Format on save"
			checked={p.format_on_save}
			onchange={(v) => savePref("format_on_save", v)}
		/>
	</Row>
	<Row
		id="lsp-inlay-hints"
		label="Inlay hints"
		description="Show inferred types and parameter names inline, dimmed."
	>
		<Switch
			aria-label="Inlay hints"
			checked={p.inlay_hints.enabled}
			onchange={(v) => savePref("inlay_hints", { enabled: v })}
		/>
	</Row>
	<Row
		id="lsp-manage"
		label="Manage language servers"
		description="Install, update or replace the server of each language."
	>
		<button class="link" onclick={() => updates.show("appearance/languages")}>Open Languages</button>
	</Row>
</Group>

<style>
	.link {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--ca-text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.link:hover {
		color: var(--ca-text-primary);
	}
	.sample {
		margin: 0;
		padding: 10px 12px;
		border-radius: 8px;
		overflow: auto;
		background: var(--ca-surface-sunken);
		color: var(--ca-text-primary);
		user-select: text;
		-webkit-user-select: text;
	}
</style>
