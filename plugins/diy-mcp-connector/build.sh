#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Sync version from plugin.json (source of truth) into package.json
PLUGIN_VERSION=$(node -e "process.stdout.write(require('./.claude-plugin/plugin.json').version)")
PKG_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
if [ "$PLUGIN_VERSION" != "$PKG_VERSION" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$PLUGIN_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "Synced version: $PKG_VERSION → $PLUGIN_VERSION"
fi

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

echo "Building server.js..."
npx esbuild src/server.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile="$OUT_DIR/server.js" \
  --external:@modelcontextprotocol/sdk \
  --tree-shaking=true

echo "Build complete:"
ls -lh "$OUT_DIR/auth.js" "$OUT_DIR/output.js" "$OUT_DIR/csrf.js" "$OUT_DIR/graphql.js" "$OUT_DIR/server.js"
