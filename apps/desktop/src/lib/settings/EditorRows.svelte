<script lang="ts">
	import { SegmentedControl, Switch } from "@codeatlasdev/ui";
	import type { EditorPrefs } from "#lib/prefs.ts";
	import { prefs } from "#lib/stores/prefs.svelte.ts";
	import Group from "./Group.svelte";
	import NumInput from "./NumInput.svelte";
	import Row from "./Row.svelte";
	import { savePref } from "./savePref.ts";
	import { formatRulers, parseRulers } from "./rulers.ts";
	import TextInput from "./TextInput.svelte";

	let e = $derived(prefs.value.editor);
	const save = (patch: Partial<EditorPrefs>) => savePref("editor", { ...e, ...patch });
</script>

<Group title="Editing">
	<Row id="editor-tab-size" label="Tab size" description="Columns a tab or one level of indentation spans.">
		<NumInput label="Tab size" unit="columns" value={e.tab_size} onchange={(v) => save({ tab_size: v })} />
	</Row>
	<Row
		id="editor-insert-spaces"
		label="Indent with spaces"
		description="Pressing Tab inserts spaces. Turn off to insert tab characters."
	>
		<Switch
			aria-label="Indent with spaces"
			checked={e.insert_spaces}
			onchange={(v) => save({ insert_spaces: v })}
		/>
	</Row>
	<Row
		id="editor-trim-whitespace"
		label="Trim trailing whitespace on save"
		description="Remove spaces and tabs at the end of lines when you save."
	>
		<Switch
			aria-label="Trim trailing whitespace on save"
			checked={e.trim_trailing_whitespace_on_save}
			onchange={(v) => save({ trim_trailing_whitespace_on_save: v })}
		/>
	</Row>
	<Row
		id="editor-final-newline"
		label="Add a final newline on save"
		description="End every file with exactly one newline when you save."
	>
		<Switch
			aria-label="Add a final newline on save"
			checked={e.insert_final_newline_on_save}
			onchange={(v) => save({ insert_final_newline_on_save: v })}
		/>
	</Row>
	<Row
		id="editor-auto-reload"
		label="Reload files changed on disk"
		description="Update an open file when another program changes it, as long as you have no unsaved edits in it."
	>
		<Switch
			aria-label="Reload files changed on disk"
			checked={e.auto_reload}
			onchange={(v) => save({ auto_reload: v })}
		/>
	</Row>
	<Row
		id="editor-large-file"
		label="Large file limit"
		description="Files bigger than this open in a light mode without language features, so the editor stays fast. 0.1 to 100 MB."
	>
		<NumInput
			label="Large file limit"
			unit="MB"
			value={e.large_file_threshold_bytes / 1_000_000}
			onchange={(v) => save({ large_file_threshold_bytes: Math.round(v * 1_000_000) })}
		/>
	</Row>
</Group>

<Group title="Display">
	<Row id="editor-word-wrap" label="Word wrap" description="Wrap long lines at the edge of the editor.">
		<Switch aria-label="Word wrap" checked={e.word_wrap} onchange={(v) => save({ word_wrap: v })} />
	</Row>
	<Row id="editor-line-numbers" label="Line numbers" description="Show line numbers in the gutter.">
		<Switch aria-label="Line numbers" checked={e.line_numbers} onchange={(v) => save({ line_numbers: v })} />
	</Row>
	<Row
		id="editor-highlight-line"
		label="Highlight the current line"
		description="Tint the line the cursor is on."
	>
		<Switch
			aria-label="Highlight the current line"
			checked={e.highlight_active_line}
			onchange={(v) => save({ highlight_active_line: v })}
		/>
	</Row>
	<Row id="editor-whitespace" label="Show whitespace" description="Draw dots for spaces and arrows for tabs.">
		<SegmentedControl
			aria-label="Show whitespace"
			size="sm"
			value={e.render_whitespace}
			items={[
				{ value: "none", label: "Never" },
				{ value: "selection", label: "In selection" },
				{ value: "all", label: "Always" },
			]}
			onchange={(v) => save({ render_whitespace: v as EditorPrefs["render_whitespace"] })}
		/>
	</Row>
	<Row
		id="editor-indent-guides"
		label="Indent guides"
		description="Draw a faint vertical line at each level of indentation."
	>
		<Switch
			aria-label="Indent guides"
			checked={e.indent_guides}
			onchange={(v) => save({ indent_guides: v })}
		/>
	</Row>
	<Row
		id="editor-bracket-colors"
		label="Color matching brackets"
		description="Give each level of nested brackets its own color."
	>
		<Switch
			aria-label="Color matching brackets"
			checked={e.bracket_pair_colorization}
			onchange={(v) => save({ bracket_pair_colorization: v })}
		/>
	</Row>
	<Row
		id="editor-sticky-scroll"
		label="Sticky scroll"
		description="Keep the enclosing function or class pinned at the top while you scroll its body."
	>
		<Switch
			aria-label="Sticky scroll"
			checked={e.sticky_scroll}
			onchange={(v) => save({ sticky_scroll: v })}
		/>
	</Row>
	<Row id="editor-minimap" label="Minimap" description="Show a small overview of the file on the right.">
		<Switch aria-label="Minimap" checked={e.minimap} onchange={(v) => save({ minimap: v })} />
	</Row>
	<Row
		id="editor-rulers"
		label="Rulers"
		description="Columns where a vertical line is drawn, such as 80 or 100. Separate several with commas."
	>
		<TextInput
			mono
			width="120px"
			label="Rulers"
			placeholder="80, 100"
			value={formatRulers(e.rulers)}
			onchange={(v) => save({ rulers: parseRulers(v) })}
		/>
	</Row>
	<Row
		id="editor-scroll-past-end"
		label="Scroll past the last line"
		description="Let the last line scroll up to the top of the editor."
	>
		<Switch
			aria-label="Scroll past the last line"
			checked={e.scroll_past_end}
			onchange={(v) => save({ scroll_past_end: v })}
		/>
	</Row>
	<Row
		id="editor-smooth-scroll"
		label="Smooth scrolling"
		description="Animate scrolling when you jump to a line or use the keyboard."
	>
		<Switch
			aria-label="Smooth scrolling"
			checked={e.smooth_scrolling}
			onchange={(v) => save({ smooth_scrolling: v })}
		/>
	</Row>
</Group>
