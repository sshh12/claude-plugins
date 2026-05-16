#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="dist"
mkdir -p "$OUT_DIR"

# Production-flavored bundle: minified, no debugger statements.
MINIFY_FLAGS="--minify --drop:debugger"

echo "Building MCP server bundle..."
npx esbuild src/mcp/server.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$OUT_DIR/mcp-server.js" \
  --define:process.env.NODE_ENV=\"production\" \
  --banner:js='#!/usr/bin/env node' \
  --tree-shaking=true \
  $MINIFY_FLAGS

chmod +x "$OUT_DIR/mcp-server.js"

echo "Build complete:"
ls -lh "$OUT_DIR/mcp-server.js"
