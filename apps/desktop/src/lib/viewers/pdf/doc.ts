/** pdf.js document lifecycle: loading, page-proxy cache, outline and per-page text extraction. */
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type * as Pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageSize } from "#lib/viewers/pdf.ts";

export type Outline = { title: string; page: number | null; items: Outline[] };
export type PdfErrorKind = "password" | "invalid" | "other";

/** pdf.js throws plain objects with a `name`; both password and damaged files get a dedicated message. */
export const errorName = (e: unknown): string | undefined =>
	e && typeof e === "object" && "name" in e && typeof e.name === "string" ? e.name : undefined;

export const errorKind = (e: unknown): PdfErrorKind => {
	const name = errorName(e);
	return name === "PasswordException" ? "password" : name === "InvalidPDFException" ? "invalid" : "other";
};

export class PdfDoc {
	pdfjs!: typeof Pdfjs;
	private doc!: PDFDocumentProxy;
	private loading?: PDFDocumentLoadingTask;
	private proxies = new Map<number, Promise<PDFPageProxy>>();
	private texts = new Map<number, string>();

	get numPages() {
		return this.doc.numPages;
	}

	/** Loads the document and returns every page's natural size (they drive the layout). */
	async open(blob: Blob): Promise<PageSize[]> {
		// Lazy: pdf.js is large and only needed once a PDF is opened.
		this.pdfjs = await import("pdfjs-dist");
		this.pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
		const base = `${location.origin}/pdfjs/`;
		const task = this.pdfjs.getDocument({
			data: new Uint8Array(await blob.arrayBuffer()),
			cMapUrl: `${base}cmaps/`,
			cMapPacked: true,
			standardFontDataUrl: `${base}standard_fonts/`,
			iccUrl: `${base}iccs/`,
			wasmUrl: `${base}wasm/`,
			// WebAssembly needs `wasm-unsafe-eval` in script-src; the JS fallbacks (JBIG2/JPX, PostScript
			// functions) keep the CSP minimal. Only qcms ICC conversion is lost (alternate colour space is used).
			useWasm: false,
			enableXfa: false,
		});
		this.doc = await (this.loading = task).promise;
		// Fetch sizes in parallel (the worker pipelines getPage) instead of one round trip per page.
		return Promise.all(
			Array.from({ length: this.doc.numPages }, async (_, i) => {
				const v = (await this.page(i)).getViewport({ scale: 1 });
				return { w: v.width, h: v.height };
			}),
		);
	}

	page(i: number): Promise<PDFPageProxy> {
		let p = this.proxies.get(i);
		if (!p) this.proxies.set(i, (p = this.doc.getPage(i + 1)));
		return p;
	}

	async outline(): Promise<Outline[]> {
		const raw = await this.doc.getOutline().catch(() => null);
		if (!raw?.length) return [];
		const conv = async (items: NonNullable<typeof raw>): Promise<Outline[]> =>
			Promise.all(
				items.map(async (it) => {
					let pg: number | null = null;
					try {
						const dest = typeof it.dest === "string" ? await this.doc.getDestination(it.dest) : it.dest;
						if (dest?.[0] && typeof dest[0] === "object") pg = await this.doc.getPageIndex(dest[0]);
					} catch {
						/* unresolved destination: shown but not clickable */
					}
					return { title: it.title, page: pg, items: await conv(it.items ?? []) };
				}),
			);
		return conv(raw);
	}

	async text(i: number): Promise<string> {
		let t = this.texts.get(i);
		if (t === undefined) {
			const tc = await (await this.page(i)).getTextContent();
			t = tc.items.map((it) => ("str" in it ? it.str : "")).join("");
			this.texts.set(i, t);
		}
		return t;
	}

	destroy() {
		void this.loading?.destroy();
	}
}
