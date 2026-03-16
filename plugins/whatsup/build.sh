#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="skills/whatsup/scripts"
mkdir -p "$OUT_DIR"

# Use --minify for smaller bundles, drop sourcemaps for production
MINIFY_FLAGS="--minify --drop:debugger"

echo "Building CLI bundle..."
npx esbuild src/cli/main.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$OUT_DIR/whatsup.js" \
  --define:process.env.NODE_ENV=\"production\" \
  --banner:js='#!/usr/bin/env node' \
  --tree-shaking=true \
  $MINIFY_FLAGS

echo "Building proxy server bundle..."
npx esbuild src/proxy/main.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$OUT_DIR/proxy.js" \
  --define:process.env.NODE_ENV=\"production\" \
  --banner:js='#!/usr/bin/env node' \
  --tree-shaking=true \
  $MINIFY_FLAGS

chmod +x "$OUT_DIR/whatsup.js" "$OUT_DIR/proxy.js"

echo "Build complete:"
ls -lh "$OUT_DIR/whatsup.js" "$OUT_DIR/proxy.js"
