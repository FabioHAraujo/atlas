/**
 * Frontend LSP client over hostd (`lsp_*` commands, `lsp_*` pushes; see crates/atlas-host protocol).
 * One listener for the whole app; each open editor registers a `LspDoc` that owns its document sync:
 * `lsp_open`, debounced + coalesced `lsp_change` (UTF-16 incremental events), `lsp_save`, `lsp_close`,
 * and a re-open of every live document when hostd reconnects (a new daemon has no document state).
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChangeSet, Text } from "@codemirror/state";
import { hostCall } from "#lib/host.ts";
import { ChangeBuffer, pathToUri, type TextEdit, type WorkspaceEdit } from "#lib/lsp/convert.ts";

const CHANGE_DEBOUNCE_MS = 40;
const PULL_DEBOUNCE_MS = 400;

export interface LspDiagnostic {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	severity?: 1 | 2 | 3 | 4;
	code?: string | number;
	source?: string;
	message: string;
	tags?: number[];
	data?: unknown;
}

export type ServerState = "downloading" | "starting" | "ready" | "crashed" | "missing";

export interface ServerStatus {
	name: string;
	root: string;
	language: string;
	state: ServerState;
	progress?: string | null;
	message?: string | null;
}

/** Subset of `ServerCapabilities` the editor gates features on. */
export interface Capabilities {
	completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean };
	diagnosticProvider?: unknown;
	signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] };
	hoverProvider?: unknown;
	definitionProvider?: unknown;
	referencesProvider?: unknown;
	renameProvider?: boolean | { prepareProvider?: boolean };
	documentFormattingProvider?: unknown;
	codeActionProvider?: unknown;
	documentHighlightProvider?: unknown;
	inlayHintProvider?: unknown;
	documentSymbolProvider?: unknown;
}

interface OpenReply {
	server: string | null;
	status: string;
	capabilities?: Capabilities | null;
}

/** Reactive state the UI reads: server list and per-path diagnostics. */
export const lsp = $state<{
	servers: ServerStatus[];
	diagnostics: Record<string, LspDiagnostic[]>;
}>({ servers: [], diagnostics: {} });

type DiagListener = (version: number | null | undefined, diags: LspDiagnostic[]) => void;
type EditHandler = (edit: WorkspaceEdit) => Promise<boolean>;

const docs: Record<string, LspDoc> = {};
let editHandler: EditHandler | null = null;
let rid = 0;
let offs: Promise<UnlistenFn[]> | null = null;

/** Registered by the workspace: applies a server-initiated WorkspaceEdit (open docs + disk). */
export const setApplyEditHandler = (h: EditHandler) => (editHandler = h);

function ensureListeners() {
	offs ??= Promise.all([
		listen<Record<string, unknown> & { ev: string }>("host://event", (e) => onEvent(e.payload)),
		listen("host://reconnected", () => {
			for (const d of Object.values(docs)) void d.reopen();
		}),
	]);
}

function onEvent(p: Record<string, unknown> & { ev: string }) {
	if (p.ev === "lsp_status") lsp.servers = p.servers as ServerStatus[];
	else if (p.ev === "lsp_diagnostics") {
		const path = p.path as string;
		const diags = p.diagnostics as LspDiagnostic[];
		lsp.diagnostics[path] = diags;
		docs[path]?.onDiagnostics(p.version as number | null | undefined, diags);
	} else if (p.ev === "lsp_apply_edit") {
		const id = String(p.id);
		const run = editHandler?.(p.edit as WorkspaceEdit) ?? Promise.resolve(false);
		void run
			.catch(() => false)
			.then((applied) => hostCall("lsp_apply_edit_result", { id, applied }).catch(() => {}));
	}
}

/** Refresh the server list (the push keeps it current afterwards). */
export async function refreshStatus() {
	lsp.servers = (await hostCall<{ servers: ServerStatus[] }>("lsp_status")).servers;
}

/** The server (if any) handling `path`: the one whose root contains it, deepest root first. */
export function serverFor(path: string): ServerStatus | undefined {
	return lsp.servers
		.filter((s) => path.startsWith(s.root.endsWith("/") ? s.root : `${s.root}/`))
		.sort((a, b) => b.root.length - a.root.length)[0];
}

export class LspDoc {
	version = 1;
	/** Capabilities of the server for this document; `null` until it reports them. */
	caps = $state<Capabilities | null>(null);
	server = $state<string | null>(null);
	status = $state<string>("starting");
	#buf = new ChangeBuffer();
	#timer: number | undefined;
	#open = false;
	#closed = false;
	#diagListener: DiagListener | null = null;
	#pullTimer: number | undefined;
	#text: () => string;

	constructor(
		readonly path: string,
		readonly languageId: string,
		text: () => string,
	) {
		this.#text = text;
		ensureListeners();
		docs[path] = this;
		void this.reopen();
	}

