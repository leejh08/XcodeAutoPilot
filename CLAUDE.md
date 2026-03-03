# XcodeAutoPilot — Development Guide

## Workflow Rules

### Before every PR
1. Test on `/Users/leejh/Desktop/XcodeAutoPilotTest` using the MCP tools directly in Claude Code
2. Confirm `autopilot_build` detects errors correctly
3. Confirm the full fix loop works end-to-end
4. Only open a PR after the test passes

### Issue → Branch → PR flow
1. Create a GitHub issue describing the change
2. Branch off `main` with a descriptive name (e.g. `feat/apply-fixes-tool`, `fix/error-parser`)
3. Develop and commit with conventional commit messages
4. Test on XcodeAutoPilotTest (see above)
5. Open PR — assign `leejh08`, add appropriate label, add `leejh08` as reviewer
6. User approves and merges

### Commit message format
Follow Conventional Commits:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, config, tooling
- `docs:` — documentation
- `refactor:` — code restructuring without behavior change
- `test:` — tests

Always append:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Labels
Use exactly one of the five repo labels per issue/PR:
- `fix` — bug fixes
- `feature` — new features
- `chore` — maintenance
- `docs` — documentation
- `ci` — CI/CD and build pipeline

### Assignees & Reviewers
- Assignee: always `leejh08`
- Reviewer: always `leejh08`

## Architecture

### MCP Tool Pattern
MCP servers expose **tools only** — no internal LLM calls.
Claude Code handles all reasoning. The server handles build execution, context extraction, and safe file patching.

### Tool Responsibilities
| Tool | Responsibility |
|------|---------------|
| `autopilot_build` | Run xcodebuild, return structured errors + source context |
| `autopilot_apply_fixes` | Safely apply fixes from Claude Code (backup + rollback) |
| `autopilot_list_schemes` | List available Xcode schemes |
| `autopilot_clean` | Run xcodebuild clean |
| `autopilot_history` | Return session fix history |

### No API Keys in Source
- `.mcp.json` is gitignored — copy from `.mcp.json.example`
- Never commit secrets; GitHub push protection is enabled

## Build

```bash
npm install
npm run build   # tsc
npm test        # vitest
```
