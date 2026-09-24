#!/usr/bin/env bash
set -euo pipefail

PKG_VERSION="0.3.11"
CLI_VERSION="0.25.3"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/hooks/grammars"
SOURCE_JSON="$OUT_DIR/tree-sitter-sql.source.json"
NM="$(cd "$(dirname "$0")/.." && pwd)/node_modules/@derekstride/tree-sitter-sql"

if [ ! -d "$NM" ]; then
  echo "ERROR: @derekstride/tree-sitter-sql not found in node_modules"
  echo "Run: bun add --dev @derekstride/tree-sitter-sql@$PKG_VERSION"
  exit 1
fi

WORK_DIR="$(mktemp -d -p "$HOME")"
trap 'rm -rf "$WORK_DIR"' EXIT

cp -r "$NM/." "$WORK_DIR/grammar"

# tree-sitter-cli 0.25+ requires a tree-sitter.json config file
cat > "$WORK_DIR/grammar/tree-sitter.json" <<'EOF'
{
  "grammars": [
    {
      "name": "sql",
      "camelcase": "Sql",
      "scope": "source.sql",
      "file-types": ["sql"],
      "path": "."
    }
  ],
  "metadata": {
    "version": "0.3.11"
  }
}
EOF

npm install --prefix "$WORK_DIR" "tree-sitter-cli@$CLI_VERSION" --silent

(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" build --wasm --docker)

WASM="$WORK_DIR/grammar/tree-sitter-sql.wasm"
ACTUAL_SHA256="$(sha256sum "$WASM" | cut -d' ' -f1)"
ACTUAL_BYTES="$(wc -c < "$WASM")"

EXPECTED_SHA256="$(python3 -c "import json; d=json.load(open('$SOURCE_JSON')); print(d['sha256'])" 2>/dev/null || echo "")"

if [ -n "$EXPECTED_SHA256" ] && [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "WARNING: sha256 mismatch (Docker/emscripten builds may not be byte-identical)"
  echo "  expected: $EXPECTED_SHA256"
  echo "  actual:   $ACTUAL_SHA256"
fi

cp "$WASM" "$OUT_DIR/tree-sitter-sql.wasm"
echo "Installed $OUT_DIR/tree-sitter-sql.wasm ($ACTUAL_BYTES bytes, sha256=$ACTUAL_SHA256)"

python3 -c "
import json, sys
data = {
  'package': '@derekstride/tree-sitter-sql',
  'version': '$PKG_VERSION',
  'cli_version': '$CLI_VERSION',
  'build_command': 'tree-sitter build --wasm --docker',
  'sha256': '$ACTUAL_SHA256',
  'bytes': $ACTUAL_BYTES,
  'rebuild_byte_identical': 'not verified; Docker+emscripten builds are not guaranteed byte-identical across runs'
}
print(json.dumps(data, indent=2))
" > "$SOURCE_JSON"

echo "Updated $SOURCE_JSON"