	onDiagnostics(version: number | null | undefined, diags: LspDiagnostic[]) {
		// A server with pull diagnostics answers with syntax and semantic errors together; its pushes
		// (syntax only) would replace that list with a shorter one and flicker.
		if (this.caps?.diagnosticProvider) return;
		this.#diagListener?.(version, diags);
	}

	/** Called with every diagnostics push for this path. */
	listenDiagnostics(l: DiagListener) {
		this.#diagListener = l;
	}

	/**
	 * (Re)send `lsp_open` with the current text: first open and after a hostd reconnect. hostd answers
	 * once the server is up (a first open may download it), so edits made meanwhile are not in the text
	 * it was given: they are replayed as one full-document change when the reply lands.
	 */
	async reopen() {
		if (this.#closed) return;
		this.#buf.clear();
		clearTimeout(this.#timer);
		const sentVersion = this.version;
		const sentText = this.#text();
		try {
			const r = await hostCall<OpenReply>("lsp_open", {
				path: this.path,
				language_id: this.languageId,
				text: sentText,
				version: sentVersion,
			});
			if (this.#closed) {
				if (r.server) void hostCall("lsp_close", { path: this.path }).catch(() => {});
				return;
			}
			this.server = r.server;
			this.status = r.status;
			this.#open = r.server !== null && (r.status === "ready" || r.status === "starting");
			this.caps = r.capabilities ?? null;
			if (this.#open && this.version !== sentVersion) {
				const cur = this.#text();
				if (cur !== sentText) {
					await hostCall("lsp_close", { path: this.path }).catch(() => {});
					await hostCall("lsp_open", {
						path: this.path,
						language_id: this.languageId,
						text: cur,
						version: this.version,
					}).catch(() => {});
				}
			}
			if (this.#open && !this.caps) void this.refreshCaps();
			else this.pullSoon(0);
		} catch (e) {
			this.status = "missing";
			this.#open = false;
			console.warn("lsp_open failed", e);
		}
	}

	/** Server capabilities are only known once it is ready; asks again after each status change. */
	async refreshCaps() {
		const c = await this.request<Capabilities | null>("$/capabilities", {}).catch(() => null);
		if (c) this.caps = c;
		this.pullSoon(0);
	}

	/** Pull diagnostics (LSP 3.17) a moment after the last change; one request in flight, latest wins. */
	pullSoon(ms = PULL_DEBOUNCE_MS) {
		if (!this.#open || !this.caps?.diagnosticProvider) return;
		clearTimeout(this.#pullTimer);
		this.#pullTimer = window.setTimeout(() => void this.pull(), ms);
	}

	async pull() {
		if (!this.#open || !this.caps?.diagnosticProvider) return;
		const version = this.version;
		const res = await this.request<{ kind: string; items?: LspDiagnostic[] } | null>(
			"textDocument/diagnostic",
			{ textDocument: { uri: pathToUri(this.path) } },
		).catch(() => null);
		// `unchanged` keeps the previous list; a reply for an older text is stale.
		if (!res || res.kind !== "full" || this.#closed || version !== this.version) return;
		const items = res.items ?? [];
		lsp.diagnostics[this.path] = items;
		this.#diagListener?.(version, items);
	}

	/** Queue an editor change; flushed after a short idle so a burst of keystrokes is one message. */
	change(before: Text, changes: ChangeSet) {
		this.version++;
		if (!this.#open) return;
		this.#buf.push(before, changes);
		clearTimeout(this.#timer);
		this.#timer = window.setTimeout(() => void this.flush(), CHANGE_DEBOUNCE_MS);
		this.pullSoon();
	}

	/** Send pending changes now (called before any request so the server never answers stale text). */
	async flush() {
		clearTimeout(this.#timer);
		if (!this.#open || !this.#buf.pending) return;
		const changes = this.#buf.take();
		if (changes.length === 0) return;
		await hostCall("lsp_change", { path: this.path, version: this.version, changes }).catch(() => {});
	}

	/** Request with automatic flush; the id lets callers cancel (completion superseded by typing). */
	async request<T>(method: string, params: unknown, id?: string): Promise<T | null> {
		if (!this.#open) return null;
		await this.flush();
		return hostCall<T | null>("lsp_request", { path: this.path, method, params, rid: id ?? `r${++rid}` });
	}

	cancel(id: string) {
		void hostCall("lsp_cancel", { id }).catch(() => {});
	}

	async save() {
		await this.flush();
		if (this.#open) await hostCall("lsp_save", { path: this.path, text: this.#text() }).catch(() => {});
		this.pullSoon(0);
	}

	get open() {
		return this.#open;
	}

	close() {
		this.#closed = true;
		clearTimeout(this.#timer);
		clearTimeout(this.#pullTimer);
		if (docs[this.path] === this) delete docs[this.path];
		delete lsp.diagnostics[this.path];
		if (this.#open) void hostCall("lsp_close", { path: this.path }).catch(() => {});
		this.#open = false;
	}
}

/** Document of `path` if an editor has it open (rename/code actions need it). */
export const docOf = (path: string): LspDoc | undefined => docs[path];

export type { TextEdit };
