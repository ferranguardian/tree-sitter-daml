#!/usr/bin/env bash
# For each file in a failures list, print the innermost (smallest) ERROR/MISSING node's line and source text.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
while read -r f; do
  best=$(cd "$ROOT" && npx tree-sitter parse "$f" 2>/dev/null \
    | grep -oE '\((ERROR|MISSING)[^[]*\[[0-9]+, [0-9]+\] - \[[0-9]+, [0-9]+\]' \
    | sed -E 's/.*\[([0-9]+), ([0-9]+)\] - \[([0-9]+), ([0-9]+)\]/\1 \2 \3 \4/' \
    | awk '{print ($3-$1)*100000 + ($4-$2), $1}' | sort -n | head -1 | awk '{print $2}' || true)
  [ -z "$best" ] && continue
  printf '%s:%d: %s\n' "$f" "$((best+1))" "$(sed -n "$((best+1))p" "$f" | sed 's/^ *//' | cut -c1-120)"
done < "$1"
