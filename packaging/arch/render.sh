#!/usr/bin/env bash
# Render the Arch PKGBUILD for a release from PKGBUILD.in.
#
# Usage: packaging/arch/render.sh <version> <deb> > PKGBUILD
#   <version>  SemVer of the release (1.6.0, 1.6.0-beta.2)
#   <deb>      the release's atlas_<version>_amd64.deb (its SHA-256 goes in the PKGBUILD)
#
# pacman versions cannot hold "-": a prerelease suffix is glued on without it (1.6.0-beta.2 →
# 1.6.0beta.2), which vercmp orders before 1.6.0, as SemVer does.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

[[ $# == 2 ]] || { echo "usage: $0 <version> <deb>" >&2; exit 2; }
version=$1 deb=$2
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]] || { echo "invalid version: $version" >&2; exit 1; }
[[ -f "$deb" ]] || { echo "no such file: $deb" >&2; exit 1; }

pkgver=${version/-/}
sha=$( (sha256sum "$deb" 2>/dev/null || shasum -a 256 "$deb") | cut -d' ' -f1)

sed -e "s/@PKGVER@/$pkgver/g" -e "s/@VERSION@/$version/g" -e "s/@SHA256@/$sha/g" "$here/PKGBUILD.in"
