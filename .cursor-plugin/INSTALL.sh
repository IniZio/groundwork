#!/bin/bash
set -euo pipefail

REPO_URL="https://github.com/IniZio/groundwork.git"
PLUGIN_NAME="groundwork"
INSTALL_DIR="$HOME/.cursor/plugins/local/$PLUGIN_NAME"

echo "→ Installing Groundwork Cursor plugin..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Clone repository (shallow)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR/repo" >/dev/null 2>&1

# Remove existing installation
if [ -d "$INSTALL_DIR" ]; then
    echo "→ Removing existing installation..."
    rm -rf "$INSTALL_DIR"
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Copy plugin files
cd "$TEMP_DIR/repo"
cp -R .cursor-plugin commands hooks skills agents package.json README.md "$INSTALL_DIR/"

echo "✓ Installed to $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Restart Cursor or press Cmd/Ctrl+Shift+P → 'Developer: Reload Window'"
echo "  2. Verify: Settings → Plugins → Groundwork Workflow"
