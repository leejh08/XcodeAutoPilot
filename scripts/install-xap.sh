#!/usr/bin/env bash
# ============================================================
# XAP — Install Script
# Registers the xap keyword-detector hook in ~/.claude/settings.json
# and copies skills to ~/.claude/skills/
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_SRC="$REPO_ROOT/claude/hooks/keyword-detector.mjs"
SKILLS_SRC="$REPO_ROOT/claude/skills"
CLAUDE_DIR="$HOME/.claude"
SKILLS_DST="$CLAUDE_DIR/skills"
SETTINGS="$CLAUDE_DIR/settings.json"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${CYAN}[xap]${NC} $*"; }
ok()   { echo -e "${GREEN}[xap]${NC} $*"; }
warn() { echo -e "${YELLOW}[xap]${NC} $*"; }
err()  { echo -e "${RED}[xap]${NC} $*"; exit 1; }

# ----------------------------------------------------------
# Preflight checks
# ----------------------------------------------------------

[[ -f "$HOOK_SRC" ]] || err "Hook not found: $HOOK_SRC"
command -v node >/dev/null 2>&1 || err "Node.js is required but not installed."
command -v jq >/dev/null 2>&1   || err "jq is required but not installed. Run: brew install jq"

mkdir -p "$CLAUDE_DIR"

# ----------------------------------------------------------
# Copy skills
# ----------------------------------------------------------

log "Installing skills to $SKILLS_DST ..."
mkdir -p "$SKILLS_DST"

for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  dst="$SKILLS_DST/$skill_name"
  mkdir -p "$dst"
  cp "$skill_dir/SKILL.md" "$dst/SKILL.md"
  ok "  Installed skill: $skill_name"
done

# ----------------------------------------------------------
# Register hook in settings.json
# ----------------------------------------------------------

HOOK_CMD="node \"$HOOK_SRC\""

log "Registering hook in $SETTINGS ..."

# Create settings.json if it doesn't exist
if [[ ! -f "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

# Check if hook is already registered
if jq -e --arg cmd "$HOOK_CMD" \
  '.hooks.UserPromptSubmit[]?.hooks[]? | select(.command == $cmd)' \
  "$SETTINGS" >/dev/null 2>&1; then
  warn "Hook already registered — skipping."
else
  # Build new hook entry
  NEW_HOOK=$(jq -n --arg cmd "$HOOK_CMD" '{
    matcher: "*",
    hooks: [{
      type: "command",
      command: $cmd,
      timeout: 5
    }]
  }')

  # Merge into existing settings
  UPDATED=$(jq --argjson entry "$NEW_HOOK" '
    .hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) + [$entry])
  ' "$SETTINGS")

  echo "$UPDATED" > "$SETTINGS"
  ok "Hook registered."
fi

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------

echo ""
ok "XAP keyword triggers installed!"
echo ""
echo "  Available keywords:"
echo "    xbuild  /  xap build  — build + fix loop"
echo "    xfix    /  xap fix    — focused error fix"
echo "    xclean  /  xap clean  — cache clean + verify"
echo "    xspm    /  xap spm    — SPM resolve + verify"
echo "    xshot   /  xap shot   — simulator screenshot + UI verification"
echo ""
warn "Restart Claude Code to activate the hook."
