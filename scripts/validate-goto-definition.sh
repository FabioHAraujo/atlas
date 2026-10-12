#!/usr/bin/env bash
# End-to-end check of ⌘-click go to definition in a *debug* Atlas Desktop (`bun run desktop:dev`),
# driven through the debug bridge: it dispatches DOM events inside the webview (never OS input) on the
# real CodeMirror view, then asserts the active tab, its path and the selected range.
#
#   scripts/validate-goto-definition.sh <worktree-id> <rel-file> <needle> [expect-path-suffix] [shot-dir]
#
# <needle> is a piece of text in <rel-file> whose first identifier is ⌘-clicked. The script waits for
# the language server, checks the ⌘-hover underline, clicks, then checks where the app landed.
# Exit 0 = landed in <expect-path-suffix> (default: any other file) with the symbol selected.
set -euo pipefail

WT=${1:?worktree id}
FILE=${2:?relative file}
NEEDLE=${3:?text to click on}
EXPECT=${4:-}
SHOTS=${5:-/tmp/goto-shots}
mkdir -p "$SHOTS"
dbg() { atlas desktop debug "$@"; }
# The needle goes into JavaScript as a JSON string literal (bash 3.2 on macOS has no ${var@Q}).
NEEDLE_JS=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$NEEDLE")

echo "== open $FILE (the live stores, never a re-imported module)"
dbg eval "window.__atlas.ws.reveal('$WT', t => t.kind === 'editor' && t.path === '$FILE', { kind: 'editor', label: '$FILE'.split('/').pop(), path: '$FILE' }); return 'opened'" >/dev/null

echo "== wait for the editor and its language server (up to 120s; the bridge caps one eval at ~10s, so poll from here)"
READY_JS="
const a = window.__atlas;
const abs = a.ws.worktree('$WT').path + '/$FILE';
const mine = a.lsp.servers.filter(s => abs.startsWith(s.root + '/'));
const doc = a.docOf(abs);
return JSON.stringify({
  ready: a.editors.has('$WT:$FILE') && !!doc?.open && mine.some(s => s.state === 'ready'),
  servers: a.lsp.servers.map(s => s.name + ':' + s.state + (s.progress ? '(' + s.progress + ')' : '')),
});"
deadline=$((SECONDS + 120))
last=""
while :; do
  out=$(dbg eval "$READY_JS" 2>/dev/null || true)
  [ -n "$out" ] && line=$(python3 -c 'import json,sys; r=json.loads(json.loads(sys.stdin.read())); print(r["ready"], r["servers"])' <<<"$out" 2>/dev/null || true)
  [ "$line" != "$last" ] && [ -n "$line" ] && echo "   $line" && last="$line"
  case "$line" in True*) break ;; esac
  [ $SECONDS -ge $deadline ] && { echo "FAIL: language server never became ready"; exit 1; }
  sleep 1
done

echo "== ⌘-hover underline, ⌘-click, assert the landing"
dbg eval "
const key = '$WT:$FILE';
const view = window.__atlas.editors.get(key);
const needle = $NEEDLE_JS;
const at = view.state.doc.toString().indexOf(needle);
if (at < 0) return 'FAIL: needle not found';
const word = /[\\p{L}\\p{N}_\$]+/u.exec(needle)[0];
const pos = at + needle.indexOf(word) + Math.floor(word.length / 2);
view.dispatch({ effects: view.constructor.scrollIntoView(pos, { y: 'center' }) });
await new Promise(r => setTimeout(r, 200));
const c = view.coordsAtPos(pos);
const ev = (type, extra) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: c.left + 1, clientY: (c.top + c.bottom) / 2, button: 0, metaKey: true, view: window, ...extra });
const target = view.contentDOM;
target.dispatchEvent(ev('mousemove'));
await new Promise(r => setTimeout(r, 150));
const underlined = !!view.dom.querySelector('.cm-lsp-link');
target.dispatchEvent(ev('mousedown'));
target.dispatchEvent(ev('mouseup'));
target.dispatchEvent(ev('click'));
await new Promise(r => setTimeout(r, 2500));
const ws = window.__atlas.ws;
const tab = ws.tab(ws.focusedGroup(ws.selected.id).activeTab);
const nowView = window.__atlas.editors.get(tab.worktreeId + ':' + tab.path);
const sel = nowView?.state.selection.main;
return JSON.stringify({
  underlined,
  tabPath: tab.path,
  selected: sel && nowView.state.sliceDoc(sel.from, sel.to),
  line: sel && nowView.state.doc.lineAt(sel.from).number,
});
" | tee "$SHOTS/result.json"

dbg shot "$SHOTS/after-click.png" >/dev/null || true

python3 - "$SHOTS/result.json" "$FILE" "$EXPECT" <<'PY'
import json, sys
r = json.loads(json.loads(open(sys.argv[1]).read()))
file, expect = sys.argv[2], sys.argv[3]
ok = r["underlined"] and r["selected"] and (r["tabPath"].endswith(expect) if expect else r["tabPath"] != file)
print("PASS" if ok else "FAIL", r)
sys.exit(0 if ok else 1)
PY
