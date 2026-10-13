#!/bin/sh
# bun run desktop:agent [--name N] [--scratch] [--stop]
# An isolated Atlas Desktop for an agent: own HOME, hostd and debug socket, never on the user's desktop (virtual
# display, no Dock icon, no focus). Builds the debug bundle and the CLI when missing, then starts it through
# `atlas desktop --agent`, which prints `ATLAS_DEBUG_SOCK=<socket>`. See AGENTS.md "Debugging Atlas Desktop".
set -eu
cd "$(dirname "$0")/.."
ATLAS=target/debug/atlas
APP=target/debug/bundle/macos/Atlas.app/Contents/MacOS/atlas-desktop
stopping=0
for a in "$@"; do [ "$a" = "--stop" ] && stopping=1; done
if [ "$stopping" = 0 ]; then
	if [ ! -x "$ATLAS" ]; then
		cargo build -q -p atlas-cli
		codesign -f -s - "$ATLAS" 2>/dev/null || true
	fi
	if [ ! -f "$APP" ]; then
		echo "building the debug app (first time only; rebuild with: bun run desktop:build:app)" >&2
		# app bundle only: a DMG makes tauri's bundle_dmg.sh mount the image and open Finder on the user's screen
		bun run desktop:build:app >&2
	fi
fi
exec "$ATLAS" desktop --agent "$@"
