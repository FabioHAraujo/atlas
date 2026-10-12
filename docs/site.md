---
title: "The website"
description: "Develop, build and deploy the Atlas website (site/)."
---

# The website

`site/` is an Astro 7 + Svelte 5 static site served at https://atlas.codeatlas.com.br. It renders `docs/*.md` and `CHANGELOG.md` directly. See [site/README.md](https://github.com/codeatlasdev/atlas/blob/main/site/README.md) for the file layout and motion rules.

```bash
cd site
bun install
../scripts/fetch-media.sh               # one-off: the film and loops are not in git (see below)
bun run dev                            # http://localhost:4321
bun run build                          # static site in site/dist
```

## Media is not in git

The film, loops and larger stills (`site/public/media/*.mp4`, `*.webm`, and `demo.gif`) are about 28 MB and live only on the deployed site. `scripts/fetch-media.sh` downloads whatever is missing from the live site into `site/public/media/`; it is idempotent and skips files you already have. Posters and stills stay in git (all about 330 KB or less). The media is built from code by the studio in `studio/` (`bun studio render` / `publish`; see [Contributing](contributing.md#making-videos)).

Run `scripts/fetch-media.sh` before `bun run build` or `bun run site:deploy` on any machine that has not built the site before, otherwise the deployed site would ship without the film.

## Design constraints

- The Content-Security-Policy in `site/public/_headers` allows only same-origin resources: no external fonts, scripts, analytics or embeds. Keep everything self-hosted.
- Cloudflare Pages concatenates matching `_headers` rules, so a header set on `/*` cannot be overridden on a sub-path; set `Cache-Control` only on specific paths.
- `prefers-reduced-motion`: no smooth scroll, no ScrollTrigger, no video autoplay. Without JavaScript the page is complete static HTML.

## Deploying (maintainers)

The site is a Cloudflare Pages project. Deploys run locally, like releases:

```bash
export CLOUDFLARE_API_TOKEN=…     # Pages and D1 edit permissions
export CLOUDFLARE_ACCOUNT_ID=…
bun run site:deploy                # build + wrangler pages deploy site/dist
scripts/deploy-site.sh --branch x  # preview deployment
```

`site:deploy` uploads `site/dist`, which is built from `site/public/`, so the media must be present locally (run `scripts/fetch-media.sh` first).

### Release-notes signup (`/api/waitlist`)

`site/functions/api/waitlist.ts` (`POST /api/waitlist`) stores emails in a D1 database bound as `DB` (see `site/wrangler.toml`; schema in `site/functions/schema.sql`). It accepts same-origin requests only, validates and lower-cases the email, ignores a hidden honeypot field, rate-limits per salted hash of the client IP (raw IPs are never stored or logged) and never logs request data. The site presents it as "Get release notes by email"; the endpoint name and contract are unchanged, plus an optional `topic` (`windows`, `linux`, `macos-intel`, `mobile-link`; anything else is dropped) that the download page sends so a signup records the platform someone is waiting for. A repeat signup with a topic appends it to the stored `topics` list. Existing databases need `ALTER TABLE waitlist ADD COLUMN topics TEXT NOT NULL DEFAULT ''` once (also in `site/functions/schema.sql`) **before** deploying this function.

### Download page

### The release engine (the site is never behind the app)

`/download/` and `/changelog/` do not depend on the last site deploy. Cloudflare Pages Functions (`site/functions/`) resolve the **latest published release at the edge**:

| Endpoint | What it serves |
|---|---|
| `/release.json` | tag, version, date, `.dmg` and CLI assets with sha256 and size (from the release's `manifest.json`). `/download/` hydrates from it, so the button always points at the newest `.dmg` |
| `/changelog/` | the static page shell with its body replaced by the changelog **of the latest release** (`CHANGELOG.md` read from `raw.githubusercontent.com` at that tag), one `<section id="v1-2-0">` per version plus a version jump list. `[Unreleased]` is never rendered |
| `/changelog.json` | the same entries as data: `{ tag, entries: [{ version, date, id, html }] }` |

How it stays fresh and alive (`functions/_lib/edge.ts`): the latest tag comes from the redirect of `github.com/codeatlasdev/atlas/releases/latest` (no API quota, no token) and is cached for 60 seconds, so a new release shows within about a minute; everything that hangs off a tag is cached per tag. Responses carry `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=86400, stale-if-error=604800`. If GitHub is down the last good copy is served (header `x-atlas-source: stale-last-good`, and the changelog says so); with nothing cached at all, the page falls back to the body built at the last deploy. Append `?fresh=1` to any of the three to skip the 60-second tag cache (manual cache-bust). The pure parts (changelog parser/renderer, manifest mapping, outage and freshness rules) are unit-tested: `bun test functions` in `site/`, part of `bun run check`.

`scripts/release.sh` also runs `bun run site:deploy` after publishing (skipped with a warning when the Cloudflare variables are missing; a failed deploy never fails the release), which refreshes the built fallback and the docs. See [PRIVACY.md](https://github.com/codeatlasdev/atlas/blob/main/PRIVACY.md).
