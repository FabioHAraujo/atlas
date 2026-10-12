<script lang="ts">
	/**
	 * Miniature IDE drawn from one theme's data: a gutter, code sample in the theme's syntax roles,
	 * an active line, a selection, an ANSI terminal strip and the accent/surface chips. Every color
	 * comes from the model; nothing here is hard-coded.
	 */
	import type { PreviewModel } from "./preview.ts";
	import { ACTIVE_LINE, SAMPLE, SELECTED_LINE, TERMINAL_LINES } from "./preview.ts";

	let { m, terminalOnly = false }: { m: PreviewModel; terminalOnly?: boolean } = $props();
</script>

<div class="frame" style:background={m.chrome} style:--bd={m.border} aria-hidden="true">
	{#if !terminalOnly}
		<div class="editor" style:background={m.editorBg} style:color={m.editorFg}>
			{#each SAMPLE as line, i (i)}
				<div class="line" style:background={i === ACTIVE_LINE ? m.activeLine : undefined}>
					<span class="num" style:color={i === ACTIVE_LINE ? m.gutterActive : m.gutter}>{i + 1}</span>
					<span class="code">
						{#each line as tok, j (j)}
							{@const p = m.syntax[tok.role]}
							<span
								style:color={p.color}
								style:background={i === SELECTED_LINE && j === 1 ? m.selection : undefined}
								style:font-style={p.italic ? "italic" : undefined}
								style:font-weight={p.bold ? 700 : undefined}>{tok.text}</span
							>
						{/each}
					</span>
				</div>
			{/each}
		</div>
	{/if}
	<div class="term" style:background={m.termBg} style:color={m.termFg}>
		{#each TERMINAL_LINES as line, i (i)}
			<div class="tline">
				{#each line as c, j (j)}
					<span style:color={c.ansi === "fg" ? m.termFg : m.ansi[c.ansi]}>{c.text}</span>
				{/each}
				{#if i === TERMINAL_LINES.length - 1}<span class="cur" style:background={m.cursor}></span>{/if}
			</div>
		{/each}
		<div class="ansi">
			{#each m.ansi as c, i (i)}<span style:background={c}></span>{/each}
		</div>
	</div>
	<div class="chips">
		<span class="chip" style:background={m.accent}></span>
		<span class="chip" style:background={m.surface} style:box-shadow="inset 0 0 0 1px {m.border}"></span>
		<span class="chip" style:background={m.editorBg} style:box-shadow="inset 0 0 0 1px {m.border}"></span>
		<span class="label" style:color={m.muted}>Aa</span>
	</div>
</div>

<style>
	.frame {
		display: flex;
		flex-direction: column;
		gap: 0;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 0 0 1px var(--bd);
		font-family: var(--ca-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 8.5px;
		line-height: 1.5;
		user-select: none;
	}
	.editor {
		padding: 5px 0;
	}
	.line {
		display: flex;
		gap: 6px;
		padding: 0 7px 0 0;
		white-space: pre;
	}
	.num {
		width: 18px;
		text-align: right;
		flex-shrink: 0;
	}
	.code {
		overflow: hidden;
	}
	.term {
		padding: 4px 7px 5px;
		white-space: pre;
	}
	.tline {
		display: flex;
		align-items: center;
	}
	.cur {
		display: inline-block;
		width: 5px;
		height: 9px;
		margin-left: 2px;
	}
	.ansi {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		height: 5px;
		margin-top: 4px;
		border-radius: 2px;
		overflow: hidden;
	}
	.chips {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 7px;
	}
	.chip {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.label {
		margin-left: auto;
		font-size: 9px;
	}
</style>
