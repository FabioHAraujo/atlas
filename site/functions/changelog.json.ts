// GET /changelog.json -> the public changelog of the latest release as data: [{ version, date, id, html }].
import { renderChangelog } from "./_lib/changelog";
import { loadChangelog, resolveLatest } from "./_lib/edge";
import { edgeHeaders, wantsFresh } from "./_lib/respond";

export const onRequestGet: PagesFunction = async ({ request }) => {
	try {
		const { value, stale } = await resolveLatest("changelog", loadChangelog, wantsFresh(request.url));
		const { entries } = renderChangelog(value.markdown);
		return Response.json({ tag: value.tag, entries }, { headers: edgeHeaders({ "access-control-allow-origin": "*" }, stale) });
	} catch (err) {
		return Response.json({ error: "changelog_unavailable", detail: String(err) }, { status: 502, headers: { "cache-control": "no-store" } });
	}
};

// HEAD answers like GET (Pages routes methods separately); the body is dropped by the runtime.
export const onRequestHead = onRequestGet;
