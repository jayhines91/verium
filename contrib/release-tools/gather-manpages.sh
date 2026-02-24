#!/usr/bin/env bash
# Gather Verium manpages into a folder for release packaging.
# Usage: ./gather-manpages.sh [OUTPUT_DIR]
#   OUTPUT_DIR: target directory (e.g. out-linux/share/man/man1 or out/share/man/man1)
#   Default: share/man/man1 in repo root
set -e
TOPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANDIR="${MANDIR:-$TOPDIR/doc/man}"
OUTDIR="${1:-$TOPDIR/share/man/man1}"

echo "Gathering manpages from $MANDIR to $OUTDIR"

mkdir -p "$OUTDIR"

# Optional: regenerate help2man pages if binaries exist (for release builds)
BINDIR="${BINDIR:-$TOPDIR/src}"
if [ -x "$BINDIR/veriumd" ] && command -v help2man >/dev/null 2>&1; then
  echo "Regenerating manpages from binaries (help2man)..."
  (cd "$TOPDIR" && contrib/devtools/gen-manpages.sh) 2>/dev/null || true
fi

# Copy all .1 manpages
for f in "$MANDIR"/*.1; do
  if [ -f "$f" ]; then
    cp -f "$f" "$OUTDIR/"
    echo "  + $(basename "$f")"
  fi
done

count=$(ls -1 "$OUTDIR"/*.1 2>/dev/null | wc -l)
echo "Manpages ready in $OUTDIR ($count files)"
