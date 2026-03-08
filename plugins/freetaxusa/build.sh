#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="skills/freetaxusa/scripts"
mkdir -p "$OUT_DIR"

MINIFY_FLAGS="--minify --drop:debugger"

echo "Building extract-pdf bundle..."
npx esbuild src/extract-pdf.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --external:canvas \
  --external:@napi-rs/canvas \
  --outfile="$OUT_DIR/extract-pdf.js" \
  --define:process.env.NODE_ENV=\"production\" \
  --tree-shaking=true \
  $MINIFY_FLAGS

chmod +x "$OUT_DIR/extract-pdf.js"

# Copy pdf.js worker alongside the bundle (pdf.js resolves it relative to the main script)
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs "$OUT_DIR/pdf.worker.mjs"

echo "Build complete:"
ls -lh "$OUT_DIR/extract-pdf.js" "$OUT_DIR/pdf.worker.mjs"
