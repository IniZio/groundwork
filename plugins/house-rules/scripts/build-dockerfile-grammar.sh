#!/usr/bin/env bash
set -euo pipefail

GRAMMAR_REPO="https://github.com/camdencheek/tree-sitter-dockerfile"
GRAMMAR_COMMIT="971acdd908568b4531b0ba28a445bf0bb720aba5"
CLI_VERSION="0.25.3"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/hooks/grammars"
EXPECTED_SHA256="dc12ffc21a45dc4796bc3240597c3bf7585989f5b0de142f4e3eb1bedad87781"
PATCH="$(cd "$(dirname "$0")" && pwd)/tree-sitter-dockerfile.patch"

WORK_DIR="$(mktemp -d -p "$HOME")"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --quiet "$GRAMMAR_REPO" "$WORK_DIR/grammar"
git -C "$WORK_DIR/grammar" checkout --quiet "$GRAMMAR_COMMIT"
# Upstream rejects multi-name ARG (issue #54), an empty ARG default (#69) and # or [ inside a RUN word.
git -C "$WORK_DIR/grammar" apply "$PATCH"

npm install --prefix "$WORK_DIR" "tree-sitter-cli@$CLI_VERSION" --silent

(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" generate)
(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" test)
(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" build --wasm --docker)

WASM="$WORK_DIR/grammar/tree-sitter-dockerfile.wasm"
ACTUAL_SHA256="$(sha256sum "$WASM" | cut -d' ' -f1)"

if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "WARNING: sha256 mismatch (Docker/emscripten builds may not be byte-identical)"
  echo "  expected: $EXPECTED_SHA256"
  echo "  actual:   $ACTUAL_SHA256"
fi

cp "$WASM" "$OUT_DIR/tree-sitter-dockerfile.wasm"
echo "Installed $OUT_DIR/tree-sitter-dockerfile.wasm ($(wc -c < "$OUT_DIR/tree-sitter-dockerfile.wasm") bytes, sha256=$ACTUAL_SHA256)"
