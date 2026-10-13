#!/usr/bin/env bash
# Checks bootstrap.sh's pure tag selection (`select_tag`) against the shared vectors in
# testdata/channels/resolve.json, for all three channels. Standalone:
#   scripts/test-bootstrap-channel.sh
# Needs bun or python3 only to read the JSON.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VECTORS="$ROOT/testdata/channels/resolve.json"

ATLAS_BOOTSTRAP_SOURCE_ONLY=1
# shellcheck source=scripts/bootstrap.sh
. "$ROOT/scripts/bootstrap.sh"
set +e # the sourced script turns `-e` on; this runner counts failures instead

# One TSV line per (case, channel): name, channel, stable_tag, expected, comma-joined tags.
# `-` stands for null / empty.
emit() {
  if command -v bun >/dev/null 2>&1; then
    bun -e '
      const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const c of d.cases) for (const ch of ["stable", "beta", "alpha"])
        console.log([c.name, ch, c.stable_tag ?? "-", c.expect[ch] ?? "-", c.tags.join(",") || "-"].join("\t"));
    ' "$VECTORS"
  else
    python3 - "$VECTORS" <<'PY'
import json, sys
for c in json.load(open(sys.argv[1]))["cases"]:
    for ch in ("stable", "beta", "alpha"):
        print("\t".join([c["name"], ch, c["stable_tag"] or "-", c["expect"][ch] or "-", ",".join(c["tags"]) or "-"]))
PY
  fi
}

pass=0
fail=0
check() { # name, got, want
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $1: got '$2', want '$3'" >&2
  fi
}

while IFS=$'\t' read -r name channel stable want tags; do
  [ "$stable" = "-" ] && stable=""
  [ "$want" = "-" ] && want=""
  [ "$tags" = "-" ] && tags=""
  got="$(printf '%s\n' "$tags" | tr ',' '\n' | select_tag "$channel" "$stable")"
  check "$name [$channel]" "$got" "$want"
done < <(emit)

# `sort -V` is not SemVer: it ranks 1.4.0-rc.1 above 1.4.0. The selection must not rely on it.
check "release outranks its rc" \
  "$(printf 'v1.4.0-rc.1\nv1.4.0\n' | select_tag alpha '')" "v1.4.0"
check "alpha.10 beats alpha.9" \
  "$(printf 'v1.4.0-alpha.9\nv1.4.0-alpha.10\n' | select_tag alpha '')" "v1.4.0-alpha.10"
check "numeric identifiers rank below alphanumeric" \
  "$(printf 'v1.4.0-alpha.1\nv1.4.0-alpha.beta\n' | select_tag alpha '')" "v1.4.0-alpha.beta"
check "invalid channel selects nothing" \
  "$(printf 'v1.4.0\n' | select_tag nightly 'v1.3.0')" ""

# The channel nobody chose. Pre-GA it is alpha, like `#[default]` on atlas_core::channel::Channel:
# the two must agree, and an explicit value (even stable) must win over it.
rust_default="$(sed -n '/#\[default\]/{n;s/^ *\([A-Za-z]*\).*/\1/p;q;}' "$ROOT/crates/atlas-core/src/channel.rs" | tr 'A-Z' 'a-z')"
check "default channel matches atlas-core" "$DEFAULT_CHANNEL" "$rust_default"
check "default channel is alpha pre-GA" "$DEFAULT_CHANNEL" "alpha"
check "unset ATLAS_CHANNEL follows the default" "$(chosen_channel "")" "alpha"
check "explicit stable is kept" "$(chosen_channel stable)" "stable"
check "explicit beta is kept" "$(chosen_channel beta)" "beta"
check "an unknown channel is not silently the default" "$(chosen_channel nightly)" "nightly"
# With nothing newer than stable published, the default channel installs stable (never nothing).
check "default channel falls back to stable when nothing newer exists" \
  "$(printf 'v1.4.0\n' | select_tag "$DEFAULT_CHANNEL" 'v1.4.0')" "v1.4.0"
# A 1.4.0 stable user with a newer alpha out: the default channel offers the alpha.
check "default channel installs the newest alpha" \
  "$(printf 'v1.5.0-alpha.2\nv1.5.0-alpha.1\nv1.4.0\n' | select_tag "$DEFAULT_CHANNEL" 'v1.4.0')" "v1.5.0-alpha.2"

# site/public/install.sh (the curl | sh one-liner): which channel the installed atlas moves to.
# Sourced in a subshell so its helpers do not leak into the checks above.
step() { (ATLAS_BOOTSTRAP_SOURCE_ONLY=1; . "$ROOT/site/public/install.sh"; channel_step "$1"); }
check "install.sh: no ATLAS_CHANNEL means the installed atlas follows its default" "$(step "")" "default"
check "install.sh: explicit stable is saved as stable" "$(step stable)" "stable"
check "install.sh: explicit beta" "$(step beta)" "beta"
check "install.sh: explicit alpha" "$(step alpha)" "alpha"
check "install.sh: an unknown channel is rejected" "$(step nightly)" "invalid"
check "install.sh: channel names are exact (no case folding)" "$(step Alpha)" "invalid"

echo "bootstrap channel selection: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
