# Atlas Studio: notes for coding agents

`studio/` builds every published Atlas video from code: the site film and its vertical cut, and "What's new" release videos. A film is **typed data**; scene builders turn it into HTML; [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) renders the picture; `ffmpeg` mixes and measures the audio. Why HyperFrames and not Remotion: [DECISION.md](DECISION.md) (license).

```
studio/
  films/<id>/film.ts       a film: cuts (aspect ratios), scene list, narration lines, chapters, music
  src/
    lib/types.ts           THE contract (Film, Cut, Scene, …). Read it first.
    scenes/                scene builders: title, code, app, terminal (+ base.ts: field, fades, title block)
    compile.ts             Film cut -> HyperFrames project in .build/<film>/<aspect>/ (pure function of data + asset hashes)
    prepare.ts             crop/scale/trim recordings into small H.264 proxies, cached by input hash
    render.ts              compile -> `hyperframes check` -> render -> mix -> mux -> webm/vtt/poster/sprite
    audio/voice.ts         ElevenLabs TTS cached by text hash;  audio/mix.ts  ducking + MEASURED loudness assert
    capture/               `capture app|tui`: the real app (isolated instance) and the vhs take
    lint/                    the "video LSP": checks on images/videos (see "Lint" below)
  publish.ts release.ts still.ts preview.ts check.ts cli.ts
  assets/                  fonts (the site's own, OFL), logo.svg
  clips/library.json       tagged recordings that release videos pick from
  .cache/ .build/ out/     gitignored: manifest + takes + proxies, compiled projects, renders
```

## Commands (from the repo root; `bun studio help`)

