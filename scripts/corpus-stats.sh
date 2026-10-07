#!/usr/bin/env bash
# Parse every .daml file under each given directory and report how many parse without ERROR/MISSING nodes.
# Usage: scripts/corpus-stats.sh <dir>... ; failing files are written to $OUT_DIR/<name>.failures (default /tmp).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-/tmp}"
for dir in "$@"; do
  abs="$(cd "$dir" && pwd)"
  name="$(basename "$abs")"
  list="$OUT_DIR/$name.list"
  find "$abs" -name '*.daml' -not -path '*/.daml/*' | sort > "$list"
  (cd "$ROOT" && npx tree-sitter parse -q --paths "$list" 2>&1 || true) \
    | grep -E '\((ERROR|MISSING)' | awk -F'\t' '{print $1}' | sed 's/ *$//' > "$OUT_DIR/$name.failures" || true
  total=$(wc -l < "$list"); bad=$(wc -l < "$OUT_DIR/$name.failures")
  printf '%-16s files=%5d clean=%5d failing=%4d (%.1f%% clean)\n' "$name" "$total" "$((total-bad))" "$bad" \
    "$(echo "scale=4; ($total-$bad)*100/$total" | bc)"
done
