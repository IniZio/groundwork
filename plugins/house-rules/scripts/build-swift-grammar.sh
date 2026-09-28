#!/usr/bin/env bash
set -euo pipefail

GRAMMAR_REPO="https://github.com/alex-pinkus/tree-sitter-swift"
GRAMMAR_COMMIT="187fd4d3e55e2088da9cb31e414a2bac866292e8"
CLI_VERSION="0.25.3"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/src/hooks/grammars}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIB_DIR="$PLUGIN_DIR/src/hooks/lib"

WORK_DIR="$(mktemp -d -p "$HOME")"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --quiet "$GRAMMAR_REPO" "$WORK_DIR/grammar"
git -C "$WORK_DIR/grammar" checkout --quiet "$GRAMMAR_COMMIT"

npm install --prefix "$WORK_DIR" "tree-sitter-cli@$CLI_VERSION" --silent

# parser.c is not committed upstream; generate must run first (~1 min)
(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" generate)
(cd "$WORK_DIR/grammar" && "$WORK_DIR/node_modules/tree-sitter-cli/tree-sitter" build --wasm --docker)

WASM="$WORK_DIR/grammar/tree-sitter-swift.wasm"

# Load-test: verify the built wasm loads and parses correctly with the vendored
# web-tree-sitter 0.25 runtime before installing anything.
LOAD_TEST_SCRIPT="$WORK_DIR/load-test.mjs"
cat > "$LOAD_TEST_SCRIPT" << LOADTEST
import { Parser, Language } from "file://${LIB_DIR}/tree-sitter.js";

const ERROR_PREFIX = "ERROR: built tree-sitter-swift.wasm failed load-test with vendored web-tree-sitter 0.25.0";

try {
  const wasmBinary = await Bun.file("${LIB_DIR}/tree-sitter.wasm").arrayBuffer();
  await Parser.init({ wasmBinary });

  const swiftBuf = new Uint8Array(await Bun.file("${WASM}").arrayBuffer());
  let lang;
  try {
    lang = await Language.load(swiftBuf);
  } catch (e) {
    process.stderr.write(ERROR_PREFIX + ": Language.load failed: " + String(e.message ?? e) + "\n");
    process.exit(1);
  }

  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse("// c\nlet x = 1\n");
  const root = tree.rootNode;

  if (root.hasError) {
    process.stderr.write(ERROR_PREFIX + ": root node has error nodes\n");
    process.exit(1);
  }

  function findType(node, type) {
    if (node.type === type) return true;
    for (let i = 0; i < node.childCount; i++) {
      if (findType(node.child(i), type)) return true;
    }
    return false;
  }

  const commentTypes = ["comment", "line_comment", "multiline_comment"];
  if (!commentTypes.some((t) => findType(root, t))) {
    process.stderr.write(ERROR_PREFIX + ": no comment node found in parse tree\n");
    process.exit(1);
  }

  console.log("load-test OK");
} catch (e) {
  process.stderr.write(ERROR_PREFIX + ": " + String(e.message ?? e) + "\n");
  process.exit(1);
}
LOADTEST

if ! bun run "$LOAD_TEST_SCRIPT"; then
  exit 1
fi

ACTUAL_SHA256="$(sha256sum "$WASM" | cut -d' ' -f1)"
ACTUAL_BYTES="$(wc -c < "$WASM")"

cp "$WASM" "$OUT_DIR/tree-sitter-swift.wasm"
echo "Installed $OUT_DIR/tree-sitter-swift.wasm ($ACTUAL_BYTES bytes, sha256=$ACTUAL_SHA256)"

python3 -c "
import json
data = {
  'repo': '$GRAMMAR_REPO',
  'commit': '$GRAMMAR_COMMIT',
  'cli_version': '$CLI_VERSION',
  'build_command': 'tree-sitter generate && tree-sitter build --wasm --docker',
  'sha256': '$ACTUAL_SHA256',
  'bytes': $ACTUAL_BYTES,
  'rebuild_byte_identical': 'not verified; Docker+emscripten builds are not guaranteed byte-identical across runs'
}
print(json.dumps(data, indent=2))
" > "$OUT_DIR/tree-sitter-swift.source.json"

echo "Updated $OUT_DIR/tree-sitter-swift.source.json"
