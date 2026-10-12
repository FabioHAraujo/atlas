<script lang="ts">
	// "Send me the link" for phones: the native share sheet when the browser has one, a copyable link always, and an email
	// through the same /api/waitlist endpoint (topic "mobile-link") when the visitor prefers that.
	import Waitlist from "./Waitlist.svelte";
	let { url }: { url: string } = $props();
	const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	let copied = $state(false);
	async function share() {
		try {
			await navigator.share({ title: "Atlas", text: "Download Atlas for your computer", url });
		} catch {}
	}
	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {}
	}
</script>

<div class="send">
	<div class="row">
		{#if canShare}<button type="button" class="btn solid" onclick={share}>Share the link</button>{/if}
		<button type="button" class="btn" class:solid={!canShare} onclick={copy}>{copied ? "Link copied" : "Copy link"}</button>
		<span class="sr-only" role="status">{copied ? "Link copied" : ""}</span>
	</div>
	<p class="or">Or get it by email</p>
	<Waitlist variant="close" topic="mobile-link" id="mobile-link" cta="Send me the link" title="Got it." done="We will email you the download link, then one email per release." />
</div>

<style>
	.send { display: grid; gap: 0.9rem; min-width: 0; }
	.row { display: flex; flex-wrap: wrap; gap: 0.6rem; }
	.row .btn { flex: 1 1 11rem; }
	.or { margin: 0.4rem 0 0; color: var(--fg-2); font-weight: 600; }
</style>
