<script lang="ts">
	import { onMount, tick } from "svelte";
	import { EditorView, basicSetup } from "codemirror";
	import { Compartment, EditorState } from "@codemirror/state";
	import { keymap } from "@codemirror/view";
	import { toast } from "@codeatlasdev/ui";
	import {
		WrapText,
		FileDiff as DiffIcon,
		Eye,
		Code,
		Image as ImageIcon,
		FolderSearch,
		ExternalLink,
		Globe,
	} from "@lucide/svelte";
	import { atlasTheme } from "#lib/cm.ts";
	import { host, b64bytes } from "#lib/host.ts";
	import { api, errText } from "#lib/api.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";
	import DiffView from "#lib/components/DiffView.svelte";
	import Tip from "#lib/components/Tip.svelte";
	import { previewHtml } from "#lib/stores/preview.svelte.ts";
	import { isHtml } from "#lib/stores/preview.ts";
	import "#lib/outline.ts";
	import { registerEditor, unregisterEditor } from "#lib/symbols.ts";
	import { LspDoc } from "#lib/lsp/client.svelte.ts";
	import { applyDiagnostics, countDiagnostics } from "#lib/lsp/diagnostics.ts";
	import { formatBeforeSave, lspCompletion, lspExtension } from "#lib/lsp/extension.ts";
	import LspStatus from "#lib/lsp/LspStatus.svelte";
	import { openLocation, showLocations } from "#lib/lsp/workspace.ts";
	import { prefs } from "#lib/stores/prefs.svelte.ts";
	import { MAX_BYTES, MIME, extOf, viewerKind } from "#lib/viewers/kind.ts";
	import { readBlob } from "#lib/viewers/load.ts";
	import { langForPath, langIdForPath, loadLanguage, lspLanguageId } from "#lib/viewers/lang.ts";
	import { fileType } from "#lib/viewers/fileType.ts";
	import { rememberRich, wantsRich } from "#lib/viewers/richPref.ts";
	import RichView from "#lib/viewers/rich/RichView.svelte";
	import ImageViewer from "#lib/viewers/ImageViewer.svelte";
	import SvgPreview from "#lib/viewers/SvgPreview.svelte";
	import PdfViewer from "#lib/viewers/PdfViewer.svelte";
	import MediaViewer from "#lib/viewers/MediaViewer.svelte";
	import MarkdownViewer from "#lib/viewers/MarkdownViewer.svelte";
	import FallbackViewer from "#lib/viewers/FallbackViewer.svelte";

	let {
		worktreeId,
		path,
		focused = false,
	}: { worktreeId: string; path: string; focused?: boolean } = $props();

	const SAVE_IDLE_MS = 500;
	const HEX_BYTES = 4096;

	let el: HTMLDivElement | undefined = $state();
	let view: EditorView | undefined;
	let phase = $state<"loading" | "text" | "media" | "large" | "binary" | "error">("loading");
	let error = $state("");
	let progress = $state(0);
	let fileSize = $state(0);
	let head = $state<Uint8Array | undefined>();
	let media = $state<{ url: string; blob: Blob } | null>(null);
	let wrap = $state(false);
	let rich = $state(false);
	let mounted = $state(false);
	/** SVG: rendered image (true) or source in the editor (false). */
	let rendered = $state(true);
	let changes = $state(false);
	let text = $state("");
	const wrapC = new Compartment();
	const langC = new Compartment();
	const lspC = new Compartment();
	let lspDoc = $state<LspDoc | undefined>();
	let problems = $state({ error: 0, warning: 0 });
	let saveTimer: number | undefined;
	let lastSaved = "";
	/** Unmounting: save as is, never format a view that is being destroyed. */
	let closing = false;
	const abort = new AbortController();

	let root = $derived(ws.worktree(worktreeId)?.path ?? "");
	let abs = $derived(`${root}/${path}`);
	let kind = $derived(viewerKind(path));
	let ft = $derived(fileType(path));
	let isMd = $derived(kind === "markdown");
	let isSvg = $derived(kind === "svg");
	/** Rich view of a non-Markdown file type (Markdown, SVG keep their own viewers). */
	let richKind = $derived(kind === "text" ? ft.view : undefined);
	let hasRich = $derived(isMd || !!richKind);
	/** Text-backed view shown right now (CodeMirror is mounted but hidden otherwise). */
	let showCm = $derived(
		phase === "text" && !changes && !(isMd && rich) && !(!!richKind && rich) && !(isSvg && rendered),
	);

	async function save() {
		if (view && lspDoc?.open && !closing) await formatBeforeSave(view);
		const cur = view?.state.doc.toString();
		if (cur === undefined || cur === lastSaved) return;
		try {
			await host.fsWrite(abs, cur);
			lastSaved = cur;
			void lspDoc?.save();
		} catch (e) {
			toast.error(`Save failed: ${errText(e)}`);
		}
	}

	/** Start (or stop) the language server session for this document per the settings. */
	function syncLsp() {
		const id = lspLanguageId(path);
		const want = !!view && !!id && prefs.value.enable_language_servers && kind === "text";
		if (!want) {
			lspDoc?.close();
			lspDoc = undefined;
			problems = { error: 0, warning: 0 };
			view?.dispatch({ effects: lspC.reconfigure([]) });
			return;
		}
		if (lspDoc) return;
		const v = view!;
		const doc = new LspDoc(abs, id, () => v.state.doc.toString());
		doc.listenDiagnostics((version, diags) => {
			applyDiagnostics(v, diags, version, doc.version);
			const c = countDiagnostics(v);
			problems = { error: c.error, warning: c.warning };
		});
		lspDoc = doc;
		v.dispatch({
			effects: lspC.reconfigure([
				lspCompletion,
				lspExtension({
					env: {
						doc,
						openAt: (p, pos) => {
							if (!openLocation(p, pos, worktreeId)) toast.info(`${p} is outside the open worktrees`);
						},
						showLocations,
						inlayHints: () => prefs.value.inlay_hints.enabled,
						formatOnSave: () => prefs.value.format_on_save,
					},
				}),
			]),
		});
	}

	function mountEditor() {
		view = new EditorView({
			parent: el!,
			state: EditorState.create({
				doc: text,
				extensions: [
					basicSetup,
					lspC.of([]),
					atlasTheme,
					langC.of(langForPath(path)),
					wrapC.of([]),
					keymap.of([
						{
							key: "Alt-z",
							run: () => {
								toggleWrap();
								return true;
							},
						},
						{
							key: "Mod-s",
							run: () => {
								void save();
								return true;
							},
						},
					]),
					EditorView.updateListener.of((u) => {
						if (!u.docChanged) return;
						text = u.state.doc.toString();
						lspDoc?.change(u.startState.doc, u.changes);
						clearTimeout(saveTimer);
						saveTimer = window.setTimeout(save, SAVE_IDLE_MS);
					}),
				],
			}),
		});
		registerEditor(`${worktreeId}:${path}`, view, save, { path, root });
		mounted = true;
		syncLsp();
	}

	async function load() {
		const st = await host.fsStat(abs);
		fileSize = st.size;
		const max = MAX_BYTES[kind];
		if (st.size > max) {
			phase = "large";
			return;
		}
		if (kind === "image" || kind === "pdf" || kind === "video" || kind === "audio") {
			const blob = await readBlob(abs, st.size, MIME[extOf(path)], (p) => (progress = p), abort.signal);
			media = { url: URL.createObjectURL(blob), blob };
			phase = "media";
			return;
		}
		const r = await host.fsRead(abs, max);
		const bytes = b64bytes(r.data);
		try {
			text = lastSaved = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			head = bytes.subarray(0, HEX_BYTES);
			phase = "binary";
			return;
		}
		rich = wantsRich(ft);
		phase = "text";
		await Promise.resolve();
		mountEditor();
	}

	onMount(() => {
		load().catch((e) => {
			if (e?.name === "AbortError") return;
			error = errText(e);
			phase = "error";
		});
		return () => {
			abort.abort();
			closing = true;
			clearTimeout(saveTimer);
			void save().finally(() => lspDoc?.close());
			if (view) unregisterEditor(`${worktreeId}:${path}`, view);
			view?.destroy();
			if (media?.url) URL.revokeObjectURL(media.url);
		};
	});
	$effect(() => {
		if (focused && showCm) view?.focus();
	});
	// Grammar for the file type: bundled ones are instant, the rest load as separate chunks.
	// `mounted` is state so this re-runs once the (plain `let`) view exists.
	$effect(() => {
		const id = ft.lang;
		const v = view;
		if (!mounted || !v) return;
		let live = true;
		void loadLanguage(id).then((ext) => {
			if (live && view === v) v.dispatch({ effects: langC.reconfigure(ext) });
		});
		return () => (live = false);
	});
	$effect(() => {
		void prefs.value.enable_language_servers;
		syncLsp();
	});

	function toggleWrap() {
		wrap = !wrap;
		view?.dispatch({ effects: wrapC.reconfigure(wrap ? EditorView.lineWrapping : []) });
	}

	const reveal = () => host.exec(root, ["open", "-R", abs]).catch((e) => toast.error(errText(e)));
	const openExternal = () => host.exec(root, ["open", abs]).catch((e) => toast.error(errText(e)));

	function setRich(on: boolean) {
		rich = on;
		if (richKind) rememberRich(ft, on);
	}

	/** Leave the rendered view for the source, optionally landing on a line. */
	function toSource(line?: number) {
		setRich(false);
		if (!line) return;
		void tick().then(() => {
			const v = view;
			if (!v) return;
			const l = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines));
			v.dispatch({
				selection: { anchor: l.from },
				effects: EditorView.scrollIntoView(l.from, { y: "center" }),
			});
			v.focus();
		});
	}

	function onkeydown(e: KeyboardEvent) {
		if (!focused) return;
		if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "m" && hasRich && phase === "text") {
			setRich(!rich);
			e.preventDefault();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="editor">
	<div class="bar">
		<button class="path mono" title="Reveal in Finder" onclick={reveal}>
			{path}
		</button>
		{#if lspDoc && showCm}
			<LspStatus doc={lspDoc} errors={problems.error} warnings={problems.warning} />
		{/if}
		{#if phase === "text"}
			{#if isSvg}
				<Tip label={rendered ? "Edit source" : "Show image"} side="bottom">
					{#snippet child(props)}
						<button {...props} class:on={!rendered} onclick={() => (rendered = !rendered)}>
							{#if rendered}<Code size={13} />{:else}<ImageIcon size={13} />{/if}
						</button>
					{/snippet}
				</Tip>
			{/if}
			{#if showCm || changes}
				<button class:on={wrap} title="Word wrap (⌥Z)" onclick={toggleWrap}><WrapText size={13} /></button>
				<button class:on={changes} title="Changes vs HEAD" onclick={() => (changes = !changes)}>
					<DiffIcon size={13} />
				</button>
			{/if}
			{#if isHtml(path)}
				<Tip label="Open preview (⌘⇧V)" side="bottom">
					{#snippet child(props)}
						<button {...props} onclick={() => void previewHtml(worktreeId, path)}><Globe size={13} /></button>
					{/snippet}
				</Tip>
			{/if}
			{#if hasRich}
				<Tip label={rich ? `Show source (⌘⇧M)` : `${isMd ? "Rich" : ft.label} view (⌘⇧M)`} side="bottom">
					{#snippet child(props)}
						<button {...props} class:on={rich} aria-pressed={rich} onclick={() => setRich(!rich)}>
							{#if rich}<Code size={13} />{:else}<Eye size={13} />{/if}
						</button>
					{/snippet}
				</Tip>
			{/if}
		{/if}
		{#if phase === "media" || isSvg}
			<Tip label="Reveal in Finder" side="bottom">
				{#snippet child(props)}
					<button {...props} onclick={reveal}><FolderSearch size={13} /></button>
				{/snippet}
			</Tip>
			<Tip label="Open externally" side="bottom">
				{#snippet child(props)}
					<button {...props} onclick={openExternal}><ExternalLink size={13} /></button>
				{/snippet}
			</Tip>
		{/if}
	</div>
	{#if phase === "loading"}
		<div class="msg" aria-busy="true">
			Loading…
			{#if progress > 0 && progress < 1}<span class="mono">{Math.round(progress * 100)}%</span>{/if}
		</div>
	{:else if phase === "large" || phase === "binary"}
		<FallbackViewer reason={phase} size={fileSize} {head} onopen={openExternal} onreveal={reveal} />
	{:else if phase === "error"}
		<p class="msg">{error}</p>
	{:else if phase === "media" && media}
		{#if kind === "image"}
			<ImageViewer {...media} {path} size={fileSize} {focused} />
		{:else if kind === "pdf"}
			<PdfViewer blob={media.blob} {path} {focused} onopen={openExternal} onreveal={reveal} />
		{:else}
			<MediaViewer url={media.url} {path} size={fileSize} video={kind === "video"} />
		{/if}
	{:else if phase === "text" && isSvg && rendered && !changes}
		<SvgPreview {text} {path} size={fileSize} {focused} />
	{/if}
	{#if changes}
		<div class="fill"><DiffView {worktreeId} only={path} mode="working" /></div>
	{:else if rich && isMd && phase === "text"}
		<MarkdownViewer {text} {path} {root} />
	{:else if rich && richKind && phase === "text"}
		<RichView view={richKind} ctx={{ text, path, worktreeId, root, size: fileSize, toSource }} />
	{/if}
	<div class="cm" class:hidden={!showCm} bind:this={el}></div>
</div>

<style>
	.editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-bottom: 0.5px solid var(--ca-outline-subtle);
	}
	.path {
		margin-right: auto;
		border: 0;
		background: none;
		font-size: 11.5px;
		color: var(--ca-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar button:not(.path) {
		display: inline-flex;
		padding: 4px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--ca-text-secondary);
	}
	.bar button.on {
		color: var(--space-accent, var(--ca-brand-main));
		background: var(--ca-action-hover);
	}
	.mono {
		font-family: var(--mono);
	}
	.cm,
	.fill {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
	}
	.cm.hidden {
		display: none;
	}
	.msg {
		display: flex;
		gap: 8px;
		padding: 20px;
		color: var(--ca-text-secondary);
		font-size: 13px;
	}
</style>
