// GET /release.json[?channel=stable|beta|alpha] -> the newest published release of a channel (default stable): tag, version, date,
// dmg + cli assets with sha256/size, plus `channel` and `prerelease`. /download hydrates from this, so the button always points at
// the newest .dmg whatever the last site deploy was. 404-free: a channel with nothing newer than stable answers with stable's release.
import { withChannel } from "./_lib/channels";
import { loadRelease, resolveChannel } from "./_lib/edge";
import { badChannel, edgeHeaders, wantedChannel, wantsFresh } from "./_lib/respond";

export const onRequestGet: PagesFunction = async ({ request }) => {
	const channel = wantedChannel(request.url);
	if (!channel) return badChannel();
	try {
		const { value, stale } = await resolveChannel("release", channel, loadRelease, wantsFresh(request.url));
		if (!value) throw new Error(`no published ${channel} release`);
		return Response.json(withChannel(channel, value), { headers: edgeHeaders({ "access-control-allow-origin": "*" }, stale) });
	} catch (err) {
		return Response.json({ error: "release_unavailable", detail: String(err) }, { status: 502, headers: { "cache-control": "no-store" } });
	}
};

// HEAD answers like GET (Pages routes methods separately); the body is dropped by the runtime.
export const onRequestHead = onRequestGet;
