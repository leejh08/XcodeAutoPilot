# XcodeAutoPilot

An MCP server that automatically detects and fixes Xcode build errors. It wraps the `xcodebuild` CLI directly — no external MCP dependencies — and runs a continuous **build → analyze → fix → rebuild** loop until your project compiles cleanly.

> Think of it as an autopilot for Xcode: it reads your build errors, asks Claude to figure out the minimal fix, applies the changes, and keeps going until the build passes.

## How It Works

```
[Claude Code / MCP Client]
        ↕  MCP protocol (stdio)
[XcodeAutoPilot MCP Server]
        ↕  child_process.exec
[xcodebuild CLI]
        ↕
[Your Xcode Project]
```

1. Runs `xcodebuild` and captures all errors
2. Reads the relevant source files around each error (±50 lines of context)
3. Sends errors + context to Claude API and receives minimal fix proposals
4. Applies fixes one file at a time (bottom-to-top to preserve line numbers)
5. Repeats until zero errors or the iteration limit is reached

All file modifications are backed up before changes are applied. If fixing makes things worse, it automatically rolls back.

---

## Requirements

| Requirement | Minimum Version |
|-------------|-----------------|
| macOS | 13.0 Ventura |
| Xcode | 14.0 |
| Node.js | 18.0 |
| npm | 8.0 |
| Anthropic API Key | — |

---

## Installation

### Option 1 — Homebrew + npm (recommended)

```bash
# Install Node.js via Homebrew (if not already installed)
brew install node

# Verify versions
node --version   # should be >= 18.0
npm --version    # should be >= 8.0

# Clone and install
git clone https://github.com/your-username/xcode-autopilot.git
cd xcode-autopilot
npm install
npm run build
```

### Option 2 — npm only

```bash
git clone https://github.com/your-username/xcode-autopilot.git
cd xcode-autopilot
npm install
npm run build
```

### Verify Xcode CLI tools

```bash
xcodebuild -version   # should print Xcode 14.0 or later
```

If not installed:
```bash
xcode-select --install
```

---

## Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional (defaults shown)
export AUTOPILOT_MODEL="claude-sonnet-4-20250514"  # Claude model to use
export AUTOPILOT_MAX_ITERATIONS=5                   # Default fix iterations
export AUTOPILOT_BACKUP_DIR=".autofix-backup"       # Backup directory
export AUTOPILOT_CONTEXT_LINES=50                   # Lines of context around each error
export AUTOPILOT_FILE_SIZE_LIMIT=1048576            # Skip files larger than 1 MB
```

---

## Register with Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xcode-autopilot": {
      "command": "node",
      "args": ["/absolute/path/to/xcode-autopilot/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Then restart Claude Desktop.

---

## MCP Tools

### `autopilot_run` ⭐ Main tool

Runs the full build → analyze → fix → rebuild loop automatically.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_path` | string | ✅ | — | Absolute path to `.xcodeproj` or `.xcworkspace` |
| `scheme` | string | ✅ | — | Build scheme name |
| `max_iterations` | number | — | 5 | Max fix iterations (hard limit: 10) |
| `configuration` | string | — | `Debug` | Build configuration |
| `destination` | string | — | auto-detected | Build destination |
| `fix_warnings` | boolean | — | `false` | Also fix warnings |

### `autopilot_build`

Runs `xcodebuild` and returns a structured list of errors and warnings. No files are modified.

### `autopilot_analyze`

Builds the project and asks Claude to analyze the errors and propose fixes — but does **not** apply anything. Useful for a dry-run preview.

### `autopilot_list_schemes`

Lists all available schemes in the Xcode project.

| Parameter | Type | Required |
|-----------|------|----------|
| `project_path` | string | ✅ |

### `autopilot_clean`

Runs `xcodebuild clean` for the given scheme.

### `autopilot_history`

Returns the history of all `autopilot_run` sessions in the current server session.

---

## Safety Features

| Feature | Description |
|---------|-------------|
| **File backup** | Every file is backed up to `.autofix-backup/{timestamp}/` before modification |
| **Iteration limit** | Max 10 iterations (default 5), hard-capped regardless of input |
| **Infinite loop detection** | If the same errors repeat in back-to-back iterations, the loop stops immediately |
| **Error increase detection** | If a fix introduces more errors than it resolves, changes are rolled back and the loop stops |
| **Content verification** | `original_line` is matched against the actual file before applying each fix — mismatches are skipped |
| **Scope restriction** | Only files inside `project_path` can be modified |
| **Protected directories** | `Pods/`, `.build/`, `DerivedData/`, `Carthage/`, `.framework/`, `.git/` are never touched |
| **File size limit** | Files larger than 1 MB are skipped (likely generated files) |
| **Build timeout** | `xcodebuild` is killed if it runs longer than 5 minutes |
| **Concurrency guard** | Only one `autopilot_run` can run per project at a time |

---

## Example Output

```json
{
  "status": "success",
  "summary": "12 errors → 0 errors in 3 iterations (45.2s)",
  "iterations": [
    { "iteration": 1, "errors_before": 12, "errors_after": 5, "fixes_applied": 7 },
    { "iteration": 2, "errors_before": 5,  "errors_after": 1, "fixes_applied": 4 },
    { "iteration": 3, "errors_before": 1,  "errors_after": 0, "fixes_applied": 1 }
  ],
  "all_fixes": [
    {
      "file": "Sources/App/ViewModel.swift",
      "line": 42,
      "description": "Type mismatch: added explicit Int conversion",
      "iteration": 1
    }
  ],
  "remaining_errors": [],
  "rollbacks": [],
  "unfixable": [],
  "duration_seconds": 45.2,
  "backup_path": ".autofix-backup/20250303-141523/"
}
```

---

## Usage Examples

```
# List available schemes
autopilot_list_schemes
  project_path: /Users/me/MyApp/MyApp.xcodeproj

# Check build errors without fixing
autopilot_build
  project_path: /Users/me/MyApp/MyApp.xcodeproj
  scheme: MyApp

# Preview what Claude would fix (dry-run)
autopilot_analyze
  project_path: /Users/me/MyApp/MyApp.xcodeproj
  scheme: MyApp

# Run the full auto-fix loop
autopilot_run
  project_path: /Users/me/MyApp/MyApp.xcodeproj
  scheme: MyApp
  max_iterations: 5
```

---

## Development

```bash
# Run tests
npm test

# Watch mode
npm run dev

# Build
npm run build
```

---

## Project Structure

```
src/
├── index.ts                    # MCP server entry point (stdio transport)
├── server.ts                   # Server factory + tool routing
├── types.ts                    # Shared TypeScript interfaces
├── core/
│   ├── xcodebuild.ts           # xcodebuild CLI wrapper
│   ├── error-parser.ts         # Build output → BuildDiagnostic[]
│   ├── claude-fixer.ts         # Claude API calls + response parsing
│   ├── file-patcher.ts         # File modification, backup, rollback
│   ├── orchestrator.ts         # Build-fix loop coordination
│   └── safety.ts               # Guards: loop detection, scope, locks
└── utils/
    ├── logger.ts               # stderr-only logger (MCP stdout is reserved)
    └── context-extractor.ts    # Extract source context around error lines
```
