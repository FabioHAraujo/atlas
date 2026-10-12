// GET /release.json -> the latest published release (tag, version, date, dmg + cli assets with sha256/size).
// /download hydrates from this, so the button always points at the newest .dmg whatever the last site deploy was.
import { loadRelease, resolveLatest } from "./_lib/edge";
import { edgeHeaders, wantsFresh } from "./_lib/respond";

export const onRequestGet: PagesFunction = async ({ request }) => {
	try {
		const { value, stale } = await resolveLatest("release", loadRelease, wantsFresh(request.url));
		return Response.json(value, { headers: edgeHeaders({ "access-control-allow-origin": "*" }, stale) });
	} catch (err) {
		return Response.json({ error: "release_unavailable", detail: String(err) }, { status: 502, headers: { "cache-control": "no-store" } });
	}
};

// HEAD answers like GET (Pages routes methods separately); the body is dropped by the runtime.
export const onRequestHead = onRequestGet;
