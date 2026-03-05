# XcodeAutoPilot

An MCP server that gives Claude Code the ability to build, analyze, and fix Xcode errors — autonomously.

Claude Code handles all reasoning. XcodeAutoPilot handles build execution, context extraction, and safe file patching.

---

## How It Works

```
Claude Code
   ↕  MCP (stdio)
XcodeAutoPilot
   ↕  child_process
xcodebuild / tuist
   ↕
Your Xcode Project
```

1. `autopilot_build` runs `xcodebuild` and returns structured errors with smart source context
2. Claude Code analyzes the errors — seeing the enclosing function scope, related definitions, and call sites
3. `autopilot_apply_fixes` applies the fixes with line-level verification and automatic backup
4. Repeat until 0 errors

If a fix makes things worse, it automatically rolls back.

---

## Requirements

| | Minimum |
|---|---|
| macOS | 13.0 Ventura |
| Xcode | 14.0 |
| Node.js | 18.0 |
| Claude Code | latest |

---

## Installation

```bash
git clone https://github.com/leejh08/XcodeAutoPilot.git
cd XcodeAutoPilot
npm install && npm run build
```

Verify Xcode CLI tools are installed:

```bash
xcodebuild -version
# If missing: xcode-select --install
```

---

## Register with Claude Code

Add to `.mcp.json` in your project root (or `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "xcode-autopilot": {
      "command": "node",
      "args": ["/absolute/path/to/XcodeAutoPilot/dist/index.js"]
    }
  }
}
```

Restart Claude Code after saving.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `autopilot_build` | Run xcodebuild — returns structured errors with smart context (enclosing scope + related definitions and call sites) |
| `autopilot_apply_fixes` | Apply fixes safely — line-verified, backed up before patching, auto-rollback if errors increase |
| `autopilot_screenshot` | Build and run the app in a simulator, capture a screenshot, and return it as an image for AI visual analysis |
| `autopilot_tuist_build` | Build Tuist projects end-to-end — auto-detects version and runs `install → generate → xcodebuild` |
| `autopilot_resolve_spm` | Resolve SPM dependencies and return structured errors |
| `autopilot_cache_clean` | Selectively clear DerivedData, ModuleCache, SPM cache, or Index store |
| `autopilot_list_schemes` | List all available build schemes |
| `autopilot_clean` | Run `xcodebuild clean` |
| `autopilot_history` | Return fix session history |

---

## XAP Keyword Triggers

Install the XAP hook to trigger workflows with a single word in any prompt:

```bash
bash scripts/install-xap.sh
# Restart Claude Code
```

| Keyword | Alias | What it does |
|---------|-------|-------------|
| `xbuild` | `xap build` | Build → analyze → fix loop (up to 5 iterations) |
| `xfix` | `xap fix` | Focused error analysis + fix |
| `xclean` | `xap clean` | Cache clean → verify build |
| `xspm` | `xap spm` | SPM resolve → cache clean → verify build |
| `xshot` | `xap shot` | Build → launch in simulator → screenshot → AI visual verification |

---

## License

MIT
