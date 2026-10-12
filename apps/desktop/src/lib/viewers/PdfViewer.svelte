<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { keyAction } from "#lib/viewers/pdf/keys.ts";
	import {
		PAGE_PAD,
		anchorScroll,
		clampPdfZoom,
		currentPage,
		fitPageScale,
		fitWidthScale,
		layoutPages,
		recallView,
		rememberView,
		stepZoom,
		visibleRange,
		type Match,
		type PageSize,
		type ViewState,
	} from "#lib/viewers/pdf.ts";
	import { wheelZoomFactor } from "#lib/viewers/zoom.ts";
	import { PdfDoc, errorKind as classify, type Outline, type PdfErrorKind } from "#lib/viewers/pdf/doc.ts";
	import { PageSlots } from "#lib/viewers/pdf/slots.ts";
	import { PdfSearch } from "#lib/viewers/pdf/search.svelte.ts";
	import PdfStatus from "#lib/viewers/pdf/PdfStatus.svelte";
	import PdfRail from "#lib/viewers/pdf/PdfRail.svelte";
	import PdfPages from "#lib/viewers/pdf/PdfPages.svelte";
	import PdfToolbar from "#lib/viewers/pdf/PdfToolbar.svelte";

	/** PDF viewer: composes the document, virtualized pages, thumbnail rail, floating toolbar and search. */
	let {
		blob,
		path,
		focused = false,
		onopen,
		onreveal,
	}: {
		blob: Blob;
		path: string;
		focused?: boolean;
		onopen: () => void;
		onreveal: () => void;
	} = $props();

	const SETTLE_MS = 150;

	const doc = new PdfDoc();
	let scroller: HTMLDivElement | undefined = $state();
	let rail: PdfRail | undefined = $state();
	let toolbar: PdfToolbar | undefined = $state();
	let status = $state<"loading" | "ready" | "error">("loading");
	let errorText = $state("");
	let errorKind = $state<PdfErrorKind>("other");

	let pages = $state<PageSize[]>([]);
	let box = $state({ w: 0, h: 0 });
	/** "width"/"page" follow the box; a number is an explicit scale (1 = 100%). */
	let zoom = $state<number | "width" | "page">("width");
	let page = $state(0);
	/** Saved view to re-apply once the scroller has a real size (it is `display:none` until ready). */
	let pendingRestore = $state<ViewState | undefined>();
	let scrollTop = $state(0);
	/** Live pinch factor applied as a CSS transform until the gesture settles. */
	let pinch = $state({ k: 1, ox: 0, oy: 0 });
	let sidebar = $state(false);
	let outline = $state<Outline[]>([]);
	let settleTimer = 0;

	let scale = $derived(
		zoom === "width" ? fitWidthScale(pages, box.w) : zoom === "page" ? fitPageScale(pages[page], box) : zoom,
	);
	let layout = $derived(layoutPages(pages, scale));
	let range = $derived(visibleRange(layout, scrollTop, box.h, 1));
	let pct = $derived(Math.round(scale * pinch.k * 100));
	let indices = $derived(
		range ? Array.from({ length: range.near[1] - range.near[0] + 1 }, (_, k) => range.near[0] + k) : [],
	);

	const search = new PdfSearch({
		doc,
		page: () => page,
		textHost: (i) => slots.textHost(i),
		pagesWithText: () => slots.indices(),
		reveal: revealMatch,
	});
	const slots = new PageSlots(
		doc,
		() => scale,
		(i) => search.highlight(i),
		(i) => {
			if (i === page) void rail?.paintThumb(i);
		},
	);

	// ---- load ------------------------------------------------------------------------------

	onMount(() => {
		const ro = new ResizeObserver(([e]) => (box = { w: e.contentRect.width, h: e.contentRect.height }));
		ro.observe(scroller!);
		void open();
		toolbar?.show();
		return () => {
			ro.disconnect();
			toolbar?.dispose();
			search.dispose();
			clearTimeout(settleTimer);
			slots.cancelAll();
			doc.destroy();
		};
	});

	async function open() {
		try {
			pages = await doc.open(blob);
			pendingRestore = recallView(path);
			if (pendingRestore) {
				zoom = pendingRestore.zoom;
				page = pendingRestore.page;
			}
			status = "ready";
			void doc.outline().then((o) => (outline = o));
		} catch (e) {
			errorKind = classify(e);
			errorText = e instanceof Error ? e.message : String(e);
			status = "error";
		}
	}

	function save() {
		if (status !== "ready" || !scroller || pendingRestore) return;
		rememberView(path, { scrollTop: scroller.scrollTop, zoom, page });
	}

	// Paint what the window needs; release bitmaps far from the viewport.
	$effect(() => {
		if (status !== "ready" || !range) return;
		const r = range;
		void scale;
		untrack(() => slots.sync(r, page));
	});

	$effect(() => {
		if (!pendingRestore || box.h <= 0 || !scroller) return;
		const mem = pendingRestore;
		void layout.height;
		scroller.scrollTop = mem.scrollTop;
		scrollTop = scroller.scrollTop;
		// Only done once the browser accepted the offset (content tall enough to scroll to it).
		if (Math.abs(scroller.scrollTop - mem.scrollTop) < 2) pendingRestore = undefined;
	});

	// Remembered across tabs/reopens.
	$effect(() => {
		void zoom;
		void page;
		untrack(save);
	});

	// ---- scrolling / current page ------------------------------------------------------------

	function onscroll() {
		if (!scroller) return;
		scrollTop = scroller.scrollTop;
		page = currentPage(layout, scrollTop, box.h);
		save();
		toolbar?.show();
	}

	function goto(i: number, smooth = false) {
		if (!scroller || !pages.length) return;
		const n = Math.min(pages.length - 1, Math.max(0, i));
		scroller.scrollTo({
			top: Math.max(0, layout.tops[n] - PAGE_PAD / 2),
			behavior: smooth ? "smooth" : "instant",
		});
	}

	function revealMatch(m: Match) {
		const top = layout.tops[m.page];
		const vis = scroller!.scrollTop;
		const inView = top + layout.sizes[m.page].h > vis && top < vis + box.h;
		if (!inView) goto(m.page);
		// The text layer for the page may not exist yet: highlight() runs again after it paints.
		void tick().then(() => {
			const el = scroller?.querySelector<HTMLElement>("mark.hit.cur");
			if (!el || !scroller) return;
			const r = el.getBoundingClientRect();
			const sr = scroller.getBoundingClientRect();
			if (r.top < sr.top + 60 || r.bottom > sr.bottom - 90)
				scroller.scrollBy({ top: r.top - sr.top - box.h / 3, behavior: "instant" });
		});
	}

	// ---- zoom --------------------------------------------------------------------------------

	/** Applies `zoom` and, once laid out, restores the scroll offset that keeps the anchored point fixed. */
	function commitZoom(next: number | "width" | "page", s: { x: number; y: number }) {
		zoom = next;
		void tick().then(() => {
			scroller!.scrollLeft = s.x;
			scroller!.scrollTop = s.y;
			scrollTop = scroller!.scrollTop;
		});
	}

	/** Commit a new scale around `at` (scroller-relative), preserving the content point under it. */
	function setZoom(next: number | "width" | "page", at?: { x: number; y: number }) {
		if (!scroller) return;
		const from = scale;
		const target = typeof next === "number" ? clampPdfZoom(next) : next;
		const to =
			target === "width"
				? fitWidthScale(pages, box.w)
				: target === "page"
					? fitPageScale(pages[page], box)
					: target;
		// Keep the same place in the document: anchor on the viewport center unless a cursor is given.
		const a = at ?? { x: box.w / 2, y: box.h / 2 };
		commitZoom(target, anchorScroll(pages, { x: scroller.scrollLeft, y: scroller.scrollTop }, a, from, to));
	}

	function onwheel(e: WheelEvent) {
		toolbar?.show();
		// Trackpad pinch arrives as ctrlKey+wheel; ⌘+wheel zooms like Preview. Plain wheel scrolls natively.
		if (!(e.ctrlKey || e.metaKey) || !scroller) return;
		e.preventDefault();
		const r = scroller.getBoundingClientRect();
		const at = { x: e.clientX - r.left, y: e.clientY - r.top };
		// Live phase: scale the already-rendered layer with CSS around the cursor (no re-render).
		const target = clampPdfZoom(scale * pinch.k * wheelZoomFactor(e.deltaY, e.ctrlKey));
		pinch = { k: target / scale, ox: at.x + scroller.scrollLeft, oy: at.y + scroller.scrollTop };
		clearTimeout(settleTimer);
		settleTimer = window.setTimeout(() => settlePinch(at), SETTLE_MS);
	}

	/** End of a pinch: commit the zoom, keep the point under the cursor fixed, re-render crisp. */
	function settlePinch(at: { x: number; y: number }) {
		const from = scale;
		const to = clampPdfZoom(from * pinch.k);
		const s = anchorScroll(pages, { x: scroller!.scrollLeft, y: scroller!.scrollTop }, at, from, to);
		pinch = { k: 1, ox: 0, oy: 0 };
		commitZoom(to, s);
	}

	function ondblclick(e: MouseEvent) {
		// A double-click on a word selects it (native behavior); only blank areas toggle zoom.
		if ((e.target as HTMLElement).closest(".tl span")) return;
		const r = scroller!.getBoundingClientRect();
		setZoom(zoom === "width" ? 1 : "width", { x: e.clientX - r.left, y: e.clientY - r.top });
	}

	// ---- keyboard ----------------------------------------------------------------------------

	function onkeydown(e: KeyboardEvent) {
		if (!focused || status !== "ready") return;
		const typing = !!(e.target as HTMLElement | null)?.closest("input,textarea");
		const a = keyAction(e, typing, box.h);
		if (!a || (a.type === "escape" && !search.open)) return;
		switch (a.type) {
			case "zoom":
				setZoom(a.to === "in" ? stepZoom(scale, 1) : a.to === "out" ? stepZoom(scale, -1) : a.to);
				break;
			case "find":
				void toolbar?.openFind();
				break;
			case "match":
				search.next(a.dir);
				break;
			case "scroll":
				scroller!.scrollBy({ top: a.dy, behavior: "instant" });
				break;
			case "home":
				goto(0);
				break;
			case "end":
				scroller!.scrollTo({ top: layout.height });
				break;
			case "escape":
				toolbar?.closeFind();
				break;
		}
		e.preventDefault();
		// ⌘/Ctrl shortcuts never woke the toolbar; plain navigation does.
		if (!(e.metaKey || e.ctrlKey)) toolbar?.show();
	}
