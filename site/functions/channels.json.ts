// GET /channels.json -> every release channel with its copy (promise, risk, cadence, audience: crates/atlas-core/data/channels.json,
// the same source the CLI and Atlas Desktop use) and the release each one offers right now (`release: null` when nothing is
// published for it). /download hydrates its "Other channels" cards from this. One stable lookup and one feed fetch serve all three.
import { channelsPayload } from "./_lib/channels";
import { loadRelease, resolveChannels } from "./_lib/edge";
import { edgeHeaders, wantsFresh } from "./_lib/respond";

export const onRequestGet: PagesFunction = async ({ request }) => {
	try {
		const { value, stale } = await resolveChannels("release", loadRelease, wantsFresh(request.url));
		return Response.json(channelsPayload(value), { headers: edgeHeaders({ "access-control-allow-origin": "*" }, stale) });
	} catch (err) {
		return Response.json({ error: "channels_unavailable", detail: String(err) }, { status: 502, headers: { "cache-control": "no-store" } });
	}
};

// HEAD answers like GET (Pages routes methods separately); the body is dropped by the runtime.
export const onRequestHead = onRequestGet;
