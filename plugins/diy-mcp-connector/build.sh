#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="skills/diy-mcp-connector/scripts"
mkdir -p "$OUT_DIR"

# These are template files copied into generated MCP servers.
# No minification — developers may need to read/debug them.
# Format is ESM because generated servers use "type": "module"
# and auth.ts uses top-level await.

echo "Building auth.js..."
npx esbuild src/auth.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile="$OUT_DIR/auth.js" \
  --external:ws \
  --tree-shaking=true

echo "Building output.js..."
npx esbuild src/output.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile="$OUT_DIR/output.js" \
  --tree-shaking=true

echo "Building csrf.js..."
npx esbuild src/csrf.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile="$OUT_DIR/csrf.js" \
  --tree-shaking=true

echo "Building graphql.js..."
npx esbuild src/graphql.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile="$OUT_DIR/graphql.js" \
  --tree-shaking=true

echo "Build complete:"
ls -lh "$OUT_DIR/auth.js" "$OUT_DIR/output.js" "$OUT_DIR/csrf.js" "$OUT_DIR/graphql.js"
