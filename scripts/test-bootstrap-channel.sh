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

echo "bootstrap channel selection: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
