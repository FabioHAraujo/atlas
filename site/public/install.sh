#!/bin/sh
# Atlas installer: https://atlas.codeatlas.com.br
#   curl -fsSL https://atlas.codeatlas.com.br/install.sh | sh
#   curl -fsSL https://atlas.codeatlas.com.br/install.sh | ATLAS_CHANNEL=beta sh   # beta or alpha
#
# Downloads the latest stable GitHub Release of codeatlasdev/atlas, verifies its sha256
# and runs the binary's own `atlas install`, which puts `atlas` in ~/.atlas/bin,
# adds it to PATH for fish/zsh/bash and installs the bundled agent skills.
# No sudo. Prebuilt binaries exist for macOS on Apple silicon only.
set -eu

REPO="codeatlasdev/atlas"

say() { printf '  %s\n' "$1"; }
die() { printf '  x %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"
command -v shasum >/dev/null 2>&1 || die "shasum is required"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64) target="aarch64-apple-darwin" ;;
  *)
    die "Atlas ships prebuilt binaries for macOS on Apple silicon only; this is $os/$arch.
    Build from source instead: https://github.com/$REPO/blob/main/docs/installation.md#build-from-source"
    ;;
esac

# Latest stable tag: the /releases/latest redirect (no API call, so no 60 requests/hour limit; GitHub
# never points it at a prerelease).
tag="$(curl -fsSI --proto '=https' --tlsv1.2 "https://github.com/$REPO/releases/latest" 2>/dev/null \
  | tr -d '\r' | sed -n 's|^[Ll]ocation:.*/releases/tag/\(.*\)$|\1|p' | head -n 1)" || tag=""
[ -n "$tag" ] || die "could not find the latest release: https://github.com/$REPO/releases"
version="${tag#v}"
case "$version" in
  "" | *[!0-9A-Za-z._-]*) die "unexpected release tag '$tag'" ;;
esac

asset="atlas-$version-$target.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

say "Atlas $version ($target)"
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$asset" "$base/$asset" || die "download failed: $asset"
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$asset.sha256" "$base/$asset.sha256" || die "download failed: $asset.sha256"

want="$(cut -d' ' -f1 < "$tmp/$asset.sha256")"
got="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || die "sha256 mismatch for $asset (expected $want, got $got)"
say "sha256 verified"

tar -xzf "$tmp/$asset" -C "$tmp" atlas
chmod +x "$tmp/atlas"

"$tmp/atlas" install

# ATLAS_CHANNEL=beta|alpha: this script installs the latest stable, then the freshly installed atlas
# switches channel and updates itself (same verified download, one resolver: `atlas update --channel`).
case "${ATLAS_CHANNEL:-stable}" in
  stable) ;;
  beta | alpha)
    say "switching to the ${ATLAS_CHANNEL} channel"
    "$HOME/.atlas/bin/atlas" update --channel "$ATLAS_CHANNEL" \
      || say "could not switch to ${ATLAS_CHANNEL} now; run later: atlas update --channel ${ATLAS_CHANNEL}"
    ;;
  *) die "unknown ATLAS_CHANNEL '$ATLAS_CHANNEL' (expected stable, beta or alpha)" ;;
esac

say ""
say "Next:"
say "  open a new shell, then:  atlas version"
say "  atlas desktop            install the desktop app"
say "  atlas setup omp          wire an agent: omp | claude-code | codex (add --apply to write)"
say "  docs: https://atlas.codeatlas.com.br/docs/getting-started/"
