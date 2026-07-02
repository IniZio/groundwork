#!/bin/sh
set -eu

DRY_RUN=0
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=1
  fi
done

PLUGIN_DIR=$(CDPATH= cd -P -- "$(dirname "$0")/.." >/dev/null 2>&1 && pwd -P)
SKILLS_DIR="$PLUGIN_DIR/skills/groundwork"
TARGET_DIR="${TARGET_DIR:-$HOME/.agents/skills}"

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry-run: would install Kimi skills from %s to %s\n' "$SKILLS_DIR" "$TARGET_DIR"
else
  printf 'Installing Kimi skills from %s to %s\n' "$SKILLS_DIR" "$TARGET_DIR"
  if [ ! -d "$TARGET_DIR" ]; then
    mkdir -p "$TARGET_DIR"
  fi
fi

for skill_dir in "$SKILLS_DIR"/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue

  name=$(basename "$skill_dir")
  link="$TARGET_DIR/$name"

  if [ -L "$link" ]; then
    current=$(readlink "$link")
    if [ "$current" = "$skill_dir" ]; then
      printf '  %s: already linked correctly, skipping\n' "$name"
      continue
    else
      printf '  %s: conflict - existing symlink points to %s\n' "$name" "$current" >&2
      exit 1
    fi
  elif [ -e "$link" ]; then
    printf '  %s: conflict - %s exists and is not a symlink\n' "$name" "$link" >&2
    exit 1
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  %s: would create symlink %s -> %s\n' "$name" "$link" "$skill_dir"
  else
    ln -s "$skill_dir" "$link"
    printf '  %s: linked\n' "$name"
  fi
done

printf 'Done.\n'