</script>

<svelte:window {onkeydown} />

<div class="pdf">
	{#if status !== "ready"}
		<PdfStatus {status} {errorKind} {errorText} {onopen} {onreveal} />
	{:else if sidebar}
		<PdfRail bind:this={rail} {doc} {pages} {page} {outline} {goto} />
	{/if}

	<div class="main" class:hidden={status !== "ready"}>
		<PdfPages
			bind:scroller
			{layout}
			{indices}
			{scale}
			{pinch}
			label={path}
			slot={slots.bind}
			{onscroll}
			{onwheel}
			{ondblclick}
			onpointermove={() => toolbar?.show()}
		/>
		{#if status === "ready"}
			<PdfToolbar
				bind:this={toolbar}
				{search}
				bind:sidebar
				{page}
				total={pages.length}
				{pct}
				{zoom}
				{goto}
				zoomStep={(dir) => setZoom(stepZoom(scale, dir))}
				zoomTo={setZoom}
				toggleFit={() => setZoom(zoom === "width" ? "page" : "width")}
				onclose={() => scroller?.focus()}
				{onopen}
				{onreveal}
			/>
		{/if}
	</div>
</div>

<style>
	.pdf {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		position: relative;
		/* Backdrop the sheets float on: deep in dark themes, soft grey in light. */
		--pdf-bg: color-mix(in oklab, var(--ca-text-primary) 6%, var(--ca-surface-sunken));
		--pdf-shadow:
			0 1px 2px color-mix(in oklab, black 30%, transparent),
			0 6px 20px color-mix(in oklab, black 26%, transparent);
		background: var(--pdf-bg);
	}
	.main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		position: relative;
		display: flex;
	}
	.main.hidden {
		display: none;
	}
</style>
