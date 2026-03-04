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

### Build

| Tool | Description |
|------|-------------|
| `autopilot_build` | Run `xcodebuild` and return structured errors with **smart context**: enclosing function scope + related definitions and call sites across the project |
| `autopilot_tuist_build` | Build a Tuist project end-to-end. Auto-detects version — v4+ runs `tuist install → generate`, v3.x runs `tuist fetch → generate` — then xcodebuild |

**`autopilot_build` parameters**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `project_path` | ✅ | — | Absolute path to `.xcodeproj` or `.xcworkspace` |
| `scheme` | ✅ | — | Build scheme name |
| `configuration` | — | `Debug` | `Debug` or `Release` |
| `destination` | — | auto | Build destination (auto-detected from available simulators) |
| `include_warnings` | — | `false` | Include warnings in context extraction |

**`autopilot_tuist_build` parameters**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `project_directory` | ✅ | — | Directory containing `Project.swift` or `Tuist/` |
| `scheme` | ✅ | — | Build scheme name |
| `configuration` | — | `Debug` | Build configuration |
| `destination` | — | auto | Build destination |
| `skip_install` | — | `false` | Skip `tuist install/fetch` |
| `skip_generate` | — | `false` | Skip `tuist generate` |
| `workspace_path` | — | — | Required when `skip_generate: true` |

---

### Fix

| Tool | Description |
|------|-------------|
| `autopilot_apply_fixes` | Apply a list of fixes to source files. Each fix is line-verified before patching. All modified files are backed up. Fixes outside the project scope are rejected. |

**`autopilot_apply_fixes` parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `project_path` | ✅ | Used for scope validation |
| `fixes` | ✅ | Array of `{ file_path, line_number, original_line, fixed_line, explanation }` |

---

### Dependencies & Cache

| Tool | Description |
|------|-------------|
| `autopilot_resolve_spm` | Run `xcodebuild -resolvePackageDependencies` and return structured SPM errors (version conflicts, clone failures, Swift version mismatches) |
| `autopilot_cache_clean` | Selectively clear Xcode caches that `xcodebuild clean` doesn't cover |

**`autopilot_cache_clean` scope options**

| Scope | Clears |
|-------|--------|
| `project` | DerivedData for this project |
| `module_cache` | `ModuleCache.noindex` |
| `spm` | SPM fetch cache + `SourcePackages` |
| `index` | Index store |
| `all` | All of the above |

---

### Utilities

| Tool | Description |
|------|-------------|
| `autopilot_list_schemes` | List all build schemes in the project |
| `autopilot_clean` | Run `xcodebuild clean` |
| `autopilot_history` | Return fix session history for the current server session |

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

---

## License

MIT
