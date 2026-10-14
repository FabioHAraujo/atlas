#!/bin/sh
# Atlas installer: https://atlas.codeatlas.com.br
#   curl -fsSL https://atlas.codeatlas.com.br/install.sh | sh
#   curl -fsSL https://atlas.codeatlas.com.br/install.sh | ATLAS_CHANNEL=stable sh   # stable, beta or alpha
#
# Downloads the latest stable GitHub Release of codeatlasdev/atlas, verifies its sha256
# and runs the binary's own `atlas install`, which puts `atlas` in ~/.atlas/bin,
# adds it to PATH for fish/zsh/bash and installs the bundled agent skills. Then the installed
# atlas moves to the channel you follow: the default (alpha while Atlas is in alpha, so the
# newest build from main) or the one in ATLAS_CHANNEL, which is remembered.
# No sudo. Prebuilt binaries: macOS on Apple silicon and Linux x86_64 (glibc 2.35+: Arch, Fedora,
# Debian 12, Ubuntu 22.04 and newer). Linux packages (.deb, .rpm, Arch, AppImage) are on the release page.
set -eu

# What to do after the install for an ATLAS_CHANNEL value. Prints `default` (no value: the
# installed atlas follows its own default channel; nothing is saved, so changing the default
# later still applies), the channel name (an explicit choice: saved with `--channel`), or
# `invalid`. Pure: sourced by scripts/test-bootstrap-channel.sh.
channel_step() {
  case "${1:-}" in
    "") echo default ;;
    stable | beta | alpha) echo "$1" ;;
    *) echo invalid ;;
  esac
}
[ "${ATLAS_BOOTSTRAP_SOURCE_ONLY:-}" = 1 ] && return 0 2>/dev/null

REPO="codeatlasdev/atlas"

say() { printf '  %s\n' "$1"; }
die() { printf '  x %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum or shasum is required"
fi
[ "$(channel_step "${ATLAS_CHANNEL:-}")" != invalid ] || die "unknown ATLAS_CHANNEL '$ATLAS_CHANNEL' (expected stable, beta or alpha)"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64) target="aarch64-apple-darwin" ;;
  Linux-x86_64 | Linux-amd64) target="x86_64-unknown-linux-gnu" ;;
  *)
    die "Atlas ships prebuilt binaries for macOS on Apple silicon and Linux x86_64; this is $os/$arch.
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
got="$(sha256 "$tmp/$asset")"
[ -n "$want" ] && [ "$want" = "$got" ] || die "sha256 mismatch for $asset (expected $want, got $got)"
say "sha256 verified"

tar -xzf "$tmp/$asset" -C "$tmp" atlas
chmod +x "$tmp/atlas"

"$tmp/atlas" install

# This script installs the latest stable, then the freshly installed atlas moves to the channel it
# follows (same verified download, one resolver: `atlas update`). Without ATLAS_CHANNEL that is the
# default channel, passed as ATLAS_UPDATE_CHANNEL (not saved): the stable binary just installed may
# predate the default and would otherwise stay on its own (1.4.0 follows stable). With one,
# `--channel` saves it (stable included).
DEFAULT_CHANNEL=alpha
case "$(channel_step "${ATLAS_CHANNEL:-}")" in
  default)
    say "updating to the newest build of the ${DEFAULT_CHANNEL} channel"
    ATLAS_UPDATE_CHANNEL="$DEFAULT_CHANNEL" "$HOME/.atlas/bin/atlas" update \
      || say "could not update now; run later: atlas update"
    ;;
  stable)
    "$HOME/.atlas/bin/atlas" update --channel stable \
      || say "could not save the stable channel now; run later: atlas update --channel stable"
    ;;
  beta | alpha)
    say "switching to the ${ATLAS_CHANNEL} channel"
    "$HOME/.atlas/bin/atlas" update --channel "$ATLAS_CHANNEL" \
      || say "could not switch to ${ATLAS_CHANNEL} now; run later: atlas update --channel ${ATLAS_CHANNEL}"
    ;;
esac

say ""
say "Next:"
say "  open a new shell, then:  atlas version"
say "  atlas desktop            install the desktop app"
say "  atlas setup omp          wire an agent: omp | claude-code | codex (add --apply to write)"
say "  docs: https://atlas.codeatlas.com.br/docs/getting-started/"