| Command | What |
|---|---|
| `bun studio check` | **The gate for studio changes.** tsc, brand tokens vs the site CSS, film data, a 1 s-per-scene smoke render of every cut (real compile + HyperFrames lint + render), and a determinism check, and a media lint of the published files (errors fail). ~1-2 min. |
| `bun studio preview <film> [--aspect 9:16] [--open]` | Compiles, serves HyperFrames Studio on :3002, rebuilds on save of film.ts / scenes / brand. |
| `bun studio render <film> [--aspect …] [--cut <out>] [--draft]` | Full render to `studio/out/<film>/` (mp4, webm, vtt, poster, scrub sprite, `*.report.json` with measured duration/LUFS/hashes). `--draft` is a fast low-quality silent-quality pass. |
| `bun studio voice <film> [--offline] [--models]` | Synthesize narration. Cached by hash of (line id, voice, model, settings, text); only changed lines hit the API. `--models` lists the account's TTS models (the film pins `model`; bump it deliberately). |
| `bun studio capture app <scene>` / `tui <take>` / `list` | Record the real app or the vhs take into `.cache/` and register it (sha256) in `.cache/manifest.json`. |
| `bun studio assets [list\|verify\|import <dir>]` | Inspect or verify the manifest; `import` seeds it from the 1.0 working dir. |
| `bun studio publish <film> [--release vX.Y.Z] [--stills]` | Lints the render first and **refuses on errors**, then copies renders into `site/public/media/`, writes `manifest.json` (content hashes) and `film-chapters.json`; `--release` also `gh release upload`s the mp4/webm. `--stills` publishes only the posters (and their manifest entries). |
| `bun studio still <film> [--aspect …] [--at s] [--out f]` | Re-render ONE still (the cut's poster by default): renders only the scene the time falls in, lints the frame, writes `out/<film>/<cut>-poster.jpg`. Refreshing a poster never needs a film render. |
| `bun studio lint <film\|file\|dir> [--profile p] [--json] [--ref f] [--fast] [--strict]` | The video LSP. Exit 1 on any error. `--json` prints diagnostics for agents. A file with a `<name>.camera.json` beside it (a social cut) also gets the camera and caption rules. |
| `bun studio fix <film> [--apply] [--cut out\|--aspect a] [--max N]` | lint -> apply the camera fixes the diagnostics suggest (writes `films/<id>/camera.json`) -> re-render -> lint, at most N rounds (default 4), then a report. Without `--apply` it only prints what it would change. See "Social cuts". |
| `bun studio loops [--only loop-panel,shot-agents]` | The site's loops and screenshots from the `recipes/site-media.ts` captures (+ the vhs take for `loop-tui`): cut, encode under 600 KB, lint, then replace `site/public/media/loop-*`, `shot-*` and their manifest entries. Nothing is replaced when any file has a lint error. |
| `bun studio release <version\|unreleased> [--as 1.1] [--voice] [--aspect …] [--draft]` | "What's new" video (16:9 + 9:16) from the CHANGELOG.md section. |

## Add a scene to a film

1. Open `films/<id>/film.ts`. Scenes are plain objects in `cut.scenes`; copy a neighbour. Types: `title` (headline/subtitle/url + optional Atlas `mark`), `code` (shiki card, optional `typing`), `app` (a recording: `clip: "rec:<name>"`, `from`, `crop`, `box`, optional `push`/`pan`/`cursor`/`overlay`), `terminal` (a vhs take cut into `segments`, `speed`, `width`).
2. Durations are seconds; the film's cut is `transitionIn: dip 0.25 s` (default) / `crossfade` / `cut`. Total length = sum of durations (minus crossfade overlaps).
3. If the scene needs new footage: `bun studio capture app <scene>` (adds `rec:<scene>` to the manifest).
4. Move the narration: `voice.lines[].at` is the second a line starts; `chapters[].t` is the site player's chapter list. `publish` writes them to `site/public/media/film-chapters.json`; the site reads that file, so you never edit `site/src/data/film.ts` by hand.
5. `bun studio preview <film>` to look, `bun studio check` before you finish.

## Add a scene TYPE

Add the type to `src/lib/types.ts` (`Scene` union), a builder `src/scenes/<type>.ts` returning `{ html, css, js }` (`js` is GSAP on the scene's paused timeline `tl`, scene-local seconds), and one `case` in `compile.ts`'s `buildScene`. Reuse `base.ts` (`titleHtml`, `alphaIn`, `markHtml`).

## Add a film

`films/<id>/film.ts` default-exports a `Film`. It is discovered automatically (`bun studio films`). One film may have several cuts (16:9, 9:16, 1:1); each cut has its own scene list and narration.

## Rules that keep renders deterministic (HyperFrames contract)

- No `Date.now()`, `performance.now()`, unseeded `Math.random()`, network fetches or input state in scene code. Motion is GSAP on a **paused** timeline registered as `window.__timelines["<scene-id>"]`; `compile.ts` already does the registration, scene builders only add tweens.
- Never tween `visibility`/`display`/`autoAlpha` on a `.clip`; fade a child (`#root-fade` does the scene fades).
- A `<video data-start>` must not sit inside another element with `data-start` (lint error). Scenes are sub-compositions, so the scene's video is its own timed child; push/pan act on its non-timed wrapper `#clip`.
- Every `<audio>` needs an id. The studio renders the picture **silent** and mixes audio with ffmpeg so loudness is measured, not assumed.
- Text must fit its box: use `max-width`/wrapping, never `<br>` in body text.
- Fonts are the site's own files in `assets/fonts` (copied into each project). Brand tokens are in `src/brand/tokens.ts`; `check` fails if they drift from `site/src/styles/global.css`.

## Lint: the video LSP (`src/lint/`)

`bun studio lint` checks the *output*, not the film data: pictures and rendered videos. Every finding is a diagnostic with `severity`, a stable `code`, a pixel `rect` or a `range` in seconds, `measured`/`limit`, and a `fix` (`action` + `params`) an agent can apply. `bun studio lint <file> --json` is the contract; `publish` and `still` refuse files with errors, and `check` fails if a published file has any.

| Code | What it catches |
|---|---|
| `frame/edge-clipped` | the subject (an app window) is closer than 3% of the short side to a frame edge |
| `frame/window-cropped` | structure crosses the top/bottom edge of the subject: the window was cut by a crop (the cover/README defect: `crop y:40` sliced the titlebar) |
| `safe-area/text-overlaps-ui` | authored text inside a platform UI zone (Reels/TikTok/Shorts) |
| `text/too-small`, `text/low-contrast` | authored text under the profile's legible size / WCAG contrast (OCR: tesseract if installed, else a macOS Vision helper `native/vision.swift`) |
| `video/black-frames`, `video/frozen-frames`, `video/flashing` | black in the middle, a stalled picture, > 3 flashes/s (BT.1702/Harding) |
| `audio/loudness`, `audio/true-peak`, `audio/clipping` | integrated LUFS vs the profile, peak above -1 dBTP, clipped samples |
| `spec/aspect|resolution|duration|codec|bitrate|keyframe-interval` | the file against its profile |
| `quality/vmaf` | with `--ref`, a re-encode that is visibly worse than its reference |

Profiles (`lint/profiles.ts`): `site`, `site-film`, `site-loop`, `site-sibling`, `site-shot`, `social-vertical`, `social-square`, `social-landscape`, `still`. Default by file name and shape; override with `--profile`. `captured` profiles (loops, webm siblings, and `site-shot` for `shot-*.jpg` / `loop-*-poster.jpg`) skip text rules: the typography is the real app's, shown at the app's own size, and a screenshot of the product cannot be re-typeset. The film posters are composed frames and keep the strict `still` profile.

Rules authors hit: **never crop the window of a recording** (use the full frame; the window's own bezel, corners and shadow are part of the picture, and the box needs 3% headroom **measured with the soft shadow, ~20 px**: `films/atlas-1-0/film.test.ts` pins it, the vertical box is 972 of 1080), and **the delivered files peak under -1 dBFS**: AAC and Opus overshoot the wav the mixer limits by 0.7-0.9 dB, so the limiter ceiling (`LIMITER_CEILING`) sits lower and `render` asserts the peak of the encoded mp4 and webm (`assertDelivered`), not of the intermediate. Scan sprites (`*-thumbs.jpg`) are not linted. Tests use synthetic windows plus real-poster and real-frame fixtures in `src/lint/__fixtures__/`: write the failing fixture first.

## Social cuts: legible 9:16, 4:5 and 1:1 (virtual camera)

A phone shows a 1080 px frame about 390 pt wide: the app's 13 px labels come out ~4 pt tall at zoom 1, which nobody reads. The fix is a **virtual camera** over the recording, planned from what the viewer must read, never pushed by hand. One film, many renditions:

```
films/<id>/social.ts   Film.sources[]   a source cut: scenes + `focus` lists (what must be readable, when)
                       Film.renditions[] derived cuts (`reframe: { from, profile }`, scenes: []) 9:16, 1:1, 4:5
films/<id>/camera.json                  the ONLY file `studio fix` writes: zoom overrides per `<cut>/<scene>/<focus>`
src/camera/   types.ts (contract)  plan.ts (planner)  reframe.ts (layout per aspect)  focus.ts (resolve rects)
              gsap.ts (keys -> frame-exact GSAP)  derive.ts (resolver, camera.json, sidecar)  proxy.ts
src/captions/ chunk.ts layout.ts styles.ts html.ts     burned captions from the VO alignment
src/lint/camera.ts                      camera/*, text/too-small-for-target, safe-area/caption, captions/* rules
```

**How an agent makes a social cut** (all deterministic; the agent edits data, never pixels):

1. **Annotate focuses** on the source scenes in `films/<id>/social.ts`: `{ id, at, hold, text | selector | rect, textPx, label }`. `at` is the scene second the viewer must be able to read it. `textPx` is the CSS px of the smallest text in it (the app's labels are 11-14). Find the anchor with `text: "…"` (OCR of the recording's frame, cached by content, for footage recorded before focus steps), or, in a **recipe**, add a `{ do: "focus", target: "<selector>", label, ms, textPx }` step: the app records the element's rect in `timeline.json` and the focus uses `selector: "<selector>"` (exact, no OCR). A text that matches two lines is an error that lists the OCR lines: name a longer text.
2. `bun studio render <film> --cut film-social-vertical` (add `--draft` while iterating, ~80 s for 30 s of 9:16). It derives scenes + camera from the source and `camera.json`, renders, and writes `<cut>.camera.json` (what the camera did, in output px and cut seconds) next to the mp4.
3. `bun studio lint <film> --cut …` or `bun studio lint studio/out/<film>/<cut>.mp4 --json`. Every diagnostic has the shot id, a time range and a `fix`.
4. `bun studio fix <film> --apply --cut <cut>`: applies the `set-camera-zoom` fixes to `camera.json`, re-renders, re-lints, up to `--max` rounds. It stops at 0 errors, when a round applies nothing, or at the cap, and prints each round. **Never** hand-edit pixels, boxes or the planned keys; if the report says `enlarge-source-text`, the recording's text is too small for any camera zoom (the resolution cap): change the focus to something larger, or re-capture with bigger text.
5. Lint again and attach the report. 0 errors for the profile (`social-vertical`, `social-portrait`, `social-square`) is the bar.

**The rules (numbers live in `lint/profiles.ts` and `camera/types.ts`, derivations in the comments):**

| Rule | What it is |
|---|---|
| legibility | the glyph band of a focus' smallest text must reach `minFocusTextPx` (18) at the platform's `displayHeight`: zoom = `minTextPx * frameH / displayHeight / (textPx * 2 * 0.8 * fit)`; authored text (headlines, captions) uses the stricter `minTextPx` (28 on 9:16) |
| resolution cap | never more than 2 output px per source px (OCR kept confidence 1.0 up to 3x bicubic on the app's UI text; 2x leaves margin). A focus that needs more is planned at the cap and flagged: the cure is bigger source text |
| motion | pan <= 700 output px/s, zoom <= 0.9 e-folds/s (smootherstep peak counted), still 0.35 s before the text must be read, a move longer than 1.6 s or past 1400 px is a **cut**, never a whip-pan; the opening pose is the whole window (a complete first frame) |
| frame | the viewport never shows outside the source; a focus wider than the viewport is framed whole (4% margin) and reported |
| safe area | text, captions and focus rects stay out of the union of Reels/TikTok/Shorts zones (`VERTICAL_PLATFORMS`); diagnostics name the platform |
| captions | from the VO alignment (line speech seconds spread over words by length, extra weight after punctuation): <= 17 CPS, <= 27 chars/line (9:16) or 32, <= 2 lines, >= 2 frames gap, >= 0.8 s, wrapped by the same Archivo width model the lint uses; sitting just above the bottom UI zone |

| Code | What it catches |
|---|---|
| `camera/too-fast` | pan or zoom speed over the shot's limit at some instant; fix `slow-camera` |
| `camera/subject-out-of-frame` | a focus rect leaves the viewport or the safe area while it must be read; fix `set-camera-zoom` (largest zoom that fits) |
| `text/too-small-for-target` | OCR on the RENDERED frame at the focus' hold: the smallest text in the focus is under `minFocusTextPx`; fix `set-camera-zoom` (zoom x min/shown x 1.05) or `enlarge-source-text` when the cap forbids it |
| `text/focus-empty` | no readable text in the focus rect: the camera points at the wrong place |
| `safe-area/caption` | a caption block enters a platform UI zone |
| `captions/cps\|line-length\|lines\|gap\|duration` | the Netflix timed-text rules tightened for a phone; fix `rechunk-captions` |

Tests for every rule: `src/camera/*.test.ts`, `src/lint/camera.test.ts`, `src/captions/*.test.ts`, `src/fix.test.ts`, `src/scenes/*.test.ts`. A new rule needs its failing fixture first (real planner output and real OCR, never hand-typed sidecars).

## Media is not in git

`studio/.cache/` (recordings, takes, stills, voice, music, proxies) and `studio/out/` are gitignored. The manifest records sha256 + source of every cached asset. A fresh clone has nothing cached: `bun studio assets` shows what is missing and each missing key's error says which command makes it (`capture app`, `capture tui`, `voice`, `bg`). The published media is fetched with `scripts/fetch-media.sh`.

## Secrets

Only from the environment: `ELEVENLABS_API_KEY` (voice), `MAGNIFIC_API_KEY` (cobalt stills). The CLI also reads `KEY=value` lines from the files in `ATLAS_STUDIO_ENV` (colon-separated, default `~/.config/atlas-site/secrets.env`) without overriding the environment. Never commit a key, never print one. HyperFrames telemetry is disabled by the CLI (`HYPERFRAMES_NO_TELEMETRY=1`).

## Recipes: `bun studio run`

`studio/recipes/<id>.ts` default-exports a `RecipeInput` (`schema: "atlas.recipe/1"`): `captures[]` of `{ id, script, shots?, instance? }`. `script` is the in-app capture script (`apps/desktop/src/lib/capture/script.ts`: steps run through the app's own stores, never OS input). `instance` is the state the app starts in: default `{ projects: true, onboarding: false }` (seeded demo projects); `{ projects: false, onboarding: true }` is a first-run app in an empty scratch HOME, so discovery can never list the user's real projects. Captures are cached by script + instance + app build; `--force` re-records, `--dry-run` prints the plan. The recorder is the app's own (ScreenCaptureKit, `atlas desktop capture|record`), not an external tool: `winrec` is gone. `recipes/onboarding.ts` films the intro (3900 ms, hit at 1680 ms) and welcome; it is smoke-tested only until the welcome screen is final.

`fixture` (optional, one of `orbit-stack`, `orbit-agents`, `orbit-spaces`; `capture/fixtures.ts`) is a coded setup run in the fresh app BEFORE the recorder rolls: worktrees, a stack running with log/metric history, the scripted agents. The script grammar drives the UI but cannot start a stack, so stateful clips need one. A capture with a fixture always gets its own app instance (its stack and agents must not leak into the next clip) and the fixture is part of the cache key. `terminal` steps for the demos use `["bash", "-c", "bash ~/.atlas-studio/term-demo"]` / `mcp-demo`: launchers planted in the scratch HOME (`demoLaunchers` in `capture/settings.ts`) carry the env the demos need, so a recipe is the same text on every machine.

**The site's loops and screenshots are recipes too:** `bun studio run recipes/site-media.ts` records six captures (workspace, panel, logs, terminal, agents, mcp) from the current app; `bun studio loops` cuts and encodes `loop-*.mp4/.webm/-poster.jpg` and `shot-*.jpg` from them (what each file is made of: `src/site-media.ts`), cuts `loop-tui` from the vhs take, lints everything and only then replaces the published files and `manifest.json`. `--only loop-panel,shot-agents` limits it.

## Capturing the real app: rules that matter

- **Capture runs in agent mode, always.** The instance is spawned with `ATLAS_AGENT=1` (`appEnv` in `src/capture/app.ts`): no Dock icon or tray, never focused, its window on a private 2x virtual display, never on the user's desktop. Never show a window to the user for a capture, never send input to his desktop; drive the app only through the debug bridge (`atlas desktop debug …`, see root AGENTS.md "Debugging Atlas Desktop"). The instance has its own `HOME` and `ATLAS_HOSTD_DIR`; the recorder is the app's own, on its own window.
- To look at the app while writing a scene or recipe, start your own instance (`bun run desktop:agent -- --name studio`, `export ATLAS_DEBUG_SOCK=…`) and use `debug shot --selector`, `debug a11y`, `debug eval` to find selectors; stop it with `--stop`. Never point `atlas desktop debug` at the user's app (the default socket).
- Never kill the user's apps or the container runtime; the capture tool only stops the pids it spawned, verified by command line.
- Never `rm -rf`/`git clean` at the repo root. Scratch lives in a `mkdtemp` dir and every delete asserts the path is inside it.
- It needs `target/debug/atlas` and `target/debug/bundle/macos/Atlas.app` (see root AGENTS.md "Deploying a local build"), `vhs` for TUI takes, and macOS Screen Recording permission for the terminal that runs it.

## Pinned engine

`hyperframes` is pinned exactly in `package.json`. To bump it: change the pin, `bun install`, `bun studio check`, then re-render `atlas-1-0` and compare frames against the previous render (SSIM per scene; see DECISION.md). Do not bump casually: HyperFrames is 0.x.
