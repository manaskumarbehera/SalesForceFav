#!/bin/bash

# ==============================================================
# SalesForceFav — build & package script
# Stages the runtime sources into dist/ (via scripts/build.mjs), then zips
# dist/ into per-store packages with manifest.json at the ZIP root.
#
#   ./build.sh            # build + zip all targets (chrome edge)
#   ./build.sh chrome     # build + zip only Chrome
#   ./build.sh edge       # build + zip only Edge
#
# One MV3 build serves both Chrome and Edge — the only difference is the ZIP
# filename per store.
# ==============================================================

set -e

VERSION=$(node -p "require('./manifest.json').version")
NAME="salesforcefav"
BUILD_ROOT="build"
BROWSERS=("chrome" "edge")

if [ -n "$1" ]; then
    BROWSERS=("$@")
fi

echo "🔧 Building ${NAME} v${VERSION}"
echo "🌐 Targets: ${BROWSERS[*]}"

rm -rf "$BUILD_ROOT" dist

# Stage required runtime files into dist/ (manifest.json lands at dist root).
node scripts/build.mjs

if [ ! -f dist/manifest.json ]; then
    echo "❌ Build did not produce dist/manifest.json"
    exit 1
fi

# Guard: exactly one manifest.json must remain (the extension's, at the root).
MANIFEST_COUNT=$(find dist -name manifest.json | wc -l | tr -d ' ')
if [ "$MANIFEST_COUNT" != "1" ]; then
    echo "❌ Expected exactly one manifest.json in dist/, found $MANIFEST_COUNT"
    find dist -name manifest.json
    exit 1
fi

# Zip dist/ into each target package.
for BROWSER in "${BROWSERS[@]}"; do
    ZIP_PATH="$BUILD_ROOT/$BROWSER/${NAME}-v${VERSION}-${BROWSER}.zip"
    mkdir -p "$BUILD_ROOT/$BROWSER"
    ( cd dist && zip -r -q -X "../$ZIP_PATH" . )
    SIZE=$(du -h "$ZIP_PATH" | cut -f1)
    echo "📦 ${BROWSER}: $ZIP_PATH (${SIZE})"
done

echo "✅ Build complete."
